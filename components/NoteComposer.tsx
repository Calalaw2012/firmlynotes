"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveNoteAsWordDoc } from "@/lib/saveAsWord";
import { splitIntoFragments } from "@/lib/splitSentences";

const PLACEHOLDER = `Type a note the way you'd say it out loudâ¦

"Deposition prep with Sarah, Thursday 2pm, 90 minutes, remind me the morning of"
"Video call with John Ramirez and opposing counsel tomorrow at 10, add a Meet link"
"Filing deadline for the Mercer brief is next Friday, remind me 2 days before"`;

type SentenceTag = "calendar" | "doc";

const TAG_DEBOUNCE_MS = 900;
const MIN_LENGTH_TO_TAG = 12;

export default function NoteComposer({
  value,
  onChange,
  onSubmit,
  submitting,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (calendarText: string) => void;
  submitting: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [savingDocx, setSavingDocx] = useState(false);
  const [docxNotice, setDocxNotice] = useState<string | null>(null);
  const [checkingTags, setCheckingTags] = useState(false);

  const fragments = useMemo(() => splitIntoFragments(value), [value]);
  const sentences = useMemo(
    () => fragments.filter((f) => f.isContent).map((f) => f.text.trim()),
    [fragments]
  );

  const [tags, setTags] = useState<SentenceTag[]>([]);
  const [autoSuggested, setAutoSuggested] = useState<Set<number>>(new Set());
  const manualRef = useRef<Set<number>>(new Set());
  const prevSentencesRef = useRef<string[]>([]);
  const taggedForRef = useRef<string[] | null>(null);
  const sentencesRef = useRef<string[]>([]);
  sentencesRef.current = sentences;

  // Reconcile tag state whenever the sentence list changes: keep the tag
  // for any sentence whose text is unchanged, reset anything new/changed
  // to an untagged default, and drop stale manual/auto-suggested markers
  // that no longer point at the sentence they were set on.
  useEffect(() => {
    const prev = prevSentencesRef.current;
    setTags((prevTags) => sentences.map((s, i) => (s === prev[i] ? prevTags[i] ?? "doc" : "doc")));
    manualRef.current = new Set([...manualRef.current].filter((i) => sentences[i] === prev[i]));
    setAutoSuggested((prevAuto) => new Set([...prevAuto].filter((i) => sentences[i] === prev[i])));
    prevSentencesRef.current = sentences;
  }, [sentences]);

  async function runTagging(targetSentences: string[]): Promise<SentenceTag[] | null> {
    if (targetSentences.length === 0) return null;
    try {
      const res = await fetch("/api/tag-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentences: targetSentences }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const indices: number[] = Array.isArray(data.calendarIndices) ? data.calendarIndices : [];

      // The sentence list may have moved on while this request was in
      // flight -- discard a response that no longer matches.
      if (targetSentences !== sentencesRef.current) return null;

      taggedForRef.current = targetSentences;
      setAutoSuggested(new Set(indices));
      let merged: SentenceTag[] = [];
      setTags((prev) => {
        merged = targetSentences.map((_, i) =>
          manualRef.current.has(i) ? prev[i] ?? "doc" : indices.includes(i) ? "calendar" : "doc"
        );
        return merged;
      });
      return merged;
    } catch {
      return null;
    }
  }

  // Auto pre-tag in the background, a moment after the user pauses typing.
  useEffect(() => {
    if (sentences.length === 0) return;
    if (sentences.join(" ").length < MIN_LENGTH_TO_TAG) return;
    if (sentences === taggedForRef.current) return;
    const handle = setTimeout(() => {
      runTagging(sentences);
    }, TAG_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences]);

  function toggleTag(index: number) {
    manualRef.current.add(index);
    setAutoSuggested((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    setTags((prev) => prev.map((t, i) => (i === index ? (t === "calendar" ? "doc" : "calendar") : t)));
  }

  async function handleProcessNote() {
    if (!value.trim() || submitting || savingDocx || checkingTags) return;

    // Always save the full note as a Word document -- unaffected by tags,
    // exactly like the old "Save as Word Doc" button.
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

    // Make sure the tags reflect the current text before deciding what (if
    // anything) goes to the calendar, in case Process Note was clicked
    // before the background auto-tag pass finished.
    let currentTags = tags;
    if (sentences.length > 0 && sentences !== taggedForRef.current) {
      setCheckingTags(true);
      const merged = await runTagging(sentences);
      setCheckingTags(false);
      if (merged) currentTags = merged;
    }

    const calendarText = sentences
      .filter((_, i) => currentTags[i] === "calendar")
      .join(" ")
      .trim();

    if (calendarText) {
      onSubmit(calendarText);
    }
  }

  const hasTaggableSentences = sentences.length > 0;
  const hasCalendarTag = tags.some((t) => t === "calendar");
  const busy = submitting || savingDocx || checkingTags;

  return (
    <div className="space-y-3">
      <textarea
        ref={ref}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (value.trim() && !busy) handleProcessNote();
          }
        }}
        placeholder={PLACEHOLDER}
        className="h-[36vh] min-h-[180px] w-full resize-none rounded-[10px] border border-border bg-bg-elevated px-5 py-4 text-lg leading-relaxed text-ink placeholder:text-ink-faint/80 focus-ring"
      />

      {hasTaggableSentences && (
        <div className="rounded-[10px] border border-border bg-bg-sunken px-4 py-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Tap a sentence to change its tag
          </p>
          <p className="text-sm leading-[1.9]">
            {fragments.map((f, fi) => {
              if (!f.isContent) return <span key={fi}>{f.text}</span>;
              const si = fragments.slice(0, fi).filter((x) => x.isContent).length;
              const tag = tags[si] ?? "doc";
              const suggested = tag === "calendar" && autoSuggested.has(si);
              return (
                <span
                  key={fi}
                  onClick={() => toggleTag(si)}
                  className={
                    tag === "calendar"
                      ? "cursor-pointer rounded border-b-2 border-indigo-border bg-indigo-bg px-1 py-0.5 text-indigo-text"
                      : "cursor-pointer rounded px-1 py-0.5 text-ink-muted hover:text-ink"
                  }
                >
                  {f.text}
                  {suggested && (
                    <span className="ml-1.5 rounded border border-indigo-border bg-bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-indigo-text align-middle">
                      suggested calendar event
                    </span>
                  )}
                </span>
              );
            })}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {docxNotice ??
            (hasTaggableSentences && !hasCalendarTag
              ? "No sentence tagged for the calendar â Process Note will just save the document."
              : "â / Ctrl + Enter to send")}
        </span>
        <button
          type="button"
          onClick={handleProcessNote}
          disabled={!value.trim() || busy}
          className="rounded-[10px] border border-indigo-border bg-indigo-bg px-7 py-2.5 text-sm font-semibold text-indigo-text transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:brightness-110"
        >
          {savingDocx ? "Savingâ¦" : checkingTags ? "Checkingâ¦" : submitting ? "Readingâ¦" : "Process Note"}
        </button>
      </div>
    </div>
  );
}
