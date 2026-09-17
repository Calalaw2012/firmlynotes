"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Header from "@/components/Header";
import Logo from "@/components/Logo";
import NoteComposer from "@/components/NoteComposer";
import EventCard, { type EventCardStatus } from "@/components/EventCard";
import RecentList, { type RecentEntry } from "@/components/RecentList";
import Banner from "@/components/Banner";
import type { Attendee, ParsedEvent } from "@/types/event";

const PARSE_DEBOUNCE_MS = 3000;
const MIN_LENGTH_TO_PARSE = 12;

interface CardState {
  id: string;
  event: ParsedEvent;
  userEdited: boolean;
  status: EventCardStatus;
  error: string | null;
  meetLink: string | null;
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

/**
 * Merges a fresh parse-note result into the existing card list without
 * disturbing cards the user has already started editing or already sent.
 * Matches a new event to an existing card by (date, normalized title);
 * falls back to matching by date alone when no title match is found. An
 * event matching a dismissed signature is skipped so a card the user
 * dismissed doesn't silently reappear while they keep typing around it.
 */
function reconcileCards(prevCards: CardState[], events: ParsedEvent[], dismissed: Set<string>): CardState[] {
  const usedNew = new Set<number>();
  const matchedPrev = new Set<string>();
  const next = prevCards.map((c) => ({ ...c }));

  // Pass 1: match by date + normalized title.
  for (const card of next) {
    if (card.status === "sent" || card.userEdited) continue;
    const idx = events.findIndex(
      (e, ei) =>
        !usedNew.has(ei) &&
        e.date === card.event.date &&
        normalizeTitle(e.title) === normalizeTitle(card.event.title)
    );
    if (idx !== -1) {
      usedNew.add(idx);
      matchedPrev.add(card.id);
      card.event = events[idx];
    }
  }

  // Pass 2: fallback match remaining cards by date only.
  for (const card of next) {
    if (card.status === "sent" || card.userEdited || matchedPrev.has(card.id)) continue;
    const idx = events.findIndex((e, ei) => !usedNew.has(ei) && e.date === card.event.date);
    if (idx !== -1) {
      usedNew.add(idx);
      matchedPrev.add(card.id);
      card.event = events[idx];
    }
  }

  const additions: CardState[] = events
    .map((e, ei) => ({ e, ei }))
    .filter(({ ei }) => !usedNew.has(ei))
    .filter(({ e }) => !dismissed.has(signatureFor(e)))
    .map(({ e }) => ({
      id: makeCardId(),
      event: e,
      userEdited: false,
      status: "draft" as const,
      error: null,
      meetLink: null,
      htmlLink: null,
    }));

  return [...next, ...additions];
}

export default function Home() {
  const { data: session, status } = useSession();

  const [noteText, setNoteText] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [signInError, setSignInError] = useState<string | null>(null);

  const lastParsedRef = useRef<string>("");
  const dismissedRef = useRef<Set<string>>(new Set());
  const resolvedRef = useRef<Set<string>>(new Set());

  // NextAuth redirects rejected sign-ins back to "/?error=...". Read it once
  // on load, show it, then clean the URL so refreshing doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (!err) return;
    setSignInError(
      err === "AccessDenied"
        ? "Firmly Notes is limited to calalaw.com Google accounts. Sign in with your firm email."
        : "Sign-in didn't go through. Please try again."
    );
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Auto-extract every schedulable item in the note, three seconds after
  // the user stops typing. Debounced client-side so each real pause fires
  // exactly one /api/parse-note call, not one per keystroke.
  useEffect(() => {
    const trimmed = noteText.trim();
    if (trimmed.length < MIN_LENGTH_TO_PARSE) return;
    if (trimmed === lastParsedRef.current) return;

    const handle = setTimeout(async () => {
      setParsing(true);
      setParseError(null);
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch("/api/parse-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, timezone, nowISO: new Date().toISOString() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't read that note.");
        lastParsedRef.current = trimmed;
        const events: ParsedEvent[] = Array.isArray(data.events) ? data.events : [];
        setCards((prev) => reconcileCards(prev, events, dismissedRef.current));
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Couldn't read that note.");
      } finally {
        setParsing(false);
      }
    }, PARSE_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [noteText]);

  // Resolve name-only attendees against Google contacts as soon as a fresh
  // draft card appears, rather than waiting until the user reaches for
  // "Add to Calendar" to discover something didn't match.
  useEffect(() => {
    cards.forEach((card) => {
      if (resolvedRef.current.has(card.id)) return;
      if (card.status !== "draft") return;
      if (card.event.attendees.every((a) => a.email)) return;
      resolvedRef.current.add(card.id);
      resolveAttendees(card.event.attendees).then((attendees) => {
        setCards((prev) =>
          prev.map((c) => (c.id === card.id && !c.userEdited ? { ...c, event: { ...c.event, attendees } } : c))
        );
      });
    });
  }, [cards]);

  function updateCard(id: string, event: ParsedEvent) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, event, userEdited: true } : c)));
  }

  function dismissCard(id: string) {
    setCards((prev) => {
      const card = prev.find((c) => c.id === id);
      if (card) dismissedRef.current.add(signatureFor(card.event));
      return prev.filter((c) => c.id !== id);
    });
  }

  async function sendCard(id: string) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "creating", error: null } : c)));
    try {
      const attendees = await resolveAttendees(card.event.attendees);
      const eventToSend = { ...card.event, attendees };
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: eventToSend, timeZone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add that to your calendar.");

      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                event: eventToSend,
                status: "sent",
                meetLink: data.meetLink ?? null,
                htmlLink: data.htmlLink ?? null,
              }
            : c
        )
      );
      setRecent((prev) =>
        [
          {
            title: eventToSend.title,
            when: formatWhen(eventToSend),
            link: data.htmlLink,
            meetLink: data.meetLink ?? null,
            attendeeCount: eventToSend.attendees.length,
          },
          ...prev,
        ].slice(0, 6)
      );
    } catch (err) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "error",
                error: err instanceof Error ? err.message : "Couldn't add that to your calendar.",
              }
            : c
        )
      );
    }
  }

  if (status === "loading") {
    return <div className="min-h-screen bg-bg" />;
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
        <Logo size="lg" />
        <p className="max-w-sm text-balance text-ink-muted">
          Type a note the way you'd say it. Firmly Notes reads every event it contains — date, time,
          duration, attendees, and reminders — and adds a Google Meet link if you ask for one — then
          puts each one straight on your Google Calendar.
        </p>
        <button
          type="button"
          onClick={() => signIn("google")}
          className="rounded-[10px] border border-indigo-border bg-indigo-bg px-7 py-3 text-sm font-semibold text-indigo-text hover:brightness-110"
        >
          Sign in with Google
        </button>
        {signInError && (
          <div className="max-w-sm">
            <Banner variant="danger">{signInError}</Banner>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <Header />
      <main className="flex-1 space-y-6 px-6 pb-16 md:px-10">
        {session.authError && (
          <Banner variant="danger">
            Your Google connection needs to be refreshed. Sign out and sign back in to keep sending
            notes to your calendar.
          </Banner>
        )}

        {parseError && <Banner variant="danger">{parseError}</Banner>}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <NoteComposer value={noteText} onChange={setNoteText} />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-text">
                Events found in this note
              </h2>
              {parsing && <span className="text-xs text-ink-faint">Reading…</span>}
            </div>

            {cards.length === 0 && !parsing && (
              <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-sm text-ink-faint">
                Nothing schedulable yet — event cards will appear here once your note names a date or
                time.
              </p>
            )}

            {cards.map((card) => (
              <EventCard
                key={card.id}
                event={card.event}
                status={card.status}
                error={card.error}
                meetLink={card.meetLink}
                htmlLink={card.htmlLink}
                onChange={(e) => updateCard(card.id, e)}
                onSend={() => sendCard(card.id)}
                onDismiss={() => dismissCard(card.id)}
              />
            ))}
          </div>
        </div>

        <RecentList items={recent} />
      </main>
    </div>
  );
}
