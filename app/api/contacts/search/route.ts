import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccessToken, GoogleAuthError, getUserEmail } from "@/lib/googleCalendar";
import { searchGoogleContacts } from "@/lib/googlePeople";
import { getAttendeeAlias } from "@/lib/attendeeAliases";

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

  const userEmail = await getUserEmail(req);

  try {
    const [matches, alias] = await Promise.all([
      searchGoogleContacts(accessToken, query),
      userEmail ? getAttendeeAlias(userEmail, query) : Promise.resolve(null),
    ]);

    // A remembered name -> email choice for this exact query wins: surface
    // it first (and drop any duplicate further down) so the caller can
    // treat it as the confident, "we remember this" pick rather than one
    // suggestion among several. Widened to a local type here (rather than
    // ContactMatch[]) since "alias" isn't one of that type's source values.
    let ranked: { name: string; email: string; source: string }[] = matches;
    if (alias) {
      ranked = [
        { name: query, email: alias.email, source: "alias" },
        ...matches.filter((m) => m.email !== alias.email),
      ];
    }

    return NextResponse.json({ matches: ranked, aliasEmail: alias?.email ?? null });
  } catch (err) {
    console.error("contact search failed", err);
    return NextResponse.json({ matches: [] });
  }
}
