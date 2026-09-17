"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Logo from "./Logo";

// Bluebook-style month abbreviations (fits a law firm's own citation
// conventions) -- deliberately not Intl's "short" month format, which gives
// "Sep" rather than "Sept.".
const MONTHS = [
  "Jan.",
  "Feb.",
  "March",
  "April",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
];

function formatNow(date: Date): string {
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const ampm = hours >= 12 ? "p.m." : "a.m.";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `Today is ${month} ${day}, ${year}, ${hours}:${minutes} ${ampm}`;
}

/**
 * The current date/time in whatever timezone this browser is set to (no
 * server round-trip, no timezone prop -- just `new Date()`). Starts as null
 * and only renders after mount so the server-rendered markup and the first
 * client render always match (a clock can't be rendered server-side without
 * mismatching the instant the client actually paints).
 */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  return <p className="text-xs text-ink-faint">{formatNow(now)}</p>;
}

export default function Header() {
  const { data: session } = useSession();
  const avatarUrl = session?.user?.image;

  return (
    <header className="flex flex-wrap items-start justify-between gap-4 px-6 py-6 md:px-10 md:py-8">
      <Logo />
      {session && (
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-6 w-6 rounded-full border border-border-faint"
              />
            )}
            <span className="rounded-pill border border-border bg-bg-elevated px-3 py-1.5 text-xs text-ink-muted">
              {session.user?.email}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs ${
                session.calendarConnected
                  ? "border-success-border bg-success/10 text-success"
                  : "border-danger-border bg-danger-bg text-danger"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full bg-current ${
                  session.calendarConnected ? "connected-dot" : ""
                }`}
              />
              {session.calendarConnected ? "Connected" : "No connection"}
            </span>
            <button
              type="button"
              onClick={() => signOut()}
              className="text-xs text-ink-muted underline decoration-border underline-offset-4 hover:text-ink"
            >
              Sign out
            </button>
          </div>
          <LiveClock />
        </div>
      )}
    </header>
  );
}
