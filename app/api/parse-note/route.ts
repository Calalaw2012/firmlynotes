import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { parseNoteToEvents } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const timezone = typeof body?.timezone === "string" && body.timezone ? body.timezone : "UTC";
  const nowISO = typeof body?.nowISO === "string" ? body.nowISO : new Date().toISOString();

  if (!text) {
    return NextResponse.json({ error: "Note text is empty." }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "That note is too long — try trimming it down." }, { status: 400 });
  }

  try {
    const events = await parseNoteToEvents(text, timezone, nowISO);
    return NextResponse.json({ events });
  } catch (err) {
    console.error("parse-note failed", err);
    const message = err instanceof Error ? err.message : "Couldn't parse that note.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
