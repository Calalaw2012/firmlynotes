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
 * The four Massachusetts rule sets the court-rules cascade knows how to
 * compute a deadline under. "marcp" (the bare Rules of Civil Procedure) has
 * no opposition period of its own -- see lib/courtRules.ts -- but still
 * needs a key so the dropdown and citation link can point at it.
 */
export type RuleSetKey = "marcp" | "malandct" | "masuperior" | "maappellate";

/**
 * Present on a ParsedEvent only when the note appears to describe a
 * Massachusetts court or filing deadline. Everything here is additive to
 * the plain EventCard -- when this is null, the card behaves exactly as it
 * always has. See claude/court-rules-feature-approved-mockup-2026-09-22.md
 * in the project for the approved design this implements.
 */
export interface CourtRulesInfo {
  /** The court name as it appeared in the note (e.g. "Suffolk Superior Court"), for the detection banner. */
  detectedCourt: string;
  /** The rule set the extractor suggested based on detectedCourt. Never auto-applied -- the user must confirm. */
  suggestedRuleSet: RuleSetKey | null;
  /** The rule set actually selected in the dropdown -- defaults to suggestedRuleSet, but the user can change it before confirming. */
  ruleSet: RuleSetKey | null;
  /** The date served/filed, as stated in the note (YYYY-MM-DD). Drives the Rule 6 computation. Null if the note didn't give one -- the user fills it in by hand. */
  serviceDate: string | null;
  /** Rule 6(d): whether service was by mail, email, or the EFSP (+3 days). Defaults true (the common case); the extractor sets it false only when the note clearly says personal/in-hand service. */
  mailOrElectronicService: boolean;
  /**
   * What was served/filed -- e.g. "Motion to Dismiss", "Motion for Summary
   * Judgment", "Interrogatories" -- filled in from the note when it says so
   * (same no-fabrication rule as serviceDate), and editable by hand
   * otherwise. Paired with serviceDate to build the confirmed event's
   * calendar description (buildCourtDeadlineDescription in
   * lib/courtRules.ts), and checked for "summary judgment" to switch the
   * Superior Court track from Rule 9A(b)(4)'s 10-day opposition period to
   * Rule 9A(b)(1)'s 21-day one (see isSummaryJudgmentMotion).
   */
  documentServed: string;
  /**
   * A reference field only -- never sent to Google Calendar, never
   * auto-injected into description. Purely for the user's own use while
   * confirming the deadline, per the approved mockup's "don't pre-fill any
   * data except court and rule deadlines relevant to the entry" rule.
   */
  caseNumber: string;
  /**
   * pending: the detection banner + rule-set picker are showing, nothing computed yet.
   * confirmed: the deadline cascade is showing; event.date holds the computed due date.
   * declined: the user said this isn't a court deadline -- the card looks like a normal EventCard, and event.date/allDay hold whatever a normal event would (defaulted to serviceDate once, on decline, if one was known).
   */
  status: "pending" | "confirmed" | "declined";
}

/**
 * Structured event data extracted from a free-text note.
 * Produced by /api/parse-note, edited by the user in the event card,
 * then sent to /api/create-event.
 */
export interface ParsedEvent {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD -- once courtRules.status === "confirmed", this is the computed due date, not the service date.
  allDay: boolean;
  startTime: string | null; // HH:MM, 24hr, null when allDay
  endTime: string | null; // HH:MM, 24hr, null when allDay
  reminders: Reminder[];
  attendees: Attendee[];
  addGoogleMeet: boolean;
  /** Short note to the user about anything the parser guessed or couldn't find. */
  clarificationNeeded: string | null;
  /** Null for an ordinary event. Present when the note appears to describe a MA court/filing deadline -- see CourtRulesInfo. */
  courtRules: CourtRulesInfo | null;
}

/**
 * A note can describe more than one schedulable item -- /api/parse-note
 * returns every distinct event it found, in note order. An empty array is
 * a valid result: it means nothing in the note looked schedulable.
 */
export interface ParseNoteResult {
  events: ParsedEvent[];
}

export interface CreatedEvent {
  htmlLink: string;
  id: string;
  meetLink: string | null;
  /**
   * Dial-in phone number and PIN for the created Meet conference, when
   * Google's response includes them -- only present when the signed-in
   * Workspace's calling plan actually provisions phone dial-in for Meet.
   * Null (not an error) when there's no video conference on the event, or
   * when there is one but the Workspace has no telephony entry point.
   */
  meetPhone: string | null;
  meetPin: string | null;
}
