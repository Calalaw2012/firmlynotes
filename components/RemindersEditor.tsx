"use client";

import type { Reminder } from "@/types/event";

const PRESETS: { label: string; minutesBefore: number }[] = [
  { label: "10 min before", minutesBefore: 10 },
  { label: "30 min before", minutesBefore: 30 },
  { label: "1 hour before", minutesBefore: 60 },
  { label: "1 day before", minutesBefore: 24 * 60 },
];

function reminderLabel(r: Reminder): string {
  const time =
    r.minutesBefore >= 1440 && r.minutesBefore % 1440 === 0
      ? `${r.minutesBefore / 1440} day${r.minutesBefore / 1440 > 1 ? "s" : ""} before`
      : r.minutesBefore >= 60 && r.minutesBefore % 60 === 0
      ? `${r.minutesBefore / 60} hr${r.minutesBefore / 60 > 1 ? "s" : ""} before`
      : `${r.minutesBefore} min before`;
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
        {reminders.length === 0 && (
          <span className="text-sm text-ink-faint">No reminders — Google's default will apply.</span>
        )}
        {reminders.map((r, i) => (
          <span
            key={`${r.method}-${r.minutesBefore}-${i}`}
            className="inline-flex items-center gap-2 rounded-pill border border-indigo-border bg-indigo-bg pl-3 pr-2 py-1.5 text-xs font-medium text-indigo-text"
          >
            <button
              type="button"
              onClick={() => toggleMethod(i)}
              title="Click to toggle popup/email"
            >
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
            className="rounded-pill border border-border px-3 py-1 text-xs text-ink-muted hover:border-sage hover:text-sage transition-colors"
          >
            + {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
