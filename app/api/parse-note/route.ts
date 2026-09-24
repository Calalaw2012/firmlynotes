import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { parseNoteToEvents } from "@/lib/anthropic";
import { getUserEmail } from "@/lib/googleCalendar";
import { getAttendeeAlias } from "@/lib/attendeeAliases";
import type { ParsedEvent } from "@/types/event";

/**
 * Fills in emails for attendees the extractor only got a name for, using
 * previously-remembered name -> email choices (see lib/attendeeAliases.ts,
 * written whenever the user resolves a name via AttendeesEditor's "fix"
 * flow). This is what makes a name the user has already resolved once
 * come back pre-resolved on every later note that mentions them, instead
 * of showing up unresolved again until they search for it by hand. Only
 * cheap, exact/first-name KV lookups happen here -- the heavier Google-
 * contacts search (app/page.tsx's resolveAttendees) still runs client-side
 * afterward for anything left unresolved.
 */
async function resolveKnownAttendees(events: ParsedEvent[], userEmail: string | null): Promise<ParsedEvent[]> {
  if (!userEmail) return events;
  return Promise.all(
    events.map(async (event) => {
      if (event.attendees.every((a) => a.email)) return event;
      const attendees = await Promise.all(
        event.attendees.map(async (a) => {
          if (a.email) return a;
          const alias = await getAttendeeAlias(userEmail, a.name);
          return alias ? { name: a.name, email: alias.email } : a;
        })
      );
      return { ...event, attendees };
    })
  );
}

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
    const userEmail = await getUserEmail(req);
    const resolved = await resolveKnownAttendees(events, userEmail);
    return NextResponse.json({ events: resolved });
  } catch (err) {
    console.error("parse-note failed", err);
    const message = err instanceof Error ? err.message : "Couldn't parse that note.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
