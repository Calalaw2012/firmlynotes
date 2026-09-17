import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import type { CreatedEvent, ParsedEvent } from "@/types/event";

export class GoogleAuthError extends Error {}

/**
 * Reads the signed-in user's Google access token server-side from the
 * NextAuth JWT cookie. Never touches the client — the token is not part of
 * the session object returned by useSession().
 */
export async function getGoogleAccessToken(req: NextRequest): Promise<string> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    throw new GoogleAuthError("Not signed in.");
  }
  if (token.error === "RefreshAccessTokenError" || token.error === "MissingRefreshToken") {
    throw new GoogleAuthError("Your Google connection expired. Please sign in again.");
  }
  const accessToken = token.accessToken as string | undefined;
  if (!accessToken) {
    throw new GoogleAuthError("No Google access token on file. Please sign in again.");
  }
  return accessToken;
}

/**
 * Reads the signed-in user's email server-side from the NextAuth JWT
 * cookie, for scoping data (like remembered attendee aliases) to this
 * one user. Returns null if not signed in -- callers should treat that as
 * "skip the personalization" rather than an error.
 */
export async function getUserEmail(req: NextRequest): Promise<string | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const email = token?.email;
  return typeof email === "string" && email ? email.toLowerCase() : null;
}

/** Adds `days` to a YYYY-MM-DD date string, returning YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function buildEventResource(event: ParsedEvent, timeZone: string) {
  const start = event.allDay
    ? { date: event.date }
    : { dateTime: `${event.date}T${event.startTime}:00`, timeZone };

  const end = event.allDay
    ? { date: addDays(event.date, 1) }
    : { dateTime: `${event.date}T${event.endTime}:00`, timeZone };

  return {
    summary: event.title || "Untitled note",
    description: event.description || undefined,
    start,
    end,
    attendees:
      event.attendees.length > 0
        ? event.attendees.map((a) => ({
            email: a.email,
            displayName: a.name && a.name !== a.email ? a.name : undefined,
          }))
        : undefined,
    conferenceData: event.addGoogleMeet
      ? {
          createRequest: {
            // Needs to be unique per request, not per event; Google dedupes
            // repeat requestIds against the same conference.
            requestId: `firmly-notes-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        }
      : undefined,
    reminders:
      event.reminders.length > 0
        ? {
            useDefault: false,
            overrides: event.reminders.map((r) => ({
              method: r.method,
              minutes: r.minutesBefore,
            })),
          }
        : { useDefault: true },
  };
}

/**
 * Pulls a Meet conference's dial-in phone number + PIN out of Google's
 * conferenceData.entryPoints, when present. Only Workspace plans with
 * calling enabled get a "phone" entry point at all -- most don't -- so both
 * come back null (not an error) whenever it's missing, same as meetLink
 * already does for the "video" entry point.
 */
function extractPhoneDialIn(conferenceData: unknown): { phone: string | null; pin: string | null } {
  const entryPoints = (conferenceData as { entryPoints?: unknown } | undefined)?.entryPoints;
  if (!Array.isArray(entryPoints)) return { phone: null, pin: null };

  const phoneEntry = entryPoints.find(
    (e): e is { entryPointType?: string; label?: string; uri?: string; pin?: string } =>
      typeof e === "object" && e !== null && (e as { entryPointType?: string }).entryPointType === "phone"
  );
  if (!phoneEntry) return { phone: null, pin: null };

  // Google gives the dial-in number either as a human label ("+1 555-123-
  // 4567") or only inside a tel: URI -- prefer the label, fall back to
  // stripping the URI scheme.
  const phone = phoneEntry.label || (phoneEntry.uri ? phoneEntry.uri.replace(/^tel:/, "") : null);
  const pin = typeof phoneEntry.pin === "string" && phoneEntry.pin ? phoneEntry.pin : null;
  return { phone: phone || null, pin };
}

/** Shared shape-mapping from a raw Google Calendar API event response to our own CreatedEvent. */
function toCreatedEvent(data: any): CreatedEvent {
  const meetLink: string | null =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e: { entryPointType?: string }) => e.entryPointType === "video")
      ?.uri ??
    null;

  const { phone: meetPhone, pin: meetPin } = extractPhoneDialIn(data.conferenceData);

  return { htmlLink: data.htmlLink, id: data.id, meetLink, meetPhone, meetPin };
}

export async function createCalendarEvent(
  accessToken: string,
  event: ParsedEvent,
  timeZone: string
): Promise<CreatedEvent> {
  const resource = buildEventResource(event, timeZone);

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  if (event.addGoogleMeet) {
    // Required for Google to actually create the conferenceData instead of
    // silently ignoring it.
    url.searchParams.set("conferenceDataVersion", "1");
  }
  if (event.attendees.length > 0) {
    // Makes Google email invitations to attendees, same as creating the
    // event by hand in Calendar would.
    url.searchParams.set("sendUpdates", "all");
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resource),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = data?.error?.message || "Google Calendar rejected the event.";
    throw new Error(message);
  }

  return toCreatedEvent(data);
}

/**
 * Updates an event that was already created earlier in this session, in
 * place -- used when the note text describing an already-sent event
 * changes (a different time, a new attendee, etc.), so the note stays the
 * single source of truth without leaving a duplicate, stale event behind
 * on the calendar. A PATCH, not a PUT: only the fields in `resource` are
 * touched, so anything Google itself might have added to the event (an
 * attendee's RSVP, for instance) is left alone.
 */
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  event: ParsedEvent,
  timeZone: string
): Promise<CreatedEvent> {
  const resource = buildEventResource(event, timeZone);

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
  );
  if (event.addGoogleMeet) {
    url.searchParams.set("conferenceDataVersion", "1");
  }
  if (event.attendees.length > 0) {
    url.searchParams.set("sendUpdates", "all");
  }

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resource),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = data?.error?.message || "Google Calendar rejected the update.";
    throw new Error(message);
  }

  return toCreatedEvent(data);
}
