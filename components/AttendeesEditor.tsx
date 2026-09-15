"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Attendee } from "@/types/event";

interface Suggestion {
  name: string;
  email: string;
  source: "contacts" | "other";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function searchContacts(query: string): Promise<Suggestion[]> {
  const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.matches) ? data.matches : [];
}

export default function AttendeesEditor({
  attendees,
  onChange,
}: {
  attendees: Attendee[];
  onChange: (attendees: Attendee[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = inputValue.trim();
    if (!q) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const matches = await searchContacts(q);
      setSuggestions(matches);
      setSearching(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue]);

  function addAttendee(a: Attendee) {
    if (attendees.some((existing) => existing.email && existing.email === a.email)) return;
    onChange([...attendees, a]);
    setInputValue("");
    setSuggestions([]);
    setOpen(false);
  }

  function remove(index: number) {
    onChange(attendees.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const text = inputValue.trim();
    if (!text) return;
    if (suggestions.length > 0) {
      addAttendee({ name: suggestions[0].name, email: suggestions[0].email });
    } else if (EMAIL_RE.test(text)) {
      addAttendee({ name: text, email: text });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {attendees.map((a, i) =>
          a.email ? (
            <span
              key={`${a.email}-${i}`}
              className="inline-flex flex-col items-start gap-0.5 rounded-pill border border-indigo-border bg-indigo-bg py-1.5 pl-3 pr-2 text-xs font-medium text-indigo-text"
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate">{a.name || a.email}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="ml-auto shrink-0 text-indigo-text/60 hover:text-indigo-text"
                  aria-label={`Remove ${a.name || a.email}`}
                >
                  ×
                </button>
              </span>
              {a.name && a.name !== a.email && (
                <span className="text-[11px] font-normal text-indigo-text/60">{a.email}</span>
              )}
            </span>
          ) : (
            <span
              key={`unresolved-${a.name}-${i}`}
              className="inline-flex items-center gap-2 rounded-pill border border-dashed border-danger-border bg-danger-bg py-1.5 pl-3 pr-2 text-xs font-medium text-danger"
              title="No contact match — search again or remove"
            >
              {a.name} · no email match
              <button
                type="button"
                onClick={() => {
                  setInputValue(a.name);
                  remove(i);
                }}
                className="text-danger/70 hover:text-danger underline underline-offset-2"
              >
                fix
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-danger/70 hover:text-danger"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </span>
          )
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Add attendee — name or email"
          className="w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-ring"
        />
        {open && (inputValue.trim().length > 0) && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg">
            {searching && (
              <div className="px-3 py-2 text-xs text-ink-faint">Searching contacts…</div>
            )}
            {!searching &&
              suggestions.map((s) => (
                <button
                  key={s.email}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addAttendee({ name: s.name, email: s.email })}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-indigo-bg/40"
                >
                  <span className="truncate text-ink">{s.name}</span>
                  <span className="shrink-0 truncate text-xs text-ink-faint">{s.email}</span>
                </button>
              ))}
            {!searching && suggestions.length === 0 && (
              <div className="px-3 py-2 text-xs text-ink-faint">
                {EMAIL_RE.test(inputValue.trim())
                  ? "Press Enter to add this email directly."
                  : "No contact match — try their email instead."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
