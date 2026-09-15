export type ReminderMethod = "popup" | "email";

export interface Reminder {
  method: ReminderMethod;
  minutesBefore: number;
}

/**
 * A meeting attendee. `email` is the source of truth for what gets sent to
 * Google — `name` is display-only. An attendee the AI extracted from a note
 * by name only (no email in the text) starts with email: "" and is resolved
 * against the user's Google contacts, either automatically or by the user
 * picking a match in the confirm card.
 */
export interface Attendee {
  name: string;
  email: string;
}

/**
 * Structured event data extracted from a free-text note.
 * Produced by /api/parse-note, edited by the user in the confirm card,
 * then sent to /api/create-event.
 */
export interface ParsedEvent {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  startTime: string | null; // HH:MM, 24hr, null when allDay
  endTime: string | null; // HH:MM, 24hr, null when allDay
  reminders: Reminder[];
  attendees: Attendee[];
  addGoogleMeet: boolean;
  /** Short note to the user about anything the parser guessed or couldn't find. */
  clarificationNeeded: string | null;
}

export interface CreatedEvent {
  htmlLink: string;
  id: string;
  meetLink: string | null;
}
