"use client";

import { useState, useRef, useEffect } from "react";
import type { Attendee, CourtRulesInfo, DiscoveryType, ParsedEvent, Reminder, RuleSetKey } from "@/types/event";
import {
  RULE_SET_LABELS,
  RULE_LINKS,
  RULE_6_LINK,
  SUPERIOR_SUMMARY_JUDGMENT_LINK,
  DISCOVERY_LABELS,
  DISCOVERY_LINKS,
  KNOWN_OPPOSITION_DAYS,
  computeDeadline,
  isSummaryJudgmentMotion,
  detectDiscoveryType,
  buildCourtDeadlineDescription,
  parseISODate,
  formatISODate,
  isNonCourtDay,
} from "@/lib/courtRules";
import AttendeesEditor from "./AttendeesEditor";
import RemindersEditor from "./RemindersEditor";
import Banner from "./Banner";

const inputClasses =
  "w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring";

export type EventCardStatus = "draft" | "creating" | "sent" | "error";

// -- Time field: a single click-to-edit range picker (replaces the old
// All-day checkbox + always-visible Start/End boxes), per the approved
// mockup. Duration is no longer its own editable field -- it's a read-only
// caption computed from Start/End, changed only by editing End (or Start,
// which just moves the whole range and leaves the length alone).

function formatTimeDisplay(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return mStr === "00" ? `${h}${ampm}` : `${h}:${mStr}${ampm}`;
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60; // end reads as the next day (e.g. 11pm - 1am)
  return diff;
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes || !hours) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.join(" and ");
}

function timeStringToParts(hhmm: string): { h12: number; m: number; ampm: "AM" | "PM" } {
  const [hStr, mStr] = hhmm.split(":");
  const h24 = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, m, ampm };
}

function partsToTimeString(h12: number, m: number, ampm: "AM" | "PM"): string {
  let h24 = h12 % 12;
  if (ampm === "PM") h24 += 12;
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

/**
 * Calendar-grid date picker and a duration-chip + scrollable-list time
 * picker, per the approved mockup -- replacing the old <select>-based
 * dropdowns. Both stay off native <input type="date"/"time"> for the same
 * reason the old selects were: a native picker renders in the device's OS
 * language regardless of what this page says. Both open as a small
 * anchored popover on desktop and a full-width bottom sheet on phone
 * widths (Tailwind's sm: breakpoint), driven by CSS alone -- same
 * component, same state, no device detection.
 */

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => minutesToTime(i * 15));

const DURATION_CHIPS: { label: string; minutes: number }[] = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
];

function TimeField({
  event,
  disabled,
  onChange,
}: {
  event: ParsedEvent;
  disabled: boolean;
  onChange: (patch: Pick<ParsedEvent, "allDay" | "startTime" | "endTime">) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftAllDay, setDraftAllDay] = useState(event.allDay);
  const [draftStart, setDraftStart] = useState(event.startTime ?? "09:00");
  const [draftEnd, setDraftEnd] = useState(event.endTime ?? "10:00");
  const startListRef = useRef<HTMLDivElement>(null);
  const endListRef = useRef<HTMLDivElement>(null);

  function commitAndClose() {
    setEditing(false);
    if (draftAllDay) {
      onChange({ allDay: true, startTime: null, endTime: null });
    } else {
      onChange({ allDay: false, startTime: draftStart, endTime: draftEnd || draftStart });
    }
  }

  function toggle() {
    if (disabled) return;
    if (editing) {
      commitAndClose();
      return;
    }
    setDraftAllDay(event.allDay);
    setDraftStart(event.startTime ?? "09:00");
    setDraftEnd(event.endTime ?? "10:00");
    setEditing(true);
  }

  function pickStart(value: string) {
    setDraftStart(value);
    if (draftEnd <= value) setDraftEnd(minutesToTime(timeToMinutes(value) + 60));
  }

  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const startEl = startListRef.current;
      const startTarget = startEl?.querySelector<HTMLElement>(`[data-value="${draftStart}"]`);
      if (startEl && startTarget) startEl.scrollTop = startTarget.offsetTop - startEl.clientHeight / 2 + startTarget.offsetHeight / 2;
      const endEl = endListRef.current;
      const endTarget = endEl?.querySelector<HTMLElement>(`[data-value="${draftEnd}"]`);
      if (endEl && endTarget) endEl.scrollTop = endTarget.offsetTop - endEl.clientHeight / 2 + endTarget.offsetHeight / 2;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const displayText = event.allDay
    ? "All day"
    : event.startTime && event.endTime
    ? `${formatTimeDisplay(event.startTime)} – ${formatTimeDisplay(event.endTime)}`
    : null;

  const durationCaption =
    !event.allDay && event.startTime && event.endTime ? formatDuration(minutesBetween(event.startTime, event.endTime)) : "";

  const draftDuration = minutesBetween(draftStart, draftEnd);

  return (
    <div>
      <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commitAndClose(); }}>
        <button type="button" onClick={toggle} disabled={disabled} className={`${inputClasses} truncate text-left ${editing ? "border-indigo-border" : ""}`}>
          {editing ? (draftAllDay ? "All day" : `${formatTimeDisplay(draftStart)} – ${formatTimeDisplay(draftEnd)}`) : displayText ?? <span className="text-ink-faint">Choose time…</span>}
        </button>
        {editing && (
          <>
            <div className="fixed inset-0 z-20 bg-black/50 sm:hidden" onClick={commitAndClose} />
            <div className="fixed inset-x-0 bottom-0 z-30 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-indigo-border/55 bg-bg-elevated p-3 shadow-2xl sm:absolute sm:inset-auto sm:left-0 sm:top-full sm:mt-1.5 sm:max-h-none sm:w-[300px] sm:rounded-lg sm:border sm:border-indigo-border/55 sm:p-3 sm:shadow-xl">
              <div className="mb-2 flex items-center justify-between sm:hidden">
                <span className="text-sm font-semibold text-ink">Select time</span>
                <button type="button" onClick={commitAndClose} className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-sunken text-ink-muted">×</button>
              </div>
              <label className="mb-2.5 flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border bg-bg-sunken accent-indigo-solid" checked={draftAllDay} onChange={(e) => setDraftAllDay(e.target.checked)} />
                All day
              </label>
              {!draftAllDay && (
                <>
                  <div className="mb-2.5 flex gap-1.5">
                    {DURATION_CHIPS.map((chip) => (
                      <button key={chip.label} type="button" onClick={() => setDraftEnd(minutesToTime(timeToMinutes(draftStart) + chip.minutes))} className={`flex-1 rounded-md border px-1 py-1.5 text-[11px] font-semibold ${draftDuration === chip.minutes ? "border-indigo-border bg-indigo-bg text-indigo-text" : "border-border bg-bg-sunken text-ink-muted hover:text-ink"}`}>{chip.label}</button>
                    ))}
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-2 overflow-hidden">
                    <div className="flex flex-col overflow-hidden">
                      <span className="mb-1 pl-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">Start</span>
                      <div ref={startListRef} className="flex-1 overflow-y-auto rounded-md border border-border bg-bg-sunken">
                        {TIME_OPTIONS.map((opt) => (
                          <button key={opt} data-value={opt} type="button" onClick={() => pickStart(opt)} className={`block w-full px-2.5 py-1.5 text-left text-[12.5px] tabular-nums ${opt === draftStart ? "bg-indigo-bg font-bold text-indigo-text" : "text-ink-muted hover:bg-bg-elevated hover:text-ink"}`}>{formatTimeDisplay(opt)}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="mb-1 pl-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">End</span>
                      <div ref={endListRef} className="flex-1 overflow-y-auto rounded-md border border-border bg-bg-sunken">
                        {TIME_OPTIONS.map((opt) => (
                          <button key={opt} data-value={opt} type="button" onClick={() => setDraftEnd(opt)} className={`block w-full px-2.5 py-1.5 text-left text-[12.5px] tabular-nums ${opt === draftEnd ? "bg-indigo-bg font-bold text-indigo-text" : "text-ink-muted hover:bg-bg-elevated hover:text-ink"}`}>{formatTimeDisplay(opt)}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className="mt-2.5 flex items-center justify-between border-t border-border-faint pt-2.5">
                <span className="text-[11px] text-ink-faint">{draftAllDay ? "All day" : formatDuration(draftDuration)}</span>
                <button type="button" onClick={commitAndClose} className="text-xs font-medium text-indigo-text hover:underline">Done</button>
              </div>
            </div>
          </>
        )}
      </div>
      {!editing && durationCaption && <p className="mt-1 px-1 text-xs text-ink-faint">{durationCaption}</p>}
    </div>
  );
}

/**
 * "Sep 24, 2026" -- explicitly en-US and UTC, so this reads the same on
 * every device regardless of the phone/browser's own system language.
 */
function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function DateField({
  value,
  disabled,
  min,
  onChange,
}: {
  value: string;
  disabled: boolean;
  min?: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [viewYear, setViewYear] = useState(0);
  const [viewMonth, setViewMonth] = useState(0);

  function toggle() {
    if (disabled) return;
    if (editing) {
      setEditing(false);
      return;
    }
    const base = value ? parseISODate(value) : new Date();
    setViewYear(base.getUTCFullYear());
    setViewMonth(base.getUTCMonth());
    setEditing(true);
  }

  function pick(iso: string) {
    if (min && iso < min) return;
    onChange(iso);
    setEditing(false);
  }

  function shiftMonth(delta: number) {
    let y = viewYear;
    let m = viewMonth + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewYear(y);
    setViewMonth(m);
  }

  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  if (editing) {
    const first = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startDow = first.getUTCDay();
    for (let i = 0; i < 42; i++) {
      const d = new Date(Date.UTC(viewYear, viewMonth, 1 - startDow + i));
      cells.push({ iso: formatISODate(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === viewMonth });
    }
  }
  const todayIso = formatISODate(new Date());

  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditing(false); }}>
      <button type="button" onClick={toggle} disabled={disabled} lang="en-US" className={`${inputClasses} truncate text-left ${editing ? "border-indigo-border" : ""}`}>
        {value ? formatDateDisplay(value) : <span className="text-ink-faint">Choose date…</span>}
      </button>
      {editing && (
        <>
          <div className="fixed inset-0 z-20 bg-black/50 sm:hidden" onClick={() => setEditing(false)} />
          <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-indigo-border/55 bg-bg-elevated p-3 shadow-2xl sm:absolute sm:inset-auto sm:left-0 sm:top-full sm:mt-1.5 sm:w-[280px] sm:rounded-lg sm:border sm:border-indigo-border/55 sm:p-3 sm:shadow-xl">
            <div className="mb-2 flex items-center justify-between sm:hidden">
              <span className="text-sm font-semibold text-ink">Select date</span>
              <button type="button" onClick={() => setEditing(false)} className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-sunken text-ink-muted">×</button>
            </div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">{MONTH_NAMES[viewMonth]} {viewYear}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => shiftMonth(-1)} className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg-sunken text-ink-muted hover:border-indigo-border hover:text-ink">‹</button>
                <button type="button" onClick={() => shiftMonth(1)} className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg-sunken text-ink-muted hover:border-indigo-border hover:text-ink">›</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-[2px]">
              {DOW_LABELS.map((d, i) => (
                <span key={i} className="pb-1 text-center text-[10px] font-bold uppercase text-ink-faint">{d}</span>
              ))}
              {cells.map((cell) => {
                const isSelected = cell.iso === value;
                const isToday = cell.iso === todayIso;
                const isDisabled = Boolean(min && cell.iso < min);
                const cls = isSelected
                  ? "bg-indigo-solid font-bold text-white"
                  : isDisabled
                  ? "cursor-not-allowed text-ink-faint/40"
                  : isToday
                  ? "border border-indigo-border/60 font-bold text-ink hover:bg-bg-sunken"
                  : cell.inMonth
                  ? "text-ink hover:bg-bg-sunken"
                  : "text-ink-faint/50 hover:bg-bg-sunken";
                return (
                  <button key={cell.iso} type="button" disabled={isDisabled} onClick={() => pick(cell.iso)} className={`aspect-square rounded-md text-[12.5px] ${cls}`}>{cell.day}</button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// -- Video details: shown once the event is actually sent and Google
// returned a Meet link. Phone dial-in + PIN only render when the Workspace
// happens to provision one -- most don't, and there's no way to know before
// the event is created, so (unlike the mockup, which fakes a link the
// instant the checkbox is checked) this only ever shows real data, after a
// real send.

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be blocked (permissions, non-secure context);
      // the button just won't flash "Copied" in that case.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`shrink-0 rounded-md border px-3 py-2 text-xs transition-colors ${
        copied ? "border-success text-success" : "border-border text-ink-muted hover:text-ink"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function VideoDetails({
  meetLink,
  meetPhone,
  meetPin,
}: {
  meetLink: string;
  meetPhone: string | null;
  meetPin: string | null;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-sunken p-3">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">Video link</span>
        <span className="flex-1 truncate text-xs text-ink">{meetLink}</span>
        <CopyButton text={meetLink} />
      </div>
      {meetPhone && (
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-ink-faint">Dial-in</span>
          <span className="flex-1 truncate text-xs text-ink">
            {meetPhone}
            {meetPin ? ` · PIN ${meetPin}` : ""}
          </span>
          <CopyButton text={meetPin ? `${meetPhone}, PIN: ${meetPin}` : meetPhone} />
        </div>
      )}
    </div>
  );
}

// -- Court rules: MA court/filing deadline detection, confirm/decline, and
// Rule 6 computation, per the approved mockup -- extended per follow-up
// feedback with a live "Event description" preview (built from what was
// served + the service date, exactly what gets saved to Google), a
// multi-reminder editor and an attendees editor once confirmed (previously
// neither was exposed for a court-deadline event at all), and a Superior
// Court summary-judgment switch (Rule 9A(b)(1)'s 21-day opposition period
// instead of Rule 9A(b)(4)'s general 10-day one, read off what was
// served). Renders only when event.courtRules is non-null -- an ordinary
// event is completely unaffected by any of this. See
// claude/court-rules-feature-approved-mockup-2026-09-22.md in the project
// for the original approved design and the researched rule citations.

const RULE_SET_ORDER: RuleSetKey[] = ["marcp", "malandct", "masuperior", "maappellate"];

/** The confirmed-cascade's headline label for what's actually due -- most rule sets are an opposition to a motion, but a marcp deadline detected as a discovery response is a response to a request instead, so the label should say what the deadline actually is. */
function responseLabelFor(ruleSet: RuleSetKey, discoveryType: DiscoveryType | null): string {
  if (ruleSet === "marcp") {
    switch (discoveryType) {
      case "interrogatories":
        return "Interrogatory answers due";
      case "production":
        return "Document production due";
      case "admissions":
        return "Response to admissions due";
      default:
        break;
    }
  }
  return "Opposition to motion due";
}

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function sameISODay(a: Date | null, b: Date | null): boolean {
  return Boolean(a && b && formatISODate(a) === formatISODate(b));
}

/** True when a confirmed Superior Court deadline should use Rule 9A(b)(1)'s 21-day summary-judgment track instead of 9A(b)(4)'s general 10-day one -- see isSummaryJudgmentMotion in lib/courtRules.ts. */
function courtRulesIsSummaryJudgment(cr: CourtRulesInfo): boolean {
  return cr.ruleSet === "masuperior" && isSummaryJudgmentMotion(cr.documentServed);
}

/** The discovery device a confirmed marcp deadline's documentServed names, if any -- see detectDiscoveryType in lib/courtRules.ts. Only meaningful (and only ever non-null) when ruleSet is "marcp"; every other rule set's deadline comes from KNOWN_OPPOSITION_DAYS instead. */
function courtRulesDiscoveryType(cr: CourtRulesInfo): DiscoveryType | null {
  return cr.ruleSet === "marcp" ? detectDiscoveryType(cr.documentServed) : null;
}

type DayState = "service" | "service-due" | "due" | "landing" | "counted" | "counted-noncourt" | "outside";

function dayState(date: Date, serviceDate: Date, dueDate: Date, landingDate: Date | null): DayState {
  if (sameISODay(date, serviceDate) && sameISODay(date, dueDate)) return "service-due";
  if (sameISODay(date, serviceDate)) return "service";
  if (sameISODay(date, dueDate)) return "due";
  if (landingDate && sameISODay(date, landingDate)) return "landing";
  if (date.getTime() > serviceDate.getTime() && date.getTime() < dueDate.getTime()) {
    return isNonCourtDay(date) ? "counted-noncourt" : "counted";
  }
  return "outside";
}

function dayCellClasses(state: DayState): string {
  switch (state) {
    case "service":
    case "service-due":
      return "border-indigo-border bg-indigo-bg/50 text-ink font-bold";
    case "due":
      return "border-amber-border bg-amber-bg text-ink font-bold";
    case "landing":
      return "border-dashed border-amber-border text-ink-faint";
    case "counted":
      return "border-transparent bg-sage/[0.24] text-ink";
    case "counted-noncourt":
      return "border-transparent text-ink";
    case "outside":
    default:
      return "border-transparent text-ink-faint";
  }
}

const NONCOURT_STRIPE_STYLE = {
  backgroundImage: "repeating-linear-gradient(45deg, rgb(var(--color-sage) / 0.4) 0 3px, transparent 3px 7px)",
  backgroundColor: "rgb(var(--color-sage) / 0.1)",
} as const;

const NONCOURT_SWATCH_STYLE = {
  backgroundImage: "repeating-linear-gradient(45deg, rgb(var(--color-sage) / 0.55) 0 2px, transparent 2px 5px)",
  backgroundColor: "rgb(var(--color-sage) / 0.12)",
} as const;

function MiniCalendarMonth({
  year,
  month,
  serviceDate,
  dueDate,
  landingDate,
}: {
  year: number;
  month: number;
  serviceDate: Date;
  dueDate: Date;
  landingDate: Date | null;
}) {
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(Date.UTC(year, month, i + 1))),
  ];

  return (
    <div>
      <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-ink-faint">
        {MONTH_NAMES[month]} {year}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {DOW_LABELS.map((label, i) => (
          <span key={i} className="text-center text-[9px] leading-5 text-ink-faint">
            {label}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={i} className="h-[22px] w-[22px]" />;
          const state = dayState(date, serviceDate, dueDate, landingDate);
          return (
            <span
              key={i}
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-md border text-[10.5px] tabular-nums ${dayCellClasses(state)}`}
              style={state === "counted-noncourt" ? NONCOURT_STRIPE_STYLE : undefined}
            >
              {date.getUTCDate()}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({
  serviceDate,
  dueDate,
  landingDate,
}: {
  serviceDate: Date;
  dueDate: Date;
  landingDate: Date | null;
}) {
  if (dueDate.getTime() < serviceDate.getTime()) return null;

  const months: [number, number][] = [];
  let cur = new Date(Date.UTC(serviceDate.getUTCFullYear(), serviceDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), 1));
  while (cur.getTime() <= end.getTime()) {
    months.push([cur.getUTCFullYear(), cur.getUTCMonth()]);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  let showNonCourtSwatch = false;
  for (const [y, m] of months) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      if (dayState(new Date(Date.UTC(y, m, d)), serviceDate, dueDate, landingDate) === "counted-noncourt") {
        showNonCourtSwatch = true;
      }
    }
  }

  let rolledNote: string | null = null;
  if (landingDate && !sameISODay(landingDate, dueDate)) {
    const dow = landingDate.getUTCDay();
    const reason = dow === 0 ? "a Sunday" : dow === 6 ? "a Saturday" : "a legal holiday";
    rolledNote = `The count itself lands on ${formatLongDate(landingDate)} (${reason}) — Rule 6(a) rolls it forward to the next business day, ${formatLongDate(dueDate)}.`;
  } else if (!landingDate && isNonCourtDay(dueDate)) {
    rolledNote = `Heads up — ${formatLongDate(dueDate)} falls on a weekend or holiday. Rule 6(a) would roll a computed deadline forward automatically; a manually entered date won't move on its own.`;
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border-faint bg-bg-elevated p-3">
      <div className="flex flex-wrap gap-4">
        {months.map(([y, m]) => (
          <MiniCalendarMonth
            key={`${y}-${m}`}
            year={y}
            month={m}
            serviceDate={serviceDate}
            dueDate={dueDate}
            landingDate={landingDate}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 shrink-0 rounded border border-indigo-border bg-indigo-bg/50" />
          Service date
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 shrink-0 rounded bg-sage/[0.35]" />
          Days counted
        </span>
        {showNonCourtSwatch && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0 rounded" style={NONCOURT_SWATCH_STYLE} />
            Weekend/holiday
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 shrink-0 rounded border border-amber-border bg-amber-bg" />
          Deadline
        </span>
      </div>
      {rolledNote && <p className="text-[11.5px] leading-relaxed text-ink-muted">{rolledNote}</p>}
    </div>
  );
}

function DetectionBanner({ detectedCourt }: { detectedCourt: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-indigo-border/45 bg-indigo-bg/55 p-3 text-[13px] leading-relaxed text-indigo-text">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div>
        <b className="text-ink">{detectedCourt}</b> detected in this note. Suggested rule set below — confirm it
        before deadlines are calculated.
      </div>
    </div>
  );
}

function PendingRuleSetPicker({
  cr,
  disabled,
  onRuleSetChange,
  onConfirm,
  onDecline,
}: {
  cr: CourtRulesInfo;
  disabled: boolean;
  onRuleSetChange: (value: RuleSetKey) => void;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const selected = cr.ruleSet;
  const isSuggested = selected != null && selected === cr.suggestedRuleSet;
  const isSJ = courtRulesIsSummaryJudgment(cr);
  const discoveryType = courtRulesDiscoveryType(cr);
  const link = selected
    ? isSJ
      ? SUPERIOR_SUMMARY_JUDGMENT_LINK
      : discoveryType
        ? DISCOVERY_LINKS[discoveryType]
        : RULE_LINKS[selected]
    : null;

  return (
    <div className="space-y-2.5 rounded-lg border border-indigo-border/50 bg-bg-sunken p-3.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium uppercase tracking-wide text-ink-faint" htmlFor="court-rule-set">
          Court rules
        </label>
        {isSuggested && (
          <span className="inline-flex items-center gap-1 rounded-pill border border-amber-border bg-amber-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">
            Suggested
          </span>
        )}
      </div>
      <select
        id="court-rule-set"
        className={inputClasses}
        value={selected ?? ""}
        disabled={disabled}
        onChange={(e) => onRuleSetChange(e.target.value as RuleSetKey)}
      >
        <option value="" disabled>
          — Select rule set —
        </option>
        {RULE_SET_ORDER.map((key) => (
          <option key={key} value={key}>
            {RULE_SET_LABELS[key]}
            {key === cr.suggestedRuleSet ? " (suggested)" : ""}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled || !selected}
          className="flex items-center gap-2 rounded-lg border border-indigo-border bg-indigo-bg px-4 py-2.5 text-[13px] font-semibold text-indigo-text transition-opacity hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Confirm rule set &amp; calculate deadlines
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={disabled}
          className="text-xs text-ink-faint underline underline-offset-[3px] hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
        >
          Not a court deadline — skip
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        Nothing is calculated until you confirm — the suggestion is a starting point, not an applied rule.
      </p>
      <div className="space-y-1 border-t border-border-faint pt-2">
        <span className="block text-[10.5px] uppercase tracking-wide text-ink-faint">
          Official rule text for this event
        </span>
               {link ? (
          <a href={link.url} target="_blank" rel="noreferrer" className="block text-xs text-indigo-text underline underline-offset-[3px] hover:brightness-125">
            {link.label}
          </a>
        ) : (
          <span className="block text-xs text-ink-faint">Select a rule set above to see the specific rule that applies.</span>
               )}
        <a href={RULE_6_LINK.url} target="_blank" rel="noreferrer" className="block text-xs text-indigo-text underline underline-offset-[3px] hover:brightness-125">
          {RULE_6_LINK.label}
        </a>
      </div>
    </div>
  );
}

function ConfirmedCascade({
  event,
  cr,
  ruleSet,
  serviceDate,
  disabled,
  onChangeRuleSet,
  onManualDueDateChange,
  onAttendeesChange,
  onRemindersChange,
}: {
  event: ParsedEvent;
  cr: CourtRulesInfo;
  ruleSet: RuleSetKey;
  serviceDate: Date | null;
  disabled: boolean;
  onChangeRuleSet: () => void;
  onManualDueDateChange: (value: string) => void;
  onAttendeesChange: (attendees: Attendee[]) => void;
  onRemindersChange: (reminders: Reminder[]) => void;
}) {
  const isSJ = courtRulesIsSummaryJudgment(cr);
  const discoveryType = courtRulesDiscoveryType(cr);
  const link = isSJ ? SUPERIOR_SUMMARY_JUDGMENT_LINK : discoveryType ? DISCOVERY_LINKS[discoveryType] : RULE_LINKS[ruleSet];
  const deadline = serviceDate
    ? computeDeadline(ruleSet, serviceDate, cr.mailOrElectronicService, isSJ, discoveryType)
    : null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-sunken p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Deadlines — {RULE_SET_LABELS[ruleSet]}
        </span>
        <button
          type="button"
          onClick={onChangeRuleSet}
          disabled={disabled}
          className="text-xs text-indigo-text underline underline-offset-[3px] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change rule set
        </button>
      </div>

      {ruleSet === "masuperior" && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {isSJ
            ? "Detected as a summary-judgment motion — using Rule 9A(b)(1)'s 21-day opposition period instead of the general 10-day track."
            : `Using Rule 9A(b)(4)'s general 10-day opposition period. Mentioning "summary judgment" in the document served below switches this to Rule 9A(b)(1)'s 21-day period.`}
        </p>
      )}

      {ruleSet === "marcp" && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {discoveryType
            ? `Detected as ${DISCOVERY_LABELS[discoveryType]} in "Type of document served" — using its own fixed statewide response period under the Rules of Civil Procedure, regardless of which court the case is in.`
            : `Mass. R. Civ. P. 12(b)(6) doesn't set its own opposition deadline. Naming interrogatories, a request for production, or a request for admissions in "Type of document served" below switches this to that discovery device's fixed response period instead.`}
        </p>
      )}

      <div className="rounded-md border border-border-faint bg-bg-elevated p-3">
        <div className="mb-1 text-[10.5px] uppercase tracking-wide text-ink-faint">Event description</div>
        <p className="text-xs leading-relaxed text-ink">
          {event.description || (
            <span className="text-ink-faint">
              Add the type of document served above to build the calendar description.
            </span>
          )}
        </p>
      </div>

      {deadline && serviceDate ? (
        <>
          <div className="flex items-start justify-between gap-3 rounded-md border border-border-faint bg-bg-elevated p-3">
            <div>
              <div className="text-sm font-medium text-ink">{responseLabelFor(ruleSet, discoveryType)}</div>
                            <div className="mt-0.5 text-xs text-ink-faint">
                <a href={link.url} target="_blank" rel="noreferrer" className="underline underline-offset-[3px] hover:text-ink">
                  {link.label}
                </a>{" "}
                · {deadline.baseDays} days after service
              </div>
              <div className="mt-1 text-[11px] text-sage">
                {deadline.baseDays} days
                {cr.mailOrElectronicService ? " + 3 days for mail/electronic service — Rule 6(d)" : ""} ={" "}
                {deadline.effectiveDays} days, counted under{" "}
                <a href={RULE_6_LINK.url} target="_blank" rel="noreferrer" className="underline underline-offset-[3px]">
                  Rule 6(a)
                </a>
              </div>
            </div>
            <div className="shrink-0 text-sm font-semibold text-amber">{formatLongDate(deadline.due)}</div>
          </div>

          <MiniCalendar
            serviceDate={serviceDate}
            dueDate={deadline.due}
            landingDate={deadline.rolled ? deadline.landing : null}
          />
        </>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs leading-relaxed text-ink-muted">
            {ruleSet === "marcp" && !discoveryType
              ? `${link.label} doesn't itself set an opposition deadline — that's always set by whichever court's own local rules actually apply (Superior Court Rule 9A, Land Court Rule 4, etc.), unless "Type of document served" names a discovery request (interrogatories, request for production, or request for admissions), which has its own fixed response period. Enter the deadline by hand below.`
              : `Enter the date served above to calculate this deadline under ${link.label}.`}
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
              Due date
            </label>
            <DateField
              value={event.date}
              disabled={disabled}
              min={cr.serviceDate ?? undefined}
              onChange={onManualDueDateChange}
            />
          </div>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
          Attendees
        </label>
        <AttendeesEditor attendees={event.attendees} onChange={onAttendeesChange} />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
          Reminders
        </label>
        <RemindersEditor reminders={event.reminders} onChange={onRemindersChange} />
      </div>
    </div>
  );
}

function CourtRulesSection({
  event,
  disabled,
  onChange,
}: {
  event: ParsedEvent;
  disabled: boolean;
  onChange: (event: ParsedEvent) => void;
}) {
  const cr = event.courtRules as CourtRulesInfo;

  function patchCr(patch: Partial<CourtRulesInfo>) {
    onChange({ ...event, courtRules: { ...cr, ...patch } });
  }

  const serviceDate = cr.serviceDate ? parseISODate(cr.serviceDate) : null;

  function recomputeIfConfirmed(nextCr: CourtRulesInfo, nextServiceDate: Date | null) {
    if (nextCr.status !== "confirmed" || !nextCr.ruleSet) {
      onChange({ ...event, courtRules: nextCr });
      return;
    }
    const deadline = nextServiceDate
      ? computeDeadline(
          nextCr.ruleSet,
          nextServiceDate,
          nextCr.mailOrElectronicService,
          courtRulesIsSummaryJudgment(nextCr),
          courtRulesDiscoveryType(nextCr)
        )
      : null;
    onChange({
      ...event,
      date: deadline ? formatISODate(deadline.due) : event.date,
      description: buildCourtDeadlineDescription(nextCr.documentServed, nextCr.serviceDate),
      courtRules: nextCr,
    });
  }

  function handleServiceDateChange(value: string) {
    const nextServiceDate = value ? parseISODate(value) : null;
    recomputeIfConfirmed({ ...cr, serviceDate: value || null }, nextServiceDate);
  }

  function handleDocumentServedChange(value: string) {
    recomputeIfConfirmed({ ...cr, documentServed: value }, serviceDate);
  }

  function handleMailToggle(checked: boolean) {
    recomputeIfConfirmed({ ...cr, mailOrElectronicService: checked }, serviceDate);
  }

  function handleConfirm() {
    if (!cr.ruleSet) return;
    const deadline = serviceDate
      ? computeDeadline(
          cr.ruleSet,
          serviceDate,
          cr.mailOrElectronicService,
          courtRulesIsSummaryJudgment(cr),
          courtRulesDiscoveryType(cr)
        )
      : null;
    const confirmedCr: CourtRulesInfo = { ...cr, status: "confirmed" };
    onChange({
      ...event,
      date: deadline ? formatISODate(deadline.due) : cr.serviceDate ?? event.date,
      description: buildCourtDeadlineDescription(confirmedCr.documentServed, confirmedCr.serviceDate),
      allDay: true,
      startTime: null,
      endTime: null,
      courtRules: confirmedCr,
    });
  }

  function handleDecline() {
    onChange({
      ...event,
      date: cr.serviceDate ?? event.date,
      allDay: false,
      startTime: null,
      endTime: null,
      courtRules: { ...cr, status: "declined" },
    });
  }

  function handleBackToPending() {
    patchCr({ status: "pending" });
  }

  function handleManualDueDateChange(value: string) {
    onChange({ ...event, date: value });
  }

  function handleAttendeesChange(attendees: Attendee[]) {
    onChange({ ...event, attendees });
  }

  function handleRemindersChange(reminders: Reminder[]) {
    onChange({ ...event, reminders });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
            Date served
          </label>
          <DateField value={cr.serviceDate ?? ""} disabled={disabled} onChange={handleServiceDateChange} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
            Type of document served
          </label>
          <input
            type="text"
            className={inputClasses}
            placeholder="e.g. Motion to Dismiss"
            value={cr.documentServed}
            disabled={disabled}
            onChange={(e) => handleDocumentServedChange(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
          Case number
        </label>
        <input
          type="text"
          className={inputClasses}
          placeholder="Not in the note — add it…"
          value={cr.caseNumber}
          disabled={disabled}
          onChange={(e) => patchCr({ caseNumber: e.target.value })}
        />
      </div>

      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-muted">
        <input
          type="checkbox"
          className="mt-0.5 h-[15px] w-[15px] shrink-0 rounded border-border bg-bg-sunken accent-indigo-solid"
          checked={cr.mailOrElectronicService}
          disabled={disabled}
          onChange={(e) => handleMailToggle(e.target.checked)}
        />
        <span>
          Served by mail, email, or the Electronic Filing Service Provider{" "}
          <span className="text-ink-faint">— adds 3 days to every deadline below (Mass. R. Civ. P. 6(d))</span>
        </span>
      </label>

      <DetectionBanner detectedCourt={cr.detectedCourt} />

      {cr.status === "pending" && (
        <PendingRuleSetPicker
          cr={cr}
          disabled={disabled}
          onRuleSetChange={(value) => patchCr({ ruleSet: value })}
          onConfirm={handleConfirm}
          onDecline={handleDecline}
        />
      )}

      {cr.status === "confirmed" && cr.ruleSet && (
        <ConfirmedCascade
          event={event}
          cr={cr}
          ruleSet={cr.ruleSet}
          serviceDate={serviceDate}
          disabled={disabled}
          onChangeRuleSet={handleBackToPending}
          onManualDueDateChange={handleManualDueDateChange}
          onAttendeesChange={handleAttendeesChange}
          onRemindersChange={handleRemindersChange}
        />
      )}
    </div>
  );
}

/**
 * One independently-editable, independently-sendable event card. This is
 * the multi-event evolution of the old single-note ConfirmEventCard: same
 * fields and validation, but each instance owns its own send/success/error
 * state instead of the whole page moving through one shared phase. "Back to
 * note" doesn't apply here (the note stays visible at all times), so it's
 * replaced with "Delete event", which drops just this (not-yet-sent) card.
 * A card that's already been sent stays on screen even if its note text is
 * later removed entirely -- deleting the real calendar event isn't
 * something this button does.
 */
export default function EventCard({
  event,
  status,
  error,
  dirty,
  meetLink,
  meetPhone,
  meetPin,
  htmlLink,
  onChange,
  onSend,
  onDismiss,
}: {
  event: ParsedEvent;
  status: EventCardStatus;
  error: string | null;
  /**
   * True when this card was already sent to Google Calendar, but the note
   * has since been edited in a way that changes this same event -- e.g. the
   * user changed the time or added an attendee in the note text. The card
   * stays showing the real, already-created event until "Update event" is
   * clicked, rather than a second card being created alongside it.
   */
  dirty: boolean;
  meetLink: string | null;
  meetPhone: string | null;
  meetPin: string | null;
  htmlLink: string | null;
  onChange: (event: ParsedEvent) => void;
  onSend: () => void;
  onDismiss: () => void;
}) {
  function set<K extends keyof ParsedEvent>(key: K, value: ParsedEvent[K]) {
    onChange({ ...event, [key]: value });
  }

  const sent = status === "sent";
  const sending = status === "creating";
  const cr = event.courtRules;
  const showStandardFields = !cr || cr.status === "declined";
  const canSubmit =
    !sending &&
    Boolean(event.title.trim()) &&
    Boolean(event.date) &&
    !event.attendees.some((a) => !a.email) &&
    cr?.status !== "pending";

  return (
    <section
      className={`space-y-5 rounded-[10px] border p-5 md:p-6 ${
        sent ? "border-sage/40 bg-bg-elevated/60" : "border-border bg-bg-elevated"
      }`}
    >
      {sent && !dirty && (
        <Banner variant="success">
          Added to your calendar.
          {htmlLink && (
            <>
              {" "}
              <a href={htmlLink} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                View in Calendar
              </a>
            </>
          )}
        </Banner>
      )}
      {sent && dirty && (
        <Banner variant="info">
          This event changed in your note since it was added to your calendar. Click "Update event" to sync
          the change, or leave it and the calendar keeps today's original details.
        </Banner>
      )}
      {!sent && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-xs font-semibold uppercase tracking-[0.08em] text-indigo-text">
            {event.title.trim() || "Untitled event"}
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            disabled={sending}
            className="shrink-0 text-xs text-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete event
          </button>
        </div>
      )}

      {error && <Banner variant="danger">{error}</Banner>}

      <fieldset disabled={sent || sending} className="space-y-5 disabled:opacity-60">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
            Title
          </label>
          <input
            className={inputClasses}
            value={event.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Event title"
          />
        </div>

        {showStandardFields ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Date
              </label>
              <DateField
                value={event.date}
                disabled={sent || sending}
                onChange={(v) => set("date", v)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Time
              </label>
              <TimeField
                event={event}
                disabled={sent || sending}
                onChange={(patch) => onChange({ ...event, ...patch })}
              />
            </div>
          </div>
        ) : (
          <CourtRulesSection event={event} disabled={sent || sending} onChange={onChange} />
        )}

        {showStandardFields && (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Notes
              </label>
              <textarea
                className={`${inputClasses} min-h-[72px] resize-y`}
                value={event.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Optional details"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Attendees
              </label>
              <AttendeesEditor attendees={event.attendees} onChange={(a) => set("attendees", a)} />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-2.5 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border bg-bg-sunken accent-indigo-solid"
                  checked={event.addGoogleMeet}
                  onChange={(e) => set("addGoogleMeet", e.target.checked)}
                />
                Add video link and conference call number
              </label>
              {!sent && event.addGoogleMeet && (
                <p className="pl-6 text-xs text-ink-faint">
                  Google generates the link (and a dial-in number, if your Workspace provides one) once this
                  event is actually created — shown here right after you send it.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Reminders
              </label>
              <RemindersEditor reminders={event.reminders} onChange={(r) => set("reminders", r)} />
            </div>
          </>
        )}
      </fieldset>

      {sent && meetLink && <VideoDetails meetLink={meetLink} meetPhone={meetPhone} meetPin={meetPin} />}

      {cr?.status === "declined" && !sent && (
        <button
          type="button"
          onClick={() => onChange({ ...event, courtRules: { ...cr, status: "pending" } })}
          disabled={sending}
          className="-mt-2 text-xs text-ink-faint underline underline-offset-[3px] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Treat as a court deadline instead
        </button>
      )}

      {cr?.status === "pending" && (
        <p className="-mt-2 text-xs text-ink-faint">
          Confirm a rule set or skip court-deadline treatment above before adding this to your calendar.
        </p>
      )}

      {(!sent || dirty) && (
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onSend}
            disabled={!canSubmit}
            className="rounded-[10px] border border-indigo-border bg-indigo-bg px-6 py-2.5 text-sm font-semibold text-indigo-text transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
          >
            {sending ? (sent ? "Updating…" : "Adding…") : sent ? "Update event" : "Add to Calendar"}
          </button>
        </div>
      )}
      {(!sent || dirty) && event.attendees.some((a) => !a.email) && (
        <p className="-mt-2 text-xs text-danger">
          Fix or remove the unmatched attendee above before sending.
        </p>
      )}
    </section>
  );
}
