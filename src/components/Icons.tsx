/** Small line icons used on the public pages. Decorative: always paired with visible text. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const svg = (d: React.ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...P}>{d}</svg>;

export const Icon = {
  building: () => svg(<><path d="M4 21V5l8-2v18M12 21h8V9l-8-2" /><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" /></>),
  person: () => svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
  home: () => svg(<><path d="M3 11 12 4l9 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" /></>),
  handshake: () => svg(<><path d="m11 17 2 2a2 2 0 0 0 3-3" /><path d="m14 14 2.5 2.5a2 2 0 0 0 3-3L15 9l-3 3a2 2 0 0 1-3-3l3-3h-2L4 12" /><path d="M2 11 6 7M22 11l-4-4" /></>),
  pin: () => svg(<><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></>),
  search: () => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>),
  shield: () => svg(<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>),
  chat: () => svg(<><path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.2A8 8 0 1 1 21 12z" /></>),
  key: () => svg(<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>),
  doc: () => svg(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>),
  chart: () => svg(<><path d="M4 20V4M4 20h16" /><path d="m8 15 3-4 3 2 4-6" /></>),
  star: () => svg(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9z" />),
  play: () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>,
};
