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

  const meetLink: string | null =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((e: { entryPointType?: string }) => e.entryPointType === "video")
      ?.uri ??
    null;

  return { htmlLink: data.htmlLink, id: data.id, meetLink };
}
