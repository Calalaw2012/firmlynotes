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

/** The standard four-color Google "G" mark, for the sign-in button. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.5404-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5822-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
      <path fill="#FBBC05" d="M3.9641 10.71c-.18-.5404-.2823-1.1177-.2823-1.71s.1023-1.1696.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z" />
      <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1618 6.6564 3.5795 9 3.5795z" />
    </svg>
  );
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

function attendeesEqual(a: Attendee[], b: Attendee[]): boolean {
  const norm = (as: Attendee[]) => as.map((x) => x.email.toLowerCase()).filter(Boolean).sort();
  const na = norm(a);
  const nb = norm(b);
  if (na.length !== nb.length) return false;
  return na.every((v, i) => v === nb[i]);
}

/** Everything that actually matters for "is this still the same event". */
function eventsEqual(a: ParsedEvent, b: ParsedEvent): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.date === b.date &&
    a.allDay === b.allDay &&
    (a.allDay || (a.startTime === b.startTime && a.endTime === b.endTime)) &&
    a.description.trim() === b.description.trim() &&
    a.addGoogleMeet === b.addGoogleMeet &&
    remindersEqual(a.reminders, b.reminders) &&
    attendeesEqual(a.attendees, b.attendees)
  );
}

/**
 * Merges a fresh parse-note result into the existing card list without
 * disturbing cards the user has already started editing, or that are
 * mid-send right now. An event matching a dismissed signature is skipped so
 * a card the user dismissed doesn't silently reappear while they keep
 * typing around it.
 *
 * A card that was already sent can still be matched: if the freshly parsed
 * version of that same event differs from what's on the card (a changed
 * time, a new attendee, etc.), the card is flagged `dirty` and its `event`
 * is updated to the new version -- so the card keeps showing what the note
 * now says, with an "Update event" action to push that change to the real
 * calendar entry, rather than a second card being created for the same
 * thing while the original sits there unsynced.
 *
 * Matching runs in four increasingly loose passes, each only considering
 * cards/events the previous pass didn't already claim:
 *   1. date + normalized title both match (the strongest signal).
 *   2. same date, title changed -- e.g. the note now phrases the same
 *      meeting slightly differently.
 *   3. same title, date changed -- e.g. "Tuesday" was corrected to
 *      "Thursday" but it's still described the same way.
 *   4. last resort: if editing the note changed BOTH the date and the
 *      title at once (nothing left in common to match on), and there's
 *      exactly one already-sent card with nothing matched and exactly one
 *      freshly parsed event nothing has claimed, treat them as the same
 *      event -- there's no real ambiguity about what happened to it when
 *      it's the only candidate on both sides. This pass is skipped
 *      whenever more than one card or event is left over, since guessing
 *      wrong there would silently misapply an edit to the wrong calendar
 *      entry, which is worse than the duplicate-card problem this whole
 *      function exists to prevent.
 */
function reconcileCards(prevCards: CardState[], events: ParsedEvent[], dismissed: Set<string>): CardState[] {
  const usedNew = new Set<number>();
  const matchedPrev = new Set<string>();
  const next = prevCards.map((c) => ({ ...c }));

  function applyMatch(card: CardState, matched: ParsedEvent) {
    if (card.status === "sent") {
      if (!eventsEqual(card.event, matched)) {
        card.event = matched;
        card.dirty = true;
      }
    } else {
      card.event = matched;
    }
  }

  function eligible(card: CardState): boolean {
    if (card.status === "creating") return false;
    if (card.status !== "sent" && card.userEdited) return false;
    return true;
  }

  // Pass 1: date + normalized title both match.
  for (const card of next) {
    if (!eligible(card) || matchedPrev.has(card.id)) continue;
    const idx = events.findIndex(
      (e, ei) =>
        !usedNew.has(ei) &&
        e.date === card.event.date &&
        normalizeTitle(e.title) === normalizeTitle(card.event.title)
    );
    if (idx !== -1) {
      usedNew.add(idx);
      matchedPrev.add(card.id);
      applyMatch(card, events[idx]);
    }
  }

  // Pass 2: same date, title changed.
  for (const card of next) {
    if (!eligible(card) || matchedPrev.has(card.id)) continue;
    const idx = events.findIndex((e, ei) => !usedNew.has(ei) && e.date === card.event.date);
    if (idx !== -1) {
      usedNew.add(idx);
      matchedPrev.add(card.id);
      applyMatch(card, events[idx]);
    }
  }

  // Pass 3: same title, date changed -- the mirror image of pass 2. Without
  // this pass, simply correcting an event's day (keeping the same title)
  // matched nothing at all, since pass 1 needs both and pass 2 needs the
  // date to still agree -- which is exactly the gap that was producing a
  // second, duplicate card any time the date portion of a note changed.
  for (const card of next) {
    if (!eligible(card) || matchedPrev.has(card.id)) continue;
    const idx = events.findIndex(
      (e, ei) => !usedNew.has(ei) && normalizeTitle(e.title) === normalizeTitle(card.event.title)
    );
    if (idx !== -1) {
      usedNew.add(idx);
      matchedPrev.add(card.id);
      applyMatch(card, events[idx]);
    }
  }

  // Pass 4: last-resort singleton fallback -- see the function doc comment.
  const stillUnmatchedSent = next.filter((c) => c.status === "sent" && !matchedPrev.has(c.id));
  const stillUnusedEvents = events.map((e, ei) => ({ e, ei })).filter(({ ei }) => !usedNew.has(ei));
  if (stillUnmatchedSent.length === 1 && stillUnusedEvents.length === 1) {
    const card = stillUnmatchedSent[0];
    const { e, ei } = stillUnusedEvents[0];
    usedNew.add(ei);
    matchedPrev.add(card.id);
    applyMatch(card, e);
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
      googleEventId: null,
      dirty: false,
      meetLink: null,
      meetPhone: null,
      meetPin: null,
      htmlLink: null,
    }));

  return [...next, ...additions];
}

export default function Home() {
  const { data: session, status } = useSession();

  const [noteText, setNoteText] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  const [parsing, setParsing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [signInError, setSignInError] = useState<string | null>(null);

  const lastParsedRef = useRef<string>("");
  const dismissedRef = useRef<Set<string>>(new Set());
  const resolvedRef = useRef<Set<string>>(new Set());

  // The signed-in user is always a default attendee on every event this
  // tool creates -- injected here (client-side, into every fresh parse
  // result) rather than in the AI prompt, so it's guaranteed regardless of
  // whether the note happens to mention the note-taker.
  const selfAttendee: Attendee | null = session?.user?.email
    ? { name: session.user.name || session.user.email, email: session.user.email }
    : null;

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

  // Auto-extract every schedulable item in the note, five seconds after
  // the user stops typing (matches the approved mockup's timing). Debounced
  // client-side so each real pause fires exactly one /api/parse-note call,
  // not one per keystroke. Both the countdown and the "processing…" state
  // while the request is in flight are surfaced on the note card itself
  // (see NoteComposer's parsing/countdown props) so they're visible from
  // the very first keystroke -- well before any event card exists.
  useEffect(() => {
    const trimmed = noteText.trim();
    if (trimmed.length < MIN_LENGTH_TO_PARSE || trimmed === lastParsedRef.current) {
      setCountdown(null);
      return;
    }

    setCountdown(Math.round(PARSE_DEBOUNCE_MS / 1000));
    const tick = setInterval(() => {
      setCountdown((c) => (c !== null && c > 1 ? c - 1 : 0));
    }, 1000);

    const handle = setTimeout(async () => {
      clearInterval(tick);
      setCountdown(null);
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
        const withSelf = events.map((e) => injectSelf(e, selfAttendee));
        setCards((prev) => reconcileCards(prev, withSelf, dismissedRef.current));
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Couldn't read that note.");
      } finally {
        setParsing(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, PARSE_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      clearInterval(tick);
    };
    // selfAttendee intentionally excluded -- it only changes on sign-in/out,
    // which already remounts this whole page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Clearing the note is a deliberate, explicit action -- it doesn't wait
  // out the debounce, and it also drops every event card straight away
  // (not just the text), matching the approved mockup's Clear note
  // behavior. Also resets the tracking refs so a note typed fresh afterward
  // isn't held back by state left over from the cleared one.
  function clearNote() {
    setNoteText("");
    setCards([]);
    setCountdown(null);
    setParsing(false);
    setParseError(null);
    lastParsedRef.current = "";
    dismissedRef.current = new Set();
    resolvedRef.current = new Set();
  }

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

  /**
   * Sends a card to Google Calendar. A card that already has a
   * googleEventId (i.e. it's `sent` and `dirty`) updates that same event in
   * place instead of creating a new one -- the note stays the single source
   * of truth without leaving a duplicate, unsynced original behind.
   */
  async function sendCard(id: string) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const isUpdate = Boolean(card.googleEventId);
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "creating", error: null } : c)));
    try {
      const attendees = await resolveAttendees(card.event.attendees);
      const eventToSend = { ...card.event, attendees };
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUpdate ? { event: eventToSend, timeZone, eventId: card.googleEventId } : { event: eventToSend, timeZone }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Couldn't ${isUpdate ? "update" : "add"} that on your calendar.`);

      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                event: eventToSend,
                status: "sent",
                dirty: false,
                googleEventId: data.id ?? c.googleEventId,
                meetLink: data.meetLink ?? null,
                meetPhone: data.meetPhone ?? null,
                meetPin: data.meetPin ?? null,
                htmlLink: data.htmlLink ?? c.htmlLink,
              }
            : c
        )
      );
      // Only genuinely new events join the recent list -- an update to an
      // already-sent event isn't a new thing to show there.
      if (!isUpdate) {
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
      }
    } catch (err) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "error",
                error:
                  err instanceof Error ? err.message : `Couldn't ${isUpdate ? "update" : "add"} that on your calendar.`,
              }
            : c
        )
      );
    }
  }

  // "Add all to Calendar" sends every card that isn't already in sync with
  // the calendar: drafts, cards that errored on a previous attempt, and
  // sent cards whose note text has since changed (dirty). Each card still
  // goes through the normal sendCard flow and gets its own status, so one
  // failure doesn't block the rest.
  const sendableCards = cards.filter((c) => c.status === "draft" || c.status === "error" || (c.status === "sent" && c.dirty));
  const sendingAll = cards.some((c) => c.status === "creating") && sendableCards.length === 0;

  async function sendAllCards() {
    await Promise.all(sendableCards.map((c) => sendCard(c.id)));
  }

  if (status === "loading") {
    return <div className="min-h-screen bg-bg" />;
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-[20px] border border-border bg-bg-elevated px-6 py-10 text-center sm:px-10">
          <Logo size="lg" />
          <p className="mt-6 text-balance text-ink-muted">Sign in with your firm Google account to continue.</p>
          <button
            type="button"
            onClick={() => signIn("google")}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-[10px] border border-indigo-border bg-indigo-bg px-5 py-3.5 text-sm font-semibold text-ink hover:brightness-110"
          >
            <GoogleIcon />
            Sign in with Google
          </button>
          {signInError && (
            <div className="mt-4 text-left">
              <Banner variant="danger">{signInError}</Banner>
            </div>
          )}
        </div>
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

        {/* Single column by default -- this tool works fine for someone who
            only ever writes plain notes and never gets an event card. The
            second column only appears once the note actually contains a
            detected, schedulable event; it disappears again if every card
            is dismissed or sent... no, sent cards stay (see below) but a
            note that goes back to having zero cards collapses back to one
            column. */}
        <div className={`grid grid-cols-1 gap-6 ${cards.length > 0 ? "md:grid-cols-2" : ""}`}>
          <NoteComposer
            value={noteText}
            onChange={setNoteText}
            onClear={clearNote}
            parsing={parsing}
            countdown={countdown}
          />

          {cards.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-text">
                  Calendar Events
                </h2>
                {sendableCards.length > 1 && (
                  <button
                    type="button"
                    onClick={sendAllCards}
                    disabled={sendingAll}
                    className="rounded-pill border border-indigo-border bg-indigo-bg px-3 py-1 text-xs font-semibold text-indigo-text transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
                  >
                    {sendingAll ? "Adding all…" : `Add all to Calendar (${sendableCards.length})`}
                  </button>
                )}
              </div>

              {cards.map((card) => (
                <EventCard
                  key={card.id}
                  event={card.event}
                  status={card.status}
                  error={card.error}
                  dirty={card.dirty}
                  meetLink={card.meetLink}
                  meetPhone={card.meetPhone}
                  meetPin={card.meetPin}
                  htmlLink={card.htmlLink}
                  onChange={(e) => updateCard(card.id, e)}
                  onSend={() => sendCard(card.id)}
                  onDismiss={() => dismissCard(card.id)}
                />
              ))}
            </div>
          )}
        </div>

        <RecentList items={recent} />
      </main>
    </div>
  );
}
