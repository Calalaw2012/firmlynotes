"use client";

import { useState } from "react";
import { saveNoteAsWordDoc } from "@/lib/saveAsWord";

const PLACEHOLDER = `Type a note the way you'd say it out loud…

"Deposition prep with Sarah, Thursday 2pm, 90 minutes, remind me the morning of"
"Video call with John Ramirez and opposing counsel tomorrow at 10, add a Meet link"
"Filing deadline for the Mercer brief is next Friday, remind me 2 days before"

You can describe more than one thing in the same note — each one shows up as its own card on the right.`;

export default function NoteComposer({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSave() {
    if (!value.trim() || saving) return;
    setNotice(null);
    setSaving(true);
    try {
      const result = await saveNoteAsWordDoc(value);
      setNotice(result.saved ? `Saved "${result.filename}".` : null);
    } catch {
      setNotice("Couldn't save that as a Word document.");
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(null), 4000);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER}
        className="h-[50vh] min-h-[260px] w-full resize-none rounded-[10px] border border-border bg-bg-elevated px-5 py-4 text-lg leading-relaxed text-ink placeholder:text-ink-faint/80 focus-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {notice ?? "Every schedulable item in the note shows up on the right, a few seconds after you stop typing."}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!value.trim() || saving}
          className="rounded-[10px] border border-border px-6 py-2.5 text-sm font-semibold text-ink-muted transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:border-sage hover:text-sage"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
