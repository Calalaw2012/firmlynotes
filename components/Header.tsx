"use client";

import { signOut, useSession } from "next-auth/react";
import Logo from "./Logo";

export default function Header() {
  const { data: session } = useSession();

  return (
    <header className="flex flex-wrap items-start justify-between gap-4 px-6 py-6 md:px-10 md:py-8">
      <Logo />
      {session && (
        <div className="flex items-center gap-3">
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
            {session.calendarConnected ? "Calendar connected" : "Reconnect needed"}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-xs text-ink-muted underline decoration-border underline-offset-4 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
