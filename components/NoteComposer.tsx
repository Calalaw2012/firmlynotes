"use client";

import { useRef, useState } from "react";
import { saveNoteAsWordDoc } from "@/lib/saveAsWord";

const PLACEHOLDER = `Type a note the way you'd say it out loud…

"Deposition prep with Sarah, Thursday 2pm, 90 minutes, remind me the morning of"
"Video call with John Ramirez and opposing counsel tomorrow at 10, add a Meet link"
"Filing deadline for the Mercer brief is next Friday, remind me 2 days before"`;

export default function NoteComposer({
  value,
  onChange,
  onSubmit,
  submitting,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [savingDocx, setSavingDocx] = useState(false);
  const [docxNotice, setDocxNotice] = useState<string | null>(null);

  async function handleSaveDocx() {
    if (!value.trim() || savingDocx) return;
    setDocxNotice(null);
    setSavingDocx(true);
    try {
      const result = await saveNoteAsWordDoc(value);
      setDocxNotice(result.saved ? `Saved "${result.filename}".` : null);
    } catch {
      setDocxNotice("Couldn't save that as a Word document.");
    } finally {
      setSavingDocx(false);
      setTimeout(() => setDocxNotice(null), 4000);
    }
  }

  return (
    <div className="space-y-4">
      <textarea
        ref={ref}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (value.trim() && !submitting) onSubmit();
          }
        }}
        placeholder={PLACEHOLDER}
        className="h-[42vh] min-h-[220px] w-full resize-none rounded-[10px] border border-border bg-bg-elevated px-5 py-4 text-lg leading-relaxed text-ink placeholder:text-ink-faint/80 focus-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {docxNotice ?? "⌘ / Ctrl + Enter to send"}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDocx}
            disabled={!value.trim() || savingDocx}
            className="rounded-[10px] border border-border bg-bg-elevated px-5 py-2.5 text-sm font-semibold text-ink-muted transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
          >
            {savingDocx ? "Saving…" : "Save as Word Doc"}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!value.trim() || submitting}
            className="rounded-[10px] border border-indigo-border bg-indigo-bg px-7 py-2.5 text-sm font-semibold text-indigo-text transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
          >
            {submitting ? "Reading…" : "Send to Calendar"}
          </button>
        </div>
      </div>
    </div>
  );
}
