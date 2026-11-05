import type { Icon } from "./Icons";

export type IconName = keyof typeof Icon;
export type SideItem = { href: string; label: string; icon?: IconName; badge?: number };
export type SideGroup = { label: string; items: SideItem[] };
