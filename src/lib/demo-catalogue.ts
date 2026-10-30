/**
 * Seeds the demonstration catalogue (src/lib/demo-catalogue-data.ts): four sample companies with their agents, about 25
 * published properties with several photographs each, property reels made from those photographs, verified checks, plans,
 * completed deals with client reviews, promotions, likes, comments and followers. Runs only as part of createDemoData,
 * that is with SEED_DEMO_DATA=true, and every page then carries a strip saying the data is a sample.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, withPlatformAdmin, withTenant, withUser } from "./db";
import type { Ctx } from "./services/context";
import { DEMO_COMPANIES, DEMO_LISTINGS, DEMO_REVIEWS } from "./demo-catalogue-data";
import { acceptInvitation, inviteMember, registerCompany } from "./services/companies";
import { createAsset, setAssetPosition } from "./services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "./services/listings";
import { addListingPhoto } from "./services/listing-photos";
import { follow, registerSeeker, saveAgentProfile, saveCompanyProfile } from "./services/community";
import { decideKyc, submitAgentKyc, submitCompanyKyc } from "./services/kyc";
import { assignSubscription } from "./services/subscriptions";
import { addComment, moderateReel, toggleLike, uploadReel } from "./services/reels";
import { createClient } from "./services/crm";
import { completeDeal, createDeal, decideAcceptance, moveStage, recordOffer, requestAcceptance } from "./services/deal";
import { issueInvite, moderateReview, submitReview } from "./services/reviews";
import { displayQueue, requestDisplay, reviewDisplay } from "./services/completed";
import { requestPromo, reviewPromo } from "./services/promotions";
import { toDateOnlyString } from "./dates";

const MEDIA = join(process.cwd(), "prisma/demo-media");
const photo = (f: string) => ({ type: "image/jpeg", bytes: readFileSync(join(MEDIA, "photos", `${f}.jpg`)) });
const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n% DEMONSTRATION DOCUMENT - NOT A REAL RECORD\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));
const doc = (name: string) => ({ type: "application/pdf", bytes: PDF, name });

async function ctxFor(userId: string, companyId: string): Promise<Ctx> {
  const m = await withTenant(companyId, userId, (tx) => tx.membership.findFirstOrThrow({ where: { companyId, userId } }));
  return { userId, companyId, membershipId: m.id, role: m.role };
}

export async function createDemoCatalogue(adminId: string, o: { password: string; alpha: Ctx; beta: Ctx; seekerId: string; campaignId?: string }) {
  const firms = new Map<string, { owner: Ctx; agents: Ctx[] }>([["alpha", { owner: o.alpha, agents: [] }], ["beta", { owner: o.beta, agents: [] }]]);
  const inAYear = toDateOnlyString(new Date(Date.now() + 365 * 864e5));

  // ---------- Companies, agents, checks and plans ----------
  for (const c of DEMO_COMPANIES) {
    const reg = await registerCompany({ companyName: c.legalName, name: c.owner.name, email: c.owner.email, password: o.password });
    const owner = await ctxFor(reg.userId, reg.companyId);
    const agents: Ctx[] = [];
    for (const a of c.agents) {
      const token = await inviteMember(owner, { email: a.email, role: "AGENT" });
      const joined = await acceptInvitation(token, { name: a.name, password: o.password });
      const ctx = await ctxFor(joined.userId, owner.companyId);
      await saveAgentProfile(ctx, { displayName: a.name, headline: a.headline, bio: a.bio, listed: true, acceptsMessages: true });
      await submitAgentKyc(ctx.userId, ctx.companyId, "AGENT_ID", { fullName: a.name, idType: "NIN", idNumber: String(10000000100 + agents.length + firms.size * 10) }, doc("sample-id.pdf"));
      await submitAgentKyc(ctx.userId, ctx.companyId, "AGENT_PHONE", { phone: "08000000100" }, null);
      agents.push(ctx);
    }
    await saveCompanyProfile(owner, { kind: c.kind, displayName: c.displayName, tagline: c.tagline, about: c.about, listed: true });
    await submitCompanyKyc(owner, "CAC_REGISTRATION", { legalName: c.legalName, rcNumber: `RC ${2000000 + firms.size}`, incorporatedOn: "2016-05-10" }, doc("sample-cac.pdf"));
    await submitCompanyKyc(owner, "DIRECTOR_ID", { directorName: c.owner.name, idType: "NIN", idNumber: String(10000000200 + firms.size) }, doc("sample-director-id.pdf"));
    await submitCompanyKyc(owner, "OFFICE_ADDRESS", { address: c.address, city: c.city, state: c.state }, doc("sample-utility-bill.pdf"));
    await submitCompanyKyc(owner, "COMPANY_CONTACT", { phone: "08000000200", email: c.owner.email, website: "" }, null);
    if (c.plan) {
      const plan = await withUser("demo-seed", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: c.plan! } }));
      await assignSubscription(adminId, { planId: plan.id, periodEnd: inAYear, companyId: owner.companyId, note: "[DEMO] Sample subscription" });
    }
    firms.set(c.key, { owner, agents });
  }
  const waiting = await withPlatformAdmin(adminId, (tx) => tx.kycItem.findMany({ where: { status: "SUBMITTED", companyId: { in: [...firms.values()].map((f) => f.owner.companyId) } }, select: { id: true } }));
  for (const k of waiting) await decideKyc(adminId, k.id, { decision: "verify", note: "", evidence: "Demonstration data: no real check was made.", limitations: "Demonstration record." });

  // ---------- Properties ----------
  const listed: { index: number; listingId: string; publicRef: string; assetId: string; firm: string; poster: Ctx; priceKobo: bigint }[] = [];
  for (const [index, d] of DEMO_LISTINGS.entries()) {
    const firm = firms.get(d.company)!;
    const poster = d.agent !== undefined && firm.agents[d.agent] ? firm.agents[d.agent] : firm.owner;
    const asset = await createAsset(firm.owner, { name: `[DEMO] ${d.name}`, assetClass: d.cls, category: d.category, city: d.city, state: d.state, address: d.area, companyRelationship: "MANAGER" } as never);
    await setAssetPosition(firm.owner, asset.id, { lat: String(d.lat), lng: String(d.lng) });
    await saveListingDraft(poster, asset.id, { ...d.listing, city: d.city, state: d.state } as never);
    for (const [file, caption] of d.photos) await addListingPhoto(poster, asset.id, photo(file), `${caption} (sample photo)`);
    await setListingStatus(poster, asset.id, "PENDING_REVIEW");
    const l = await withTenant(firm.owner.companyId, firm.owner.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
    await reviewListing(adminId, l.id, "approve", "Sample listing approved automatically");
    listed.push({ index, listingId: l.id, publicRef: l.publicRef, assetId: asset.id, firm: d.company, poster, priceKobo: l.priceKobo });
  }

  // ---------- Reels: short videos made from each property's photographs (scripts/make-demo-reels.ts) ----------
  const fans = [o.seekerId];
  for (const r of DEMO_REVIEWS) fans.push((await registerSeeker({ name: r.client, email: r.email, password: o.password })).userId);
  const reels: string[] = [];
  for (const item of listed) {
    const d = DEMO_LISTINGS[item.index];
    const file = join(MEDIA, "reels", `reel-${String(item.index).padStart(2, "0")}.mp4`);
    if (!d.reel || !existsSync(file)) continue;
    // A reel is posted by a listed agent; where the owner posted the property, the firm's first agent posts the reel.
    const firm = firms.get(item.firm)!;
    const author = item.poster.role === "AGENT" ? item.poster : firm.agents[0];
    if (!author) continue;
    const reel = await uploadReel(author.userId, { caption: d.reel, city: d.city, listingId: item.listingId }, { type: "video/mp4", bytes: readFileSync(file) });
    await moderateReel(adminId, reel.id, "publish", "");
    reels.push(reel.id);
  }
  const COMMENTS = ["Beautiful finishing. Is the price negotiable?", "Booked a viewing for Saturday!", "How far is it from the main road?", "The kitchen is lovely.", "Is there a payment plan?"];
  for (const [k, id] of reels.entries()) {
    for (const fan of fans.slice(0, 2 + (k % fans.length))) await toggleLike(fan, id);
    await addComment(fans[(k + 1) % fans.length], id, COMMENTS[k % COMMENTS.length]);
  }

  // ---------- Followers ----------
  for (const [k, fan] of fans.entries()) {
    for (const c of DEMO_COMPANIES.slice(0, 2 + (k % 3))) await follow(fan, c.kind === "DEVELOPER" ? "DEVELOPER" : "COMPANY", firms.get(c.key)!.owner.companyId);
    for (const f of firms.values()) for (const a of f.agents.slice(0, 1)) await follow(fan, "AGENT", a.userId);
  }

  // ---------- Completed deals and the reviews clients left afterwards ----------
  for (const [k, r] of DEMO_REVIEWS.entries()) {
    const firm = firms.get(r.company)!;
    const agent = firm.agents[0];
    const property = listed.find((x) => x.firm === r.company && x.index !== undefined && DEMO_LISTINGS[x.index].listing.purpose === "SALE") ?? listed.find((x) => x.firm === r.company)!;
    const client = await createClient(agent, { name: `[DEMO] ${r.client}`, email: r.email, city: DEMO_COMPANIES.find((c) => c.key === r.company)!.city });
    const deal = await createDeal(agent, { clientId: client.id, assetId: property.assetId, type: "SALE", asking: String(property.priceKobo / 100n), title: `[DEMO] Sale to ${r.client}` });
    const offer = await recordOffer(agent, deal.id, { side: "CLIENT", amount: String((property.priceKobo * 95n) / 10000n) });
    await requestAcceptance(agent, offer.id);
    await decideAcceptance(firm.owner, offer.id, "approve", "Price confirmed with the owner.");
    await moveStage(agent, deal.id, "LEGAL");
    await completeDeal(firm.owner, deal.id, "Keys and documents handed over.");
    const link = await issueInvite(firm.owner, { basis: "TRANSACTION", basisRef: deal.id });
    const reviewer = fans[k + 1];
    const rev = await submitReview(reviewer, { token: link.token, overall: r.overall as never, communication: r.overall as never, professionalism: 5 as never, accuracy: Math.max(3, r.overall - (k % 2)) as never, responsiveness: r.overall as never, body: r.body });
    if (rev.status === "HELD") await moderateReview(adminId, rev.id, "release", "[DEMO] Checked");
    if (k < 3) {
      await requestDisplay(firm.owner, deal.id, { statement: "[DEMO] Buyer and seller agreed to show this sale.", confirmed: true });
      const queued = (await displayQueue(adminId)).find((x) => x.dealId === deal.id);
      if (queued) await reviewDisplay(adminId, queued.id, "approve", "");
    }
  }

  // ---------- Promotions: a few sample properties in the running campaign ----------
  if (o.campaignId) {
    for (const item of listed.filter((x) => [0, 7, 16, 24].includes(x.index))) {
      try {
        const cut = item.index % 2 ? 90n : 88n;
        const asked = await requestPromo(item.poster, o.campaignId, item.listingId, String((item.priceKobo * cut) / 10000n));
        await reviewPromo(adminId, asked.id, "approve", "[DEMO] Approved");
      } catch (e) { console.warn("sample promotion skipped:", (e as Error).message); }
    }
  }
  return { companies: firms.size, listings: listed.length, reels: reels.length, reviews: DEMO_REVIEWS.length };
}

/** Whether this database holds the demonstration data (used for the "sample data" strip). */
export async function hasDemoData() {
  return (await prisma.user.count({ where: { email: "demo.alpha@example.test" } })) > 0;
}
