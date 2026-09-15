import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccessToken, GoogleAuthError } from "@/lib/googleCalendar";
import { searchGoogleContacts } from "@/lib/googlePeople";

export async function GET(req: NextRequest) {
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(req);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";
  if (!query.trim()) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const matches = await searchGoogleContacts(accessToken, query);
    return NextResponse.json({ matches });
  } catch (err) {
    console.error("contact search failed", err);
    return NextResponse.json({ matches: [] });
  }
}
