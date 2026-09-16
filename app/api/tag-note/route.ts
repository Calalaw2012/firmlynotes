import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { tagCalendarSentences } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const sentences = Array.isArray(body?.sentences)
    ? body.sentences.filter((s: unknown): s is string => typeof s === "string")
    : [];

  if (sentences.length === 0) {
    return NextResponse.json({ calendarIndices: [] });
  }
  if (sentences.length > 200 || sentences.join("\n").length > 6000) {
    return NextResponse.json({ error: "That note is too long to auto-tag." }, { status: 400 });
  }

  try {
    const calendarIndices = await tagCalendarSentences(sentences);
    return NextResponse.json({ calendarIndices });
  } catch (err) {
    console.error("tag-note failed", err);
    // Non-fatal from the UI's perspective -- it just means nothing gets
    // pre-highlighted, and the user can still tag sentences by hand.
    return NextResponse.json({ calendarIndices: [] });
  }
}
