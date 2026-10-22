"use server";

import { requireUser } from "@/lib/auth";
import { messageFor } from "@/lib/forms";
import { makeFeed, removeFeed } from "@/lib/services/calendar";
import { siteOrigin } from "@/lib/origin";

export type FeedState = { https?: string; webcal?: string; error?: string; removed?: boolean };

/** Make or replace the person's calendar feed link and show it once. */
export async function makeFeedAction(_prev: FeedState): Promise<FeedState> {
  try {
    const user = await requireUser();
    const token = await makeFeed(user.id);
    const https = `${await siteOrigin()}/calendar/${token}.ics`;
    return { https, webcal: https.replace(/^https?:/, "webcal:") };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function removeFeedAction(_prev: FeedState): Promise<FeedState> {
  try {
    const user = await requireUser();
    await removeFeed(user.id);
    return { removed: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}
