import { NextRequest, NextResponse } from "next/server";
import {
  createCalendarEvent,
  updateCalendarEvent,
  getGoogleAccessToken,
  GoogleAuthError,
} from "@/lib/googleCalendar";
import type { Attendee, ParsedEvent, Reminder } from "@/types/event";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isReminder(r: unknown): r is Reminder {
  if (typeof r !== "object" || r === null) return false;
  const rec = r as Record<string, unknown>;
  return (
    (rec.method === "popup" || rec.method === "email") &&
    typeof rec.minutesBefore === "number" &&
    rec.minutesBefore >= 0
  );
}

function isResolvedAttendee(a: unknown): a is Attendee {
  if (typeof a !== "object" || a === null) return false;
  const rec = a as Record<string, unknown>;
  // Every attendee sent here must already have a real email — resolving a
  // name to an address is the confirm card's job, not this route's.
  return typeof rec.name === "string" && typeof rec.email === "string" && EMAIL_RE.test(rec.email);
}

function validateEvent(body: unknown): { event: ParsedEvent; timeZone: string; eventId: string | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;
  const event = rec.event as Record<string, unknown> | undefined;
  const timeZone = rec.timeZone;
  // Present and non-empty means "update this event" rather than "create a
  // new one" — see createCalendarEvent vs. updateCalendarEvent below.
  const eventId = typeof rec.eventId === "string" && rec.eventId.trim() ? rec.eventId.trim() : null;

  if (!event || typeof timeZone !== "string" || !timeZone) return null;
  if (typeof event.title !== "string" || !event.title.trim()) return null;
  if (typeof event.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return null;
  if (typeof event.allDay !== "boolean") return null;

  if (!event.allDay) {
    const timeRe = /^\d{2}:\d{2}$/;
    if (typeof event.startTime !== "string" || !timeRe.test(event.startTime)) return null;
    if (typeof event.endTime !== "string" || !timeRe.test(event.endTime)) return null;
  }

  const reminders = Array.isArray(event.reminders) ? event.reminders : [];
  if (!reminders.every(isReminder)) return null;

  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  if (!attendees.every(isResolvedAttendee)) return null;

  return {
    timeZone,
    eventId,
    event: {
      title: event.title as string,
      description: typeof event.description === "string" ? event.description : "",
      date: event.date as string,
      allDay: event.allDay as boolean,
      startTime: event.allDay ? null : (event.startTime as string),
      endTime: event.allDay ? null : (event.endTime as string),
      reminders: reminders as Reminder[],
      attendees: attendees as Attendee[],
      addGoogleMeet: Boolean(event.addGoogleMeet),
      clarificationNeeded: null,
    },
  };
}

export async function POST(req: NextRequest) {
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(req);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = validateEvent(body);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "That event is missing required fields (title, date, either a time or all-day, and a real email for every attendee).",
      },
      { status: 400 }
    );
  }

  try {
    // A request that names an existing Google event id updates that event
    // in place instead of creating a second one -- this is what keeps an
    // edited note in sync with the calendar entry it already produced,
    // rather than leaving a stale original behind next to a new duplicate.
    const result = parsed.eventId
      ? await updateCalendarEvent(accessToken, parsed.eventId, parsed.event, parsed.timeZone)
      : await createCalendarEvent(accessToken, parsed.event, parsed.timeZone);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : `Failed to ${parsed.eventId ? "update" : "create"} the calendar event.`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
