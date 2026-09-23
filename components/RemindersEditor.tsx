"use client";

import type { Reminder } from "@/types/event";

// The free add/remove multi-reminder editor -- click a preset chip below
// to add a reminder, click an added reminder to toggle popup/email, click
// its × to remove it. Replaces the single-preset <select> dropdown
// (ReminderPicker, formerly in components/EventCard.tsx) everywhere a
// reminder is edited, including the court-rules confirmed-state cascade,
// which didn't expose reminders at all before now.
const PRESETS: { label: string; minutesBefore: number }[] = [
  { label: "At time of event", minutesBefore: 0 },
  { label: "5 min before", minutesBefore: 5 },
  { label: "10 min before", minutesBefore: 10 },
  { label: "15 min before", minutesBefore: 15 },
  { label: "30 min before", minutesBefore: 30 },
  { label: "1 hour before", minutesBefore: 60 },
  { label: "2 hours before", minutesBefore: 120 },
  { label: "1 day before", minutesBefore: 24 * 60 },
  { label: "2 days before", minutesBefore: 2 * 24 * 60 },
  { label: "1 week before", minutesBefore: 7 * 24 * 60 },
];

function reminderLabel(r: Reminder): string {
  const m = r.minutesBefore;
  let time: string;
  if (m === 0) {
    time = "At time of event";
  } else if (m % (7 * 24 * 60) === 0) {
    const weeks = m / (7 * 24 * 60);
    time = `${weeks} week${weeks > 1 ? "s" : ""} before`;
  } else if (m % (24 * 60) === 0) {
    const days = m / (24 * 60);
    time = `${days} day${days > 1 ? "s" : ""} before`;
  } else if (m % 60 === 0) {
    const hours = m / 60;
    time = `${hours} hr${hours > 1 ? "s" : ""} before`;
  } else {
    time = `${m} min before`;
  }
  return `${time} · ${r.method}`;
}

export default function RemindersEditor({
  reminders,
  onChange,
}: {
  reminders: Reminder[];
  onChange: (reminders: Reminder[]) => void;
}) {
  function addPreset(minutesBefore: number) {
    if (reminders.some((r) => r.minutesBefore === minutesBefore && r.method === "popup")) return;
    onChange([...reminders, { method: "popup", minutesBefore }]);
  }

  function toggleMethod(index: number) {
    const next = reminders.slice();
    next[index] = {
      ...next[index],
      method: next[index].method === "popup" ? "email" : "popup",
    };
    onChange(next);
  }

  function remove(index: number) {
    onChange(reminders.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {reminders.length === 0 && <span className="text-sm text-ink-faint">No reminders.</span>}
        {reminders.map((r, i) => (
          <span
            key={`${r.method}-${r.minutesBefore}-${i}`}
            className="inline-flex items-center gap-2 rounded-pill border border-indigo-border bg-indigo-bg py-1.5 pl-3 pr-2 text-xs font-medium text-indigo-text"
          >
            <button type="button" onClick={() => toggleMethod(i)} title="Click to toggle popup/email">
              {reminderLabel(r)}
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-indigo-text/60 hover:text-indigo-text"
              aria-label="Remove reminder"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => addPreset(p.minutesBefore)}
            className="rounded-pill border border-border px-3 py-1 text-xs text-ink-muted transition-colors hover:border-sage hover:text-sage"
          >
            + {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
