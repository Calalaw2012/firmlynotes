"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Header from "@/components/Header";
import Logo from "@/components/Logo";
import NoteComposer from "@/components/NoteComposer";
import ConfirmEventCard from "@/components/ConfirmEventCard";
import RecentList, { type RecentEntry } from "@/components/RecentList";
import Banner from "@/components/Banner";
import type { Attendee, ParsedEvent } from "@/types/event";

type Phase = "idle" | "parsing" | "confirm" | "creating" | "success";

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

/**
 * Fills in emails for attendees the parser only got a name for, by looking
 * each one up against the user's Google contacts. Leaves an attendee alone
 * (email stays "") when there's no match — the confirm card surfaces that
 * so the user can fix it by hand.
 */
async function resolveAttendees(attendees: Attendee[]): Promise<Attendee[]> {
  return Promise.all(
    attendees.map(async (a) => {
      if (a.email) return a;
      try {
        const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(a.name)}`);
        if (!res.ok) return a;
        const data = await res.json();
        const match = Array.isArray(data.matches) ? data.matches[0] : null;
        return match ? { name: match.name, email: match.email } : a;
      } catch {
        return a;
      }
    })
  );
}

export default function Home() {
  const { data: session, status } = useSession();

  const [noteText, setNoteText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [event, setEvent] = useState<ParsedEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [lastMeetLink, setLastMeetLink] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

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

  async function handleParse() {
    setError(null);
    setPhase("parsing");
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/parse-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: noteText, timezone, nowISO: new Date().toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that note.");
      const attendees = await resolveAttendees(data.event.attendees ?? []);
      setEvent({ ...data.event, attendees });
      setPhase("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that note.");
      setPhase("idle");
    }
  }

  async function handleConfirm() {
    if (!event) return;
    setError(null);
    setPhase("creating");
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, timeZone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add that to your calendar.");

      setLastMeetLink(data.meetLink ?? null);
      setRecent((prev) =>
        [
          {
            title: event.title,
            when: formatWhen(event),
            link: data.htmlLink,
            meetLink: data.meetLink ?? null,
            attendeeCount: event.attendees.length,
          },
          ...prev,
        ].slice(0, 6)
      );
      setPhase("success");
      setTimeout(
        () => {
          setNoteText("");
          setEvent(null);
          setPhase("idle");
          setLastMeetLink(null);
        },
        data.meetLink ? 3000 : 1800
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that to your calendar.");
      setPhase("confirm");
    }
  }

  function handleCancelConfirm() {
    setEvent(null);
    setError(null);
    setPhase("idle");
  }

  if (status === "loading") {
    return <div className="min-h-screen bg-bg" />;
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
        <Logo size="lg" />
        <p className="max-w-sm text-balance text-ink-muted">
          Type a note the way you'd say it. Firmly Notes reads the date, time, duration,
          attendees, and reminders — and adds a Google Meet link if you ask for one — then puts
          it straight on your Google Calendar.
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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <Header />
      <main className="flex-1 space-y-6 px-6 pb-16 md:px-10">
        {session.authError && (
          <Banner variant="danger">
            Your Google connection needs to be refreshed. Sign out and sign back in to keep sending
            notes to your calendar.
          </Banner>
        )}

        {error && <Banner variant="danger">{error}</Banner>}

        {phase === "success" && (
          <Banner variant="success">
            Added to your calendar.
            {lastMeetLink && (
              <>
                {" "}
                <a href={lastMeetLink} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Join the Meet
                </a>
              </>
            )}
          </Banner>
        )}

        {(phase === "idle" || phase === "parsing") && (
          <NoteComposer
            value={noteText}
            onChange={setNoteText}
            onSubmit={handleParse}
            submitting={phase === "parsing"}
          />
        )}

        {event && (phase === "confirm" || phase === "creating") && (
          <ConfirmEventCard
            event={event}
            onChange={setEvent}
            onConfirm={handleConfirm}
            onCancel={handleCancelConfirm}
            submitting={phase === "creating"}
          />
        )}

        <RecentList items={recent} />
      </main>
    </div>
  );
}
