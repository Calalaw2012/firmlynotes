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

// Typed loosely (not against Anthropic.Tool) so this file doesn't break if
// the SDK's exported type names shift between versions.
const EXTRACT_EVENT_TOOL = {
  name: "extract_event",
  description:
    "Record the calendar event extracted from the user's note, using the exact schema fields provided.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "A short, calendar-friendly event title (a few words, not the whole note).",
      },
      description: {
        type: "string",
        description:
          "Any substantive detail from the note beyond the title, date/time, and attendee list -- e.g. an agenda item, case/matter reference, location, or instruction. Never restate who is attending or invent filler like 'call scheduled with X' or 'meeting with X' -- the title and attendee list already cover that, and repeating it is not real content. Empty string if the note says nothing beyond who/when.",
      },
      date: {
        type: "string",
        description: "Event date resolved to an absolute calendar date, formatted YYYY-MM-DD.",
      },
      allDay: {
        type: "boolean",
        description: "True only if the note clearly describes an all-day item with no specific time.",
      },
      startTime: {
        type: "string",
        description: "24-hour HH:MM start time, local to the user's timezone. Omit/empty if allDay is true.",
      },
      endTime: {
        type: "string",
        description:
          "24-hour HH:MM end time, local to the user's timezone. If the note gives a duration instead of an end time, compute it from startTime. Default to 60 minutes after startTime if nothing indicates duration. Omit/empty if allDay is true.",
      },
      reminders: {
        type: "array",
        description:
          "Reminders to set. If the note specifies none, default to a single popup reminder 30 minutes before.",
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
          "People to actually invite to the event -- extracted ONLY from phrases that clearly show participation, like 'with Sarah', 'invite the Hendricks', 'cc opposing counsel', 'meet with John', 'Monica and Peter to attend', 'attendees: Monica, Peter', 'X and Y will be there'. A person's name showing up elsewhere in the note -- as part of a case/matter name, party name, or subject line (e.g. 'Smith v. Jones', 'the Dillon matter', 're: Johnson deposition') -- is NOT by itself a reason to add them as an attendee. Only add someone if the note separately indicates they are attending, being invited, or cc'd. Do not include the note-taker themselves.",
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
          "True only if the note clearly asks for a virtual/video meeting (e.g. 'video call', 'Google Meet', 'Zoom', 'dial in', 'virtual', 'remote meeting'). False for in-person meetings or when it's not mentioned.",
      },
      clarificationNeeded: {
        type: ["string", "null"],
        description:
          "One short sentence flagging anything you guessed or couldn't find (e.g. no date mentioned, ambiguous time, an attendee's email wasn't in the note). Null if the note was unambiguous.",
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
  },
};

function buildSystemPrompt(nowLocal: string, timezone: string): string {
  return `You turn a short, informally-written note into a single calendar event.

The user's current local date and time is: ${nowLocal} (timezone: ${timezone}).
Resolve all relative dates/times ("tomorrow", "next Thursday", "in two weeks", "eod", "lunchtime") against that moment, in that timezone. If a mentioned time of day has already passed today, assume the user means the next occurrence of that day/time, not today, unless the note clearly says "today".

Rules:
- Extract exactly one event. If the note lists multiple, use the first/primary one and mention the rest in "description".
- Title should be short and human-friendly (e.g. "Deposition prep with Sarah"), not the raw note text.
- description must add real information beyond the title and attendee list -- never restate "call/meeting with X" as description text just because someone was named as an attendee. If the note has nothing further (no agenda, case reference, location, or other detail beyond who and when), leave description as an empty string.
- Default event length is 60 minutes when no end time or duration is given.
- Default reminder is one popup 30 minutes before, unless the note specifies reminder timing or method (e.g. "email me a day before", "remind me an hour ahead", "no reminder" -> empty reminders array).
- Attendees: pull out people the note says to meet with, invite, cc, or have attend -- including phrasing like "X to attend", "attendees: X, Y", or "X and Y will be there", not just "with X" -- not the note-taker. A name is only an attendee if the note says that person is participating, invited, cc'd, or attending -- a name that appears merely as part of a case/matter name, party name, or subject reference (e.g. "Smith v. Jones", "the Dillon matter", "re: Johnson deposition", a case caption, a docket title) is NOT an attendee unless the note separately says that person is attending or should be invited. When in doubt, leave them out rather than guessing. Only fill in an email if the note literally contains one; otherwise leave email as "" and put their name in "name" exactly as written (e.g. "Sarah", "the Hendricks", "opposing counsel on Mercer") — a name-only attendee gets matched against the user's contacts afterward, so don't guess or fabricate an address.
- addGoogleMeet is true only for an explicitly virtual/video meeting. A note that just says "meeting" or "call" with no virtual cue should leave it false.
- If the note genuinely gives no usable date/time, set date to today (${nowLocal.slice(0, 10)}) and allDay to true, and explain in clarificationNeeded that no date or time was found so the user should check it.
- Always call the extract_event tool exactly once with your result. Do not respond in plain text.`;
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

export async function parseNoteToEvent(
  noteText: string,
  timezone: string,
  nowISO: string
): Promise<ParsedEvent> {
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
        max_tokens: 1024,
        system: buildSystemPrompt(nowLocal, timezone),
        tools: [EXTRACT_EVENT_TOOL],
        tool_choice: { type: "tool", name: "extract_event" },
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

  const raw = toolUse.input;

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

const TAG_SENTENCES_TOOL = {
  name: "tag_sentences",
  description:
    "Identify which of the numbered sentences describe a specific scheduling instruction that should become a calendar event.",
  input_schema: {
    type: "object",
    properties: {
      calendarIndices: {
        type: "array",
        description:
          "0-based indices into the numbered sentence list, in any order, for every sentence that is part of a scheduling instruction: a meeting, call, deadline, or appointment with a clear time reference or scheduling intent (a date, day, time of day, or phrase like 'tomorrow', 'next week', 'by Friday'). Usually zero or one index. Include more than one only when the scheduling detail genuinely spans multiple adjacent sentences (e.g. one sentence names who and where, the next gives the time). A name appearing only as part of a case or matter reference is not by itself a scheduling instruction. Empty array if no sentence describes anything schedulable.",
        items: { type: "integer" },
      },
    },
    required: ["calendarIndices"],
  },
};

function buildTagSystemPrompt(): string {
  return `You are given a note broken into numbered sentences (0-indexed). Find the sentence(s) that describe a specific meeting, call, deadline, or appointment worth putting on a calendar -- something with a date, day, time, or clear scheduling intent. Sentences that are just background, case notes, or to-dos with no scheduling detail are not calendar sentences. Call the tag_sentences tool exactly once with your result. When nothing in the note is schedulable, return an empty array -- don't guess.`;
}

/**
 * Lightweight companion to parseNoteToEvent: given a note already split
 * into sentences, flags which ones look like the scheduling instruction so
 * the composer can pre-highlight them before the user taps "Process Note".
 * Kept as a separate, smaller tool call rather than reusing extract_event
 * so it stays fast enough to run automatically while the user is typing.
 */
export async function tagCalendarSentences(sentences: string[]): Promise<number[]> {
  if (sentences.length === 0) return [];

  const numbered = sentences.map((s, i) => `${i}: ${s}`).join("\n");

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
        max_tokens: 256,
        system: buildTagSystemPrompt(),
        tools: [TAG_SENTENCES_TOOL],
        tool_choice: { type: "tool", name: "tag_sentences" },
        messages: [{ role: "user", content: numbered }],
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
  const raw = toolUse?.input?.calendarIndices;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n))
    .filter((n) => n >= 0 && n < sentences.length);
}
