"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicBanner } from "@/lib/services/banners";
import type { Summary } from "@/lib/services/reactions";
import { Reactions } from "./Reactions";

/**
 * The administrator's designed promo banners: the picture as designed (a phone version where one was uploaded), lifted off the page
 * with a folded corner and a gentle float. With several, they take turns, with dots and a pause; people who prefer less motion get
 * no float and no automatic turning. "slim" is the shorter version above search results and on dashboards.
 */
export function PromoBanner({ banners, slim = false, reactions, signedIn = false }: {
  banners: PublicBanner[]; slim?: boolean; signedIn?: boolean;
  /** Likes, dislikes and shares under the banner (homepage), by banner id. */
  reactions?: Record<string, Summary>;
}) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [calm, setCalm] = useState(true);
  useEffect(() => { setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  const go = useCallback((n: number) => setI((n + banners.length) % banners.length), [banners.length]);
  useEffect(() => {
    if (paused || calm || banners.length < 2) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % banners.length), 7000);
    return () => window.clearInterval(t);
  }, [paused, calm, banners.length]);
  if (!banners.length) return null;
  const b = banners[Math.min(i, banners.length - 1)];
  const src = (v: "desktop" | "mobile") => `/banners/${b.id}/${v}?v=${b.v}`;
  const img = (
    <picture>
      {b.mobileW ? <source media="(max-width: 640px)" srcSet={src("mobile")} width={b.mobileW} height={b.mobileH ?? undefined} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src("desktop")} alt={b.title} width={b.desktopW} height={b.desktopH} decoding="async" fetchPriority={slim ? "auto" : "high"} />
    </picture>
  );
  const external = /^https:\/\//.test(b.linkUrl);
  return (
    <section className={`pbanner${slim ? " slim" : ""}`} aria-roledescription={banners.length > 1 ? "carousel" : undefined} aria-label="Promotion">
      <div className={`pbanner-card fold-${b.fold.toLowerCase().replace("_", "-")}${b.float && !calm ? " floating" : ""}`} key={b.id}>
        {b.linkUrl ? <a href={b.linkUrl} {...(external ? { target: "_blank", rel: "noopener" } : {})} className="pbanner-link">{img}</a> : img}
        {b.fold !== "NONE" ? <span className="pbanner-fold" aria-hidden="true" /> : null}
      </div>
      {banners.length > 1 || (reactions && reactions[b.id]) ? (
        <div className="pbanner-foot">
          {reactions?.[b.id] ? <Reactions key={b.id} kind="BANNER" id={b.id} initial={reactions[b.id]} signedIn={signedIn} compact share={{ kind: "property", path: b.linkUrl.startsWith("/") ? b.linkUrl : "/", title: b.title, text: b.title }} /> : <span />}
          {banners.length > 1 ? (
            <div className="slides-nav" role="group" aria-label="Choose a banner">
              {!calm ? <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused} aria-label={paused ? "Play the banners" : "Pause the banners"}>{paused ? "▶" : "❚❚"}</button> : null}
              {banners.map((x, k) => <button key={x.id} type="button" aria-label={`Banner ${k + 1} of ${banners.length}`} aria-current={k === i} onClick={() => go(k)}><span className="dot" /></button>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
