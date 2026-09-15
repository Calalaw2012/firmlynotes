"use client";

import type { ParsedEvent } from "@/types/event";
import RemindersEditor from "./RemindersEditor";
import AttendeesEditor from "./AttendeesEditor";
import Banner from "./Banner";

const inputClasses =
  "w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring";

export default function ConfirmEventCard({
  event,
  onChange,
  onConfirm,
  onCancel,
  submitting,
}: {
  event: ParsedEvent;
  onChange: (event: ParsedEvent) => void;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  function set<K extends keyof ParsedEvent>(key: K, value: ParsedEvent[K]) {
    onChange({ ...event, [key]: value });
  }

  return (
    <section className="space-y-5 rounded-[10px] border border-border bg-bg-elevated p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-text">
          Review before sending
        </h2>
      </div>

      {event.clarificationNeeded && (
        <Banner variant="info">{event.clarificationNeeded}</Banner>
      )}

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="col-span-2">
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
            Date
          </label>
          <input
            type="date"
            className={inputClasses}
            value={event.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </div>
        <div className="col-span-2 flex items-end gap-2 pb-2">
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border bg-bg-sunken accent-indigo-solid"
              checked={event.allDay}
              onChange={(e) => {
                const allDay = e.target.checked;
                if (!allDay && !event.startTime) {
                  onChange({ ...event, allDay, startTime: "09:00", endTime: "10:00" });
                } else {
                  set("allDay", allDay);
                }
              }}
            />
            All-day
          </label>
        </div>

        {!event.allDay && (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                Start
              </label>
              <input
                type="time"
                className={inputClasses}
                value={event.startTime ?? ""}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                End
              </label>
              <input
                type="time"
                className={inputClasses}
                value={event.endTime ?? ""}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </div>
          </>
        )}
      </div>

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

      <label className="flex items-center gap-2.5 text-sm text-ink-muted">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border bg-bg-sunken accent-indigo-solid"
          checked={event.addGoogleMeet}
          onChange={(e) => set("addGoogleMeet", e.target.checked)}
        />
        Add a Google Meet video call
      </label>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
          Reminders
        </label>
        <RemindersEditor reminders={event.reminders} onChange={(r) => set("reminders", r)} />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={
            submitting ||
            !event.title.trim() ||
            !event.date ||
            event.attendees.some((a) => !a.email)
          }
          className="rounded-[10px] border border-indigo-border bg-indigo-bg px-6 py-2.5 text-sm font-semibold text-indigo-text transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
        >
          {submitting ? "Adding…" : "Add to Calendar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-[10px] border border-border px-5 py-2.5 text-sm text-ink-muted hover:border-sage hover:text-sage disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back to note
        </button>
      </div>
      {event.attendees.some((a) => !a.email) && (
        <p className="-mt-2 text-xs text-danger">
          Fix or remove the unmatched attendee above before sending.
        </p>
      )}
    </section>
  );
}
