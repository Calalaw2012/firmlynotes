import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";

/**
 * Turns free-form note text into a .docx file and saves it, letting the
 * user pick the file name and folder when the browser supports the File
 * System Access API. Falls back to a normal browser download (into their
 * default Downloads folder) on browsers that don't support it -- e.g.
 * Firefox and Safari, which don't implement showSaveFilePicker.
 */
export async function saveNoteAsWordDoc(
  text: string,
  userName: string
): Promise<{ saved: boolean; filename: string }> {
  const filename = deriveFilename(userName);
  const blob = await buildDocxBlob(text, filename);

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

/**
 * "Notes - Peter Calabrese, 09.25.2026, 5:38 p.m..docx" -- the signed-in
 * user's display name plus the date and time of the download itself, not
 * anything derived from the note's own text.
 */
function deriveFilename(userName: string): string {
  const safeName = userName.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Notes";
  const now = new Date();
  return `Notes - ${safeName}, ${formatDownloadDate(now)}, ${formatDownloadTime(now)}.docx`;
}

function formatDownloadDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}.${dd}.${d.getFullYear()}`;
}

function formatDownloadTime(d: Date): string {
  const h24 = d.getHours();
  const ampm = h24 >= 12 ? "p.m." : "a.m.";
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}

// Small, muted gray -- Word's own default header/footer color -- so the
// filename and page number read as page furniture, not body text.
const HEADER_FOOTER_COLOR = "595959";
const HEADER_FOOTER_SIZE = 18; // half-points -- 9pt

async function buildDocxBlob(text: string, filename: string): Promise<Blob> {
  const lines = text.split("\n");
  const paragraphs = (lines.length ? lines : [""]).map(
    (line) => new Paragraph({ children: [new TextRun(line)] })
  );

  // The header/footer repeat the same name the user sees in the save
  // dialog, minus the .docx extension -- so a printed or emailed copy is
  // still identifiable once it's out of the file system.
  const displayName = filename.replace(/\.docx$/i, "");

  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: displayName,
                    size: HEADER_FOOTER_SIZE,
                    color: HEADER_FOOTER_COLOR,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: HEADER_FOOTER_SIZE,
                    color: HEADER_FOOTER_COLOR,
                  }),
                ],
              }),
            ],
          }),
        },
        children: paragraphs,
      },
    ],
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
