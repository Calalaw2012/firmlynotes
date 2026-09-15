import { Document, Packer, Paragraph, TextRun } from "docx";

/**
 * Turns free-form note text into a .docx file and saves it, letting the
 * user pick the file name and folder when the browser supports the File
 * System Access API. Falls back to a normal browser download (into their
 * default Downloads folder) on browsers that don't support it -- e.g.
 * Firefox and Safari, which don't implement showSaveFilePicker.
 */
export async function saveNoteAsWordDoc(
  text: string
): Promise<{ saved: boolean; filename: string }> {
  const filename = deriveFilename(text);
  const blob = await buildDocxBlob(text);

  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "Word Document",
            accept: {
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                [".docx"],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, filename: handle.name };
    } catch (err) {
      // The user closing the save dialog isn't an error -- just report
      // that nothing was saved. Any other failure falls through to the
      // plain-download fallback below.
      if (err instanceof DOMException && err.name === "AbortError") {
        return { saved: false, filename };
      }
    }
  }

  downloadBlob(blob, filename);
  return { saved: true, filename };
}

function deriveFilename(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const base = (firstLine ?? "Note").replace(/[^a-zA-Z0-9 _-]+/g, " ").trim();
  const truncated = base.slice(0, 60).trim() || "Note";
  return `${truncated}.docx`;
}

async function buildDocxBlob(text: string): Promise<Blob> {
  const lines = text.split("\n");
  const paragraphs = (lines.length ? lines : [""]).map(
    (line) => new Paragraph({ children: [new TextRun(line)] })
  );
  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBlob(doc);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Minimal shape of the File System Access API used here -- it's not yet in
// TypeScript's built-in DOM lib, so it's declared locally.
type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandleLike>;

interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
