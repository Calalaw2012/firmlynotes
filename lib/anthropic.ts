import type { Attendee, ParsedEvent, Reminder } from "@/types/event";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// The @anthropic-ai/sdk client's own HTTP transport (its retry/timeout/
// AbortController wrapping around fetch) triggers "[unenv] https.request is
// not implemented yet!" and, once that Workers compat flag is turned on, a
// second, opaque "Cannot read properties of null (reading 'has')" deep in
// Cloudflare's Node-http-on-fetch shim -- neither of which is fixable from
// here. A plain, direct fetch() call (the same approach already used for
// Google's OAuth token/userinfo endpoints in lib/auth.ts, which works fine
// in this Workers runtime) sidesteps the SDK's transport entirely.
function getApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }
  return apiKey;
}

const EVENT_ITEM_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "A short, calendar-friendly event title (a few words, not the whole note).",
    },
    description: {
      type: "string",
      description:
        "Any substantive detail from the note beyond what the other fields already capture -- e.g. an agenda item, case/matter reference, location, or instruction. Never restate the title, date/time, duration, attendee list, reminder timing, or video-call/Meet setup as description text -- those already have their own fields, and repeating them is not real content. Write it as natural, complete sentences, not restated fragments. Empty string if the note says nothing beyond what the other fields cover.",
    },
    date: {
      type: "string",
      description: "This event's date resolved to an absolute calendar date, formatted YYYY-MM-DD.",
    },
    allDay: {
      type: "boolean",
      description:
        "True when the note gives a date with no time information at all for this event (no clock time and no loose part-of-day mention like 'morning'/'afternoon'/'evening'/'night'). False whenever an explicit clock time OR a part-of-day mention is present -- both of those get a real startTime/endTime instead, per the default-scheduling rules below.",
    },
    startTime: {
      type: "string",
      description:
        "24-hour HH:MM start time, local to the user's timezone. Omit/empty if allDay is true. See the default-scheduling rules below for what to fill in when the note gives no explicit clock time.",
    },
    endTime: {
      type: "string",
      description:
        "24-hour HH:MM end time, local to the user's timezone. If the note gives a duration instead of an end time, compute it from startTime. Omit/empty if allDay is true. See the default-scheduling rules below for the default when nothing indicates duration.",
    },
    reminders: {
      type: "array",
      description:
        "Reminders to set for this event. If the note specifies none, default to a single popup reminder 30 minutes before.",
      items: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["popup", "email"] },
          minutesBefore: { type: "number" },
        },
        required: ["method", "minutesBefore"],
      },
    },
    attendees: {
      type: "array",
      description:
        "People to actually invite to this event -- extracted ONLY from phrases that clearly show participation, like 'with Sarah', 'invite the Hendricks', 'cc opposing counsel', 'meet with John', 'Monica and Peter to attend', 'attendees: Monica, Peter', 'X and Y will be there'. A person's name showing up elsewhere in the note -- as part of a case/matter name, party name, or subject line (e.g. 'Smith v. Jones', 'the Dillon matter', 're: Johnson deposition') -- is NOT by itself a reason to add them as an attendee. Only add someone if the note separately indicates they are attending, being invited, or cc'd. Do not include the note-taker themselves.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Their name as written in the note. If only an email was given, repeat the email here.",
          },
          email: {
            type: "string",
            description:
              "Their email address, ONLY if the note itself contains it verbatim. Empty string if the note gives just a name — do not invent or guess an email address.",
          },
        },
        required: ["name", "email"],
      },
    },
    addGoogleMeet: {
      type: "boolean",
      description:
        "True only if the note clearly asks for a virtual/video meeting for this event (e.g. 'video call', 'Google Meet', 'Zoom', 'dial in', 'virtual', 'remote meeting'). False for in-person meetings or when it's not mentioned.",
    },
    clarificationNeeded: {
      type: ["string", "null"],
      description:
        "One short sentence flagging anything you guessed or couldn't find for this event (e.g. no date mentioned, ambiguous time, an attendee's email wasn't in the note). Null if this event was unambiguous.",
    },
  },
  required: [
    "title",
    "description",
    "date",
    "allDay",
    "reminders",
    "attendees",
    "addGoogleMeet",
    "clarificationNeeded",
  ],
};

// Typed loosely (not against Anthropic.Tool) so this file doesn't break if
// the SDK's exported type names shift between versions.
const EXTRACT_EVENTS_TOOL = {
  name: "extract_events",
  description:
    "Record every distinct calendar event described in the user's note, using the exact schema fields provided for each one.",
  input_schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        description:
          "One entry per distinct schedulable item in the note -- a meeting, call, deposition, deadline, or appointment, each with its own title/date/time/attendees/reminders. A note that only contains background, case notes, or to-dos with no scheduling detail should return an empty array -- don't invent an event to fill it.",
        items: EVENT_ITEM_SCHEMA,
      },
    },
    required: ["events"],
  },
};

function buildSystemPrompt(nowLocal: string, timezone: string): string {
  return `You turn a short, informally-written note into every distinct calendar event it describes.

The user's current local date and time is: ${nowLocal} (timezone: ${timezone}).
Resolve all relative dates/times ("tomorrow", "next Thursday", "in two weeks", "eod", "lunchtime") against that moment, in that timezone. If a mentioned time of day has already passed today, assume the user means the next occurrence of that day/time, not today, unless the note clearly says "today".

Rules:
- Return one array entry per distinct schedulable item in the note -- a meeting, call, deposition, deadline, or appointment. A note describing several separate things (e.g. a morning meeting and an unrelated afternoon call) should produce one entry per thing, not one entry that mentions the rest in its description.
- Return an empty array if nothing in the note is schedulable -- don't force a placeholder event just to have something to return.
- Each event's title should be short and human-friendly (e.g. "Deposition prep with Sarah"), not the raw note text.
- Each event's description must add real information beyond what its own title, date/time, duration, attendees, reminders, and video-call/Meet setup already say -- never restate "call/meeting with X" as description text just because someone was named as an attendee, and never restate the time or reminder timing in prose. If the note has nothing further for that event (no agenda, case reference, location, or other detail), leave description as an empty string. Write real description text as natural, complete sentences, not restated fragments of the note.
- Default reminder is one popup 30 minutes before, unless the note specifies reminder timing or method for that event (e.g. "email me a day before", "remind me an hour ahead", "no reminder" -> empty reminders array).
- Attendees: pull out people the note says to meet with, invite, cc, or have attend for that specific event -- including phrasing like "X to attend", "attendees: X, Y", or "X and Y will be there", not just "with X" -- not the note-taker. A name is only an attendee if the note says that person is participating, invited, cc'd, or attending -- a name that appears merely as part of a case/matter name, party name, or subject reference (e.g. "Smith v. Jones", "the Dillon matter", "re: Johnson deposition", a case caption, a docket title) is NOT an attendee unless the note separately says that person is attending or should be invited. When in doubt, leave them out rather than guessing. Only fill in an email if the note literally contains one; otherwise leave email as "" and put their name in "name" exactly as written (e.g. "Sarah", "the Hendricks", "opposing counsel on Mercer") — a name-only attendee gets matched against the user's contacts afterward, so don't guess or fabricate an address.
- addGoogleMeet is true only for an explicitly virtual/video meeting. A note that just says "meeting" or "call" with no virtual cue should leave it false.
- If an event's date/time is genuinely unclear, still include it (don't drop it) -- set date to today (${nowLocal.slice(0, 10)}) if nothing usable was given, and explain in that event's clarificationNeeded that you guessed so the user should check it.

Default scheduling when the note doesn't give an explicit clock time for an event (this decides allDay/startTime/endTime together -- apply exactly one of these three cases):
1. No time information of any kind (no clock time, no "morning"/"afternoon"/"evening"/"night") -- set allDay true, leave startTime/endTime empty.
2. An explicit clock time is given (e.g. "3pm", "10:30am") -- set allDay false, startTime to that time, and endTime to whatever duration the note states, or 60 minutes after startTime if no duration is given. A duration written as a decimal number of hours (e.g. "1.25hrs", "1.5 hours", ".75 hr") means the fractional part of an hour, not minutes -- convert it precisely (fraction x 60, rounded to the nearest minute): 1.25 hours is 1 hour 15 minutes, 1.5 hours is 1 hour 30 minutes, 0.75 hours is 45 minutes. Never read "1.25hrs" as "1 hour 25 minutes".
3. Only a loose part-of-day word is given, no clock time -- set allDay false and use its default start/end window: "morning" -> 09:00-11:59, "afternoon" -> 12:00-16:59, "evening" or "night" -> 17:00-20:00. An explicit duration elsewhere in the note (e.g. "morning meeting, 2 hours") overrides only the window's length, keeping its start time.
- Always call the extract_events tool exactly once with your result. Do not respond in plain text.`;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Math.min(23, parseInt(match[1], 10));
  const m = Math.min(59, parseInt(match[2], 10));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function normalizeEvent(raw: Record<string, unknown>, nowLocal: string): ParsedEvent {
  const allDay = Boolean(raw.allDay);
  const date =
    typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : nowLocal.slice(0, 10);

  const startTime = allDay ? null : normalizeTime(raw.startTime) ?? "09:00";
  let endTime = allDay ? null : normalizeTime(raw.endTime);
  if (!allDay && startTime && !endTime) {
    endTime = addMinutesToTime(startTime, 60);
  }

  const reminders: Reminder[] = Array.isArray(raw.reminders)
    ? (raw.reminders as unknown[])
        .filter(
          (r): r is { method: string; minutesBefore: number } =>
            typeof r === "object" &&
            r !== null &&
            ((r as Record<string, unknown>).method === "popup" ||
              (r as Record<string, unknown>).method === "email") &&
            typeof (r as Record<string, unknown>).minutesBefore === "number"
        )
        .map((r) => ({
          method: r.method as Reminder["method"],
          minutesBefore: Math.max(0, Math.round(r.minutesBefore)),
        }))
    : [{ method: "popup", minutesBefore: 30 }];

  const attendees: Attendee[] = Array.isArray(raw.attendees)
    ? (raw.attendees as unknown[])
        .filter(
          (a): a is { name: unknown; email: unknown } =>
            typeof a === "object" && a !== null && "name" in a
        )
        .map((a) => {
          const name = typeof a.name === "string" ? a.name.trim() : "";
          const emailRaw = typeof a.email === "string" ? a.email.trim() : "";
          const email = EMAIL_RE.test(emailRaw) ? emailRaw : "";
          return { name: name || email, email };
        })
        .filter((a) => a.name)
    : [];

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Untitled note",
    description: typeof raw.description === "string" ? raw.description : "",
    date,
    allDay,
    startTime,
    endTime,
    reminders,
    attendees,
    addGoogleMeet: Boolean(raw.addGoogleMeet),
    clarificationNeeded:
      typeof raw.clarificationNeeded === "string" && raw.clarificationNeeded.trim()
        ? raw.clarificationNeeded.trim()
        : null,
  };
}

/**
 * Extracts every distinct schedulable event from a free-text note. Returns
 * an empty array when nothing in the note is schedulable -- callers should
 * treat that as a valid, non-error result.
 */
export async function parseNoteToEvents(
  noteText: string,
  timezone: string,
  nowISO: string
): Promise<ParsedEvent[]> {
  const nowLocal = new Date(nowISO).toLocaleString("sv-SE", { timeZone: timezone }).replace(" ", "T");

  // Cast the request/response loosely: the exact exported type names for
  // tool definitions and tool_use blocks have moved between SDK minor
  // versions, and this route only needs the shapes it reads below.
  let response: { content: Array<{ type: string; input?: Record<string, unknown> }> };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": getApiKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1536,
        system: buildSystemPrompt(nowLocal, timezone),
        tools: [EXTRACT_EVENTS_TOOL],
        tool_choice: { type: "tool", name: "extract_events" },
        messages: [{ role: "user", content: noteText }],
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data?.error?.message || `Anthropic API request failed (${res.status}).`);
    }
    response = data as { content: Array<{ type: string; input?: Record<string, unknown> }> };
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || !toolUse.input) {
    throw new Error("The note parser didn't return a structured result. Try rephrasing the note.");
  }

  const rawEvents = Array.isArray(toolUse.input.events)
    ? (toolUse.input.events as Record<string, unknown>[])
    : [];

  return rawEvents.map((raw) => normalizeEvent(raw, nowLocal));
}
