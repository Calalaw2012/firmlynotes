"use client";

import type { ParsedEvent } from "@/types/event";
import RemindersEditor from "./RemindersEditor";
import AttendeesEditor from "./AttendeesEditor";
import Banner from "./Banner";

const inputClasses =
  "w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring";

export type EventCardStatus = "draft" | "creating" | "sent" | "error";

/**
 * One independently-editable, independently-sendable event card. This is
 * the multi-event evolution of the old single-note ConfirmEventCard: same
 * fields and validation, but each instance owns its own send/success/error
 * state instead of the whole page moving through one shared phase. "Back to
 * note" doesn't apply here (the note stays visible at all times), so it's
 * replaced with "Dismiss", which drops just this card.
 */
export default function EventCard({
  event,
  status,
  error,
  meetLink,
  htmlLink,
  onChange,
  onSend,
  onDismiss,
}: {
  event: ParsedEvent;
  status: EventCardStatus;
  error: string | null;
  meetLink: string | null;
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

  return (
    <section
      className={`space-y-5 rounded-[10px] border p-5 md:p-6 ${
        sent ? "border-sage/40 bg-bg-elevated/60" : "border-border bg-bg-elevated"
      }`}
    >
      {sent ? (
        <Banner variant="success">
          Added to your calendar.
          {meetLink && (
            <>
              {" "}
              <a href={meetLink} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                Join the Meet
              </a>
            </>
          )}
          {htmlLink && (
            <>
              {" "}
              <a href={htmlLink} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                View in Calendar
              </a>
            </>
          )}
        </Banner>
      ) : (
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
            Dismiss
          </button>
        </div>
      )}

      {error && <Banner variant="danger">{error}</Banner>}
      {event.clarificationNeeded && !sent && <Banner variant="info">{event.clarificationNeeded}</Banner>}

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
      </fieldset>

      {!sent && (
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !event.title.trim() || !event.date || event.attendees.some((a) => !a.email)}
            className="rounded-[10px] border border-indigo-border bg-indigo-bg px-6 py-2.5 text-sm font-semibold text-indigo-text transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
          >
            {sending ? "Adding…" : "Add to Calendar"}
          </button>
        </div>
      )}
      {!sent && event.attendees.some((a) => !a.email) && (
        <p className="-mt-2 text-xs text-danger">
          Fix or remove the unmatched attendee above before sending.
        </p>
      )}
    </section>
  );
}
