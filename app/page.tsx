"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Header from "@/components/Header";
import Logo from "@/components/Logo";
import NoteComposer from "@/components/NoteComposer";
import EventCard, { type EventCardStatus } from "@/components/EventCard";
import RecentList, { type RecentEntry } from "@/components/RecentList";
import Banner from "@/components/Banner";
import type { Attendee, ParsedEvent, Reminder } from "@/types/event";

const PARSE_DEBOUNCE_MS = 5000;
const MIN_LENGTH_TO_PARSE = 12;

interface CardState {
  id: string;
  event: ParsedEvent;
  userEdited: boolean;
  status: EventCardStatus;
  error: string | null;
  /** Google Calendar's own id for this event, once it's been sent at least once. */
  googleEventId: string | null;
  /**
   * True when this card was already sent, but a later parse of the note
   * produced different details for the same event -- surfaced in the card
   * as "this changed, click Update event" rather than silently either
   * re-syncing on its own or spawning a duplicate card.
   */
  dirty: boolean;
  meetLink: string | null;
  meetPhone: string | null;
  meetPin: string | null;
  htmlLink: string | null;
}

function formatWhen(event: ParsedEvent): string {
  const [y, m, d] = event.date.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dateLabel = dateObj.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (event.allDay || !event.startTime) return `All day · ${dateLabel}`;
  const [h, min] = event.startTime.split(":").map(Number);
  const timeObj = new Date(y, m - 1, d, h, min);
  const timeLabel = timeObj.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateLabel} · ${timeLabel}`;
}

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

function signatureFor(event: ParsedEvent): string {
  return `${event.date}|${normalizeTitle(event.title)}`;
}

let cardSeq = 0;
function makeCardId(): string {
  cardSeq += 1;
  return `card-${Date.now()}-${cardSeq}`;
}

/**
 * Fills in emails for attendees the parser only got a name for, by looking
 * each one up against the user's Google contacts. Leaves an attendee alone
 * (email stays "") when there's no match — the card surfaces that so the
 * user can fix it by hand.
 */
async function resolveAttendees(attendees: Attendee[]): Promise<Attendee[]> {
  return Promise.all(
    attendees.map(async (a) => {
      if (a.email) return a;
      try {
        const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(a.name)}`);
        if (!res.ok) return a;
        const data = await res.json();
        const matches = Array.isArray(data.matches) ? data.matches : [];

        // A remembered alias for this exact name is a confident match --
        // auto-resolve even if the name also loosely matches other
        // contacts in the fallback list below.
        if (data.aliasEmail) {
          const aliased = matches.find((m: { email: string }) => m.email === data.aliasEmail);
          return { name: aliased?.name || a.name, email: data.aliasEmail };
        }

        // Otherwise only auto-resolve when there's exactly one candidate --
        // guessing among several people who share a first name is worse
        // than leaving it for the user to pick.
        return matches.length === 1 ? { name: matches[0].name, email: matches[0].email } : a;
      } catch {
        return a;
      }
    })
  );
}

/** Adds `self` as the first attendee, unless they're already on the list. */
function injectSelf(event: ParsedEvent, self: Attendee | null): ParsedEvent {
  if (!self || !self.email) return event;
  const already = event.attendees.some((a) => a.email.toLowerCase() === self.email.toLowerCase());
  if (already) return event;
  return { ...event, attendees: [self, ...event.attendees] };
}

function remindersEqual(a: Reminder[], b: Reminder[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (rs: Reminder[]) => rs.map((r) => `${r.method}:${r.minutesBefore}`).sort();
  const na = norm(a);
  const nb = norm(b);
  return na.every((v, i) => v === nb[i]);
}

function
