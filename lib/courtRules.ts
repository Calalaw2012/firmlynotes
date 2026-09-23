import type { RuleSetKey } from "@/types/event";

/**
 * Massachusetts court-deadline computation, per Mass. R. Civ. P. 6 layered
 * under whichever trial/appellate court rule set applies. This module is
 * pure and has no dependency on the extraction pipeline or the UI -- it's
 * the same engine the approved mockup used, generalized to work in any
 * year instead of a hardcoded 2026 holiday list.
 *
 * See claude/court-rules-feature-approved-mockup-2026-09-22.md in the
 * project for the approved design and the researched citations below.
 */

// -- Rule-set metadata -------------------------------------------------

export const RULE_SET_LABELS: Record<RuleSetKey, string> = {
  marcp: "MA Rules of Civil Procedure",
  malandct: "MA Land Court Rules",
  masuperior: "MA Superior Court Rules",
  maappellate: "MA Rules of Appellate Procedure",
};

export const RULE_LINKS: Record<RuleSetKey, { label: string; url: string }> = {
  marcp: {
    label: "Mass. R. Civ. P. 12(b)(6) — Motion to Dismiss",
    url: "https://www.mass.gov/rules-of-civil-procedure/civil-procedure-rule-12-defenses-and-objections-when-and-how-presented-by-pleading-or-motion-motion-for-judgment-on-pleadings",
  },
  malandct: {
    label: "Land Court Rule 4 — Motions Under Mass. R. Civ. P. 12(b)(1), 12(b)(6), 12(c) or 56",
    url: "https://www.mass.gov/land-court-rules/land-court-rule-4-motions-under-mass-r-civ-p-12b1-12b6-12c-or-56",
  },
  masuperior: {
    label: "Superior Court Rule 9A(b)(4) — Civil Motions",
    url: "https://www.mass.gov/superior-court-rules/superior-court-rule-9a-civil-motions",
  },
  maappellate: {
    label: "Appellate Procedure Rule 15(a) — Motions",
    url: "https://www.mass.gov/rules-of-appellate-procedure/appellate-procedure-rule-15-motions",
  },
};

/**
 * Superior Court's *other* motion track: Rule 9A(b)(1) gives a summary-
 * judgment motion a longer, 21-day opposition period instead of 9A(b)(4)'s
 * general 10-day one (see RULE_LINKS.masuperior / KNOWN_OPPOSITION_DAYS
 * above). Same rule (9A), same citation page -- just a different
 * subsection and day count, switched in by isSummaryJudgmentMotion.
 */
export const SUPERIOR_SUMMARY_JUDGMENT_LINK = {
  label: "Superior Court Rule 9A(b)(1) — Summary Judgment",
  url: "https://www.mass.gov/superior-court-rules/superior-court-rule-9a-civil-motions",
};

export const RULE_6_LINK = {
  label: "Mass. R. Civ. P. 6 — Time",
  url: "https://www.mass.gov/rules-of-civil-procedure/civil-procedure-rule-6-time",
};

/**
 * The general-motion opposition period for each rule set, in days after
 * service, researched and verified against mass.gov during the mockup's
 * development. "marcp" is deliberately absent: Rule 12(b)(6) itself sets
 * no opposition deadline -- that's always set by whichever court's local
 * rules actually apply (9A, Land Court Rule 4, etc.), so there is no
 * single day count to show for it. See the "marcp" branch of
 * ConfirmedCascade in components/EventCard.tsx for how that structural
 * non-case is surfaced to the user.
 *
 * masuperior here is specifically Rule 9A(b)(4)'s *general*-motion track.
 * A summary-judgment motion runs the longer, 21-day track under Rule
 * 9A(b)(1) instead -- see SUPERIOR_SUMMARY_JUDGMENT_DAYS and
 * isSummaryJudgmentMotion, which computeDeadline consults to pick between
 * the two whenever ruleSet is "masuperior".
 */
export const KNOWN_OPPOSITION_DAYS: Partial<Record<RuleSetKey, number>> = {
  masuperior: 10,
  malandct: 30,
  maappellate: 7,
};

/**
 * Rule 9A(b)(1)'s opposition period for a summary-judgment motion
 * specifically, in days after service -- longer than 9A(b)(4)'s general
 * 10-day motion track. Only meaningful when ruleSet is "masuperior"; see
 * computeDeadline.
 */
export const SUPERIOR_SUMMARY_JUDGMENT_DAYS = 21;

/**
 * True when the document served looks like a summary-judgment motion, by
 * a simple, deliberately narrow text match ("summary judgment" appearing
 * anywhere in the document-served field, case-insensitive, regardless of
 * spacing). Used to switch a Superior Court deadline from Rule 9A(b)(4)'s
 * general 10-day opposition period to Rule 9A(b)(1)'s 21-day one --
 * nothing else in the extraction schema reliably distinguishes the two,
 * so this reads the same field the confirmed-state card now shows a live
 * description preview for (see buildCourtDeadlineDescription below).
 */
export function isSummaryJudgmentMotion(documentServed: string): boolean {
  return /summary\s*judgment/i.test(documentServed);
}

// -- Massachusetts legal holidays, any year -----------------------------
//
// Per G.L. c. 4, § 9 and the standard "nearest weekday" observance
// convention courts actually use: a fixed-date holiday that falls on
// Sunday is observed the following Monday; one that falls on Saturday is
// observed the preceding Friday (this matters for court purposes even
// though the Saturday itself is already a non-court day -- it's the
// Friday that becomes an additional closed day). The floating
// Monday/Thursday holidays never need a shift by construction.

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
}

function observedFixedDate(year: number, month: number, day: number): Date {
  const d = new Date(Date.UTC(year, month, day));
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sunday -> Monday
  else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); // Saturday -> Friday
  return d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Massachusetts legal holidays observed by the courts, for a given year. */
export function getMALegalHolidays(year: number): Set<string> {
  return new Set(
    [
      observedFixedDate(year, 0, 1), // New Year's Day
      nthWeekdayOfMonth(year, 0, 1, 3), // MLK Day -- 3rd Monday of January
      nthWeekdayOfMonth(year, 1, 1, 3), // Washington's Birthday -- 3rd Monday of February
      nthWeekdayOfMonth(year, 3, 1, 3), // Patriots' Day -- 3rd Monday of April (MA-specific)
      lastWeekdayOfMonth(year, 4, 1), // Memorial Day -- last Monday of May
      observedFixedDate(year, 5, 19), // Juneteenth
      observedFixedDate(year, 6, 4), // Independence Day
      nthWeekdayOfMonth(year, 8, 1, 1), // Labor Day -- 1st Monday of September
      nthWeekdayOfMonth(year, 9, 1, 2), // Columbus Day / Indigenous Peoples' Day -- 2nd Monday of October
      observedFixedDate(year, 10, 11), // Veterans Day
      nthWeekdayOfMonth(year, 10, 4, 4), // Thanksgiving -- 4th Thursday of November
      observedFixedDate(year, 11, 25), // Christmas
    ].map(iso)
  );
}

/** True for a Saturday, Sunday, or MA legal holiday -- i.e. not a court day. */
export function isNonCourtDay(date: Date, holidays?: Set<string>): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return true;
  const set = holidays ?? getMALegalHolidays(date.getUTCFullYear());
  return set.has(iso(date));
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Parses a YYYY-MM-DD string as a UTC date (matches how <input type="date"> values are stored throughout this app). */
export function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatISODate(date: Date): string {
  return iso(date);
}

/** "September 22, 2026" -- the fuller, non-abbreviated form used in the calendar description text (formatLongDate in EventCard.tsx stays the short "Mon, Sep 22" form used everywhere else in the UI). */
export function formatFullDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Builds the calendar-event description for a court deadline, from
 * exactly the two fields the confirmed-state card shows a live preview
 * of: what was served, and when. This is the single source of truth for
 * that description -- both the card's live preview and the value actually
 * saved to event.description call this, so they can never drift apart.
 * Empty string (matching a normal event's "no description") when neither
 * field has anything yet.
 */
export function buildCourtDeadlineDescription(documentServed: string, serviceDateISO: string | null): string {
  const doc = documentServed.trim();
  const servicePart = serviceDateISO ? formatFullDate(parseISODate(serviceDateISO)) : null;
  if (doc && servicePart) return `${doc} served ${servicePart}.`;
  if (doc) return `${doc} served.`;
  if (servicePart) return `Served ${servicePart}.`;
  return "";
}

export interface Rule6Result {
  /** Where the raw count lands, before any roll-forward for a non-court day. */
  landing: Date;
  /** The actual due date, after Rule 6(a)'s roll-forward. */
  due: Date;
  /** True when landing and due differ -- i.e. the raw count landed on a non-court day. */
  rolled: boolean;
}

/**
 * Mass. R. Civ. P. 6(a): the day of the triggering act is never counted.
 * If the prescribed period is less than 7 days, intermediate Saturdays,
 * Sundays, and legal holidays are skipped entirely when counting -- each
 * such day doesn't advance the count. Periods of 7 days or more are
 * counted in ordinary calendar days instead. Either way, once the count
 * lands, a final day that falls on a Saturday, Sunday, or legal holiday
 * rolls forward to the next day that is none of those.
 */
export function computeRule6Result(serviceDate: Date, prescribedDays: number): Rule6Result {
  // A deadline can straddle two different years' holiday calendars (a
  // service date in late December with a 30-day period, say) -- build one
  // combined set spanning the service year through a couple of years past
  // the landing, cheap enough to just always include a small buffer.
  const holidays = new Set<string>([
    ...getMALegalHolidays(serviceDate.getUTCFullYear()),
    ...getMALegalHolidays(serviceDate.getUTCFullYear() + 1),
  ]);

  let cursor = serviceDate;
  if (prescribedDays < 7) {
    let count = 0;
    while (count < prescribedDays) {
      cursor = addDays(cursor, 1);
      if (!isNonCourtDay(cursor, holidays)) count++;
    }
  } else {
    cursor = addDays(cursor, prescribedDays);
  }

  const landing = cursor;
  let due = cursor;
  while (isNonCourtDay(due, holidays)) {
    due = addDays(due, 1);
  }
  return { landing, due, rolled: landing.getTime() !== due.getTime() };
}

/**
 * Full computation for a rule set + service date, applying Rule 6(d)'s +3
 * days for mail/email/EFSP service before running the Rule 6(a) count.
 * Returns null when the rule set has no known day count (marcp) or the
 * service date is missing -- callers should show the manual-entry / no-
 * deadline-of-its-own explanation in that case instead.
 *
 * isSummaryJudgment (default false) only matters when ruleSet is
 * "masuperior": true switches the base day count from Rule 9A(b)(4)'s
 * general 10 days to Rule 9A(b)(1)'s 21 days for a summary-judgment
 * motion. Callers pass isSummaryJudgmentMotion(cr.documentServed).
 */
export function computeDeadline(
  ruleSet: RuleSetKey,
  serviceDate: Date,
  mailOrElectronicService: boolean,
  isSummaryJudgment: boolean = false
): (Rule6Result & { effectiveDays: number; baseDays: number }) | null {
  const baseDays =
    ruleSet === "masuperior" && isSummaryJudgment ? SUPERIOR_SUMMARY_JUDGMENT_DAYS : KNOWN_OPPOSITION_DAYS[ruleSet];
  if (baseDays == null) return null;
  const effectiveDays = mailOrElectronicService ? baseDays + 3 : baseDays;
  return { ...computeRule6Result(serviceDate, effectiveDays), effectiveDays, baseDays };
}
