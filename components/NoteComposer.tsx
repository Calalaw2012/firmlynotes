"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { saveNoteAsWordDoc } from "@/lib/saveAsWord";

const PLACEHOLDER = "Type here...create notes,  calendar entries, video and conference call invites";

/**
 * The button's own state, independent of whether speech recognition is
 * actively producing text at this instant:
 * - idle: not listening.
 * - recording: mic is on, no interim transcript yet (still waiting for the
 *   user to actually say something, or between phrases).
 * - processing: mic is on AND the API has an interim (not-yet-final)
 *   transcript in hand -- i.e. it's actively turning speech into text right
 *   now. Gets its own indigo styling so it visibly differs from a plain
 *   "recording" idle-listening state.
 * - blocked: the browser denied microphone access (e.g. a site permission
 *   the user previously declined). Auto-reverts to idle after 2.5s.
 * - unsupported: this browser has no SpeechRecognition API at all. The
 *   button stays visible but disabled, rather than disappearing, so it's
 *   clear dictation exists but isn't available here.
 */
type DictateState = "idle" | "recording" | "processing" | "blocked" | "unsupported";

/** A space if `before` doesn't already end in whitespace, else nothing. */
function spacer(before: string): string {
  return before.length === 0 || /\s$/.test(before) ? "" : " ";
}

/**
 * Toggles the browser's built-in speech-to-text (Web Speech API), inserting
 * the transcript at wherever the cursor was in the note when dictation
 * started -- not always at the end of the existing text. Requires the
 * textarea's own ref so it can read/restore the real caret position, since
 * a controlled <textarea>'s selection isn't something React tracks for you.
 */
function DictateButton({
  value,
  onChange,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}) {
  const [dictateState, setDictateState] = useState<DictateState>("idle");
  const recognitionRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const blockedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Captured the instant dictation starts: everything before/after the
  // cursor at that moment. Speech gets spliced in between the two: nothing
  // typed elsewhere in the note is disturbed, and the insertion point
  // itself advances as committed (final) words come in.
  const beforeRef = useRef("");
  const afterRef = useRef("");
  const committedRef = useRef("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  function moveCaretTo(pos: number) {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) el.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setDictateState("unsupported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += transcript;
        } else {
          interimChunk += transcript;
        }
      }
      if (finalChunk) {
        const soFar = beforeRef.current + committedRef.current;
        committedRef.current = `${committedRef.current}${spacer(soFar)}${finalChunk.trim()} `;
        const newValue = `${beforeRef.current}${committedRef.current}${afterRef.current}`;
        onChangeRef.current(newValue);
        setDictateState("recording");
        moveCaretTo(beforeRef.current.length + committedRef.current.length);
      } else if (interimChunk) {
        const newValue = `${beforeRef.current}${committedRef.current}${interimChunk}${afterRef.current}`;
        onChangeRef.current(newValue);
        setDictateState("processing");
        moveCaretTo(beforeRef.current.length + committedRef.current.length + interimChunk.length);
      } else {
        setDictateState("recording");
      }
    };

    recognition.onerror = (event: any) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setDictateState("blocked");
        if (blockedTimeoutRef.current) clearTimeout(blockedTimeoutRef.current);
        blockedTimeoutRef.current = setTimeout(() => setDictateState("idle"), 2500);
      } else {
        setDictateState("idle");
      }
    };
    recognition.onend = () => {
      setDictateState((prev) => (prev === "blocked" ? prev : "idle"));
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      if (blockedTimeoutRef.current) clearTimeout(blockedTimeoutRef.current);
    };
  }, [textareaRef]);

  function toggle() {
    const recognition = recognitionRef.current;
    if (!recognition || dictateState === "unsupported" || dictateState === "blocked") return;
    if (dictateState === "recording" || dictateState === "processing") {
      recognition.stop();
      setDictateState("idle");
      return;
    }
    const el = textareaRef.current;
    const cursor = el ? el.selectionStart ?? value.length : value.length;
    beforeRef.current = value.slice(0, cursor);
    afterRef.current = value.slice(cursor);
    committedRef.current = "";
    try {
      recognition.start();
      setDictateState("recording");
    } catch {
      // Already running (e.g. rapid double-click) -- ignore.
    }
  }

  const active = dictateState === "recording" || dictateState === "processing";
  const label =
    dictateState === "processing"
      ? "Processing voice…"
      : dictateState === "recording"
        ? "Listening…"
        : dictateState === "blocked"
          ? "Mic blocked"
          : dictateState === "unsupported"
            ? "Not supported"
            : "Dictate";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={dictateState === "unsupported" || dictateState === "blocked"}
      aria-pressed={active}
      title={
        dictateState === "unsupported"
          ? "Dictation isn't supported in this browser"
          : dictateState === "blocked"
            ? "Microphone access was blocked"
            : active
              ? "Stop dictating"
              : "Dictate note using your device's speech-to-text"
      }
      className={`flex items-center gap-2 rounded-[10px] border px-4 py-2.5 text-sm font-semibold transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        dictateState === "processing"
          ? "border-indigo-border bg-indigo-bg text-indigo-text"
          : dictateState === "recording"
            ? "border-danger/40 bg-danger/10 text-danger"
            : dictateState === "blocked"
              ? "border-danger/40 text-danger"
              : "border-border text-ink-muted hover:border-sage hover:text-sage"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-4 w-4 shrink-0 ${active ? "animate-pulse" : ""}`}
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      {label}
    </button>
  );
}

export default function NoteComposer({
  value,
  onChange,
  onClear,
  parsing,
  countdown,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  /** True while the note is actually being sent to the parser right now. */
  parsing: boolean;
  /** Seconds left before the debounced auto-parse fires, or null when idle. */
  countdown: number | null;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  function handleClear() {
    if (!value) return;
    onClear();
    setNotice(null);
  }

  // Processing status takes priority over the save notice and the default
  // helper text -- it's shown here, on the note card itself, so it's
  // visible from the very first keystroke, well before any event card
  // exists on the other side.
  const statusText = parsing
    ? "processing…"
    : countdown !== null
      ? `processing… ${countdown}s`
      : (notice ?? "Every schedulable item in the note shows up on the right, a few seconds after you stop typing.");

  return (
    <div className="space-y-3">
      <textarea
        ref={textareaRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER}
        className="h-[50vh] min-h-[260px] w-full resize-none rounded-[10px] border border-border bg-bg-elevated px-5 py-4 text-lg leading-relaxed text-ink placeholder:text-ink-faint/80 focus-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">{statusText}</span>
        <div className="flex flex-wrap items-center gap-2">
          <DictateButton value={value} onChange={onChange} textareaRef={textareaRef} />
          <button
            type="button"
            onClick={handleClear}
            disabled={!value}
            className="rounded-[10px] border border-border px-4 py-2.5 text-sm font-semibold text-ink-muted transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:border-danger/50 hover:text-danger"
          >
            Clear note
          </button>
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
    </div>
  );
}
