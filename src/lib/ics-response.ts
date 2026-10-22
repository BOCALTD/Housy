import { NextResponse } from "next/server";

/** Send a calendar file. download=false is for feeds that calendar apps fetch. */
export function icsResponse(ics: string, filename: string, download = true) {
  return new NextResponse(ics, { headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
