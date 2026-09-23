export type EventCardStatus = "draft" | "creating" | "sent" | "error";

export interface Reminder {
  method: "popup" | "email";
  minutesBefore: number;
}

export interface Attendee {
  name: string;
  email: string;
}

export type RuleSetKey = "marcp" | "malandct" | "masuperior" | "maappellate";

export type CourtRuleStatus = "pending" | "confirmed" | "declined";

export interface CourtRulesInfo {
  /** The court name exactly as detected/typed, e.g. "Suffolk Superior Court". */
  detectedCourt: string;
  /** Which rule set the extractor guessed, before the user confirms. */
  suggestedRuleSet: RuleSetKey | null;
  /** The rule set actually in effect -- starts equal to suggestedRuleSet, but the user can change it. */
  ruleSet: RuleSetKey | null;
  /** ISO YYYY-MM-DD date the triggering document was served, or null if not yet known. */
  serviceDate: string | null;
  /** True (the default) unless the note/user says personal/in-hand service -- adds 3 days under Rule 6(d) when true. */
  mailOrElectronicService: boolean;
  /**
   * A short, calendar-ready description of what was served or filed, e.g.
   * "Motion to Dismiss" or "Motion for Summary Judgment" -- drives both the
   * live "Event description" preview (built from this + the service date)
   * and, for a MA Superior Court deadline, whether Rule 9A(b)(1)'s 21-day
   * summary-judgment opposition period applies instead of the general
   * Rule 9A(b)(4) 10-day one (see isSummaryJudgmentMotion in
   * lib/courtRules.ts). Empty string if not yet known.
   */
  documentServed: string;
  /** Docket/case number, if known. Empty string if not yet known. */
  caseNumber: string;
  status: CourtRuleStatus;
}

export interface ParsedEvent {
  title: string;
  description: string;
  /** ISO YYYY-MM-DD */
  date: string;
  allDay: boolean;
  /** 24-hour HH:MM, local time. Null when allDay. */
  startTime: string | null;
  /** 24-hour HH:MM, local time. Null when allDay. */
  endTime: string | null;
  reminders: Reminder[];
  attendees: Attendee[];
  addGoogleMeet: boolean;
  clarificationNeeded: string | null;
  /** Non-null only when this event reads as a MA court/filing deadline. */
  courtRules: CourtRulesInfo | null;
}
