import { NextRequest, NextResponse } from "next/server";
import { getUserEmail } from "@/lib/googleCalendar";
import { saveAttendeeAlias } from "@/lib/attendeeAliases";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Persists a confirmed attendee "name" -> "email" pairing so future notes
// mentioning the same name auto-resolve instead of asking again. Called
// from AttendeesEditor whenever a named attendee (not a bare email) is
// added.
export async function POST(req: NextRequest) {
  const userEmail = await getUserEmail(req);
  if (!userEmail) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { name?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  if (!name || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A name and a valid email are required." }, { status: 400 });
  }

  try {
    await saveAttendeeAlias(userEmail, name, email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("saving attendee alias failed", err);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
