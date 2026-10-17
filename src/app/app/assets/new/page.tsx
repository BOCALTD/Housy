import { requireMember } from "@/lib/auth";
import { ASSET_CLASSES, ASSET_STATUSES, COMPANY_RELATIONSHIPS } from "@/lib/services/assets";
import { EnumOptions, Field, Flash, sp, type SP } from "@/components/ui";
import { createAssetAction } from "../actions";

export const metadata = { title: "Register an asset" };

export default async function NewAssetPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  await requireMember("asset.create");
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1>Register an asset</h1>
      <p className="muted">Assets stay internal until you create and publish a listing for them.</p>
      <Flash searchParams={{ error: sp(searchParams, "error") }} />
      <form action={createAssetAction} className="card stack">
        <Field label="Asset name"><input name="name" id="name" required placeholder="4-bedroom duplex, Plot 12 Admiralty Way" /></Field>
        <div className="fields">
          <Field label="Asset class">
            <select name="assetClass" id="assetClass" required defaultValue="RESIDENTIAL"><EnumOptions values={ASSET_CLASSES} /></select>
          </Field>
          <Field label="Category" hint="For example Duplex, Warehouse, Generator.">
            <input name="category" id="category" required />
          </Field>
          <Field label="Current status">
            <select name="status" id="status" defaultValue="ACTIVE"><EnumOptions values={ASSET_STATUSES.slice(0, 4)} /></select>
          </Field>
        </div>
        <Field label="How does your company hold this asset?" hint="Managing a property does not make your company its owner. Record the legal owner separately on the asset page.">
          <select name="companyRelationship" id="companyRelationship" required defaultValue="">
            <option value="" disabled>Choose one</option>
            <EnumOptions values={COMPANY_RELATIONSHIPS} />
          </select>
        </Field>
        <Field label="Address"><input name="address" id="address" /></Field>
        <div className="fields">
          <Field label="City or area"><input name="city" id="city" placeholder="Lekki" /></Field>
          <Field label="State"><input name="state" id="state" placeholder="Lagos" /></Field>
        </div>
        <div className="fields">
          <Field label="Acquisition cost (₦)" hint="Optional."><input name="acquisitionCost" id="acquisitionCost" inputMode="decimal" /></Field>
          <Field label="Acquired on" hint="Optional."><input name="acquiredOn" id="acquiredOn" type="date" /></Field>
        </div>
        <Field label="Description"><textarea name="description" id="description" rows={4} /></Field>
        <div className="row"><button className="btn primary" type="submit">Register asset</button></div>
      </form>
    </div>
  );
}
