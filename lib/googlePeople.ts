export interface ContactMatch {
  name: string;
  email: string;
  source: "contacts" | "other";
}

interface PeopleApiPerson {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
}

async function fetchPeoplePage(
  accessToken: string,
  url: string
): Promise<{ people: PeopleApiPerson[]; nextPageToken?: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Missing/stale contacts scope, or the API being briefly unhappy,
    // shouldn't break attendee entry — callers just get fewer/no matches.
    console.error("People API request failed", res.status, await res.text().catch(() => ""));
    return { people: [] };
  }
  const data = await res.json();
  return {
    people: (data.connections ?? data.otherContacts ?? []) as PeopleApiPerson[],
    nextPageToken: data.nextPageToken,
  };
}

async function fetchAllPages(
  accessToken: string,
  baseUrl: string,
  maxPages: number
): Promise<PeopleApiPerson[]> {
  let people: PeopleApiPerson[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const url = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
    const page = await fetchPeoplePage(accessToken, url);
    people = people.concat(page.people);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return people;
}

function toMatches(people: PeopleApiPerson[], source: ContactMatch["source"]): ContactMatch[] {
  const out: ContactMatch[] = [];
  for (const p of people) {
    const name = p.names?.[0]?.displayName?.trim() ?? "";
    for (const e of p.emailAddresses ?? []) {
      if (e.value) out.push({ name: name || e.value, email: e.value, source });
    }
  }
  return out;
}

/**
 * Looks up matching people from the signed-in user's Google Contacts
 * ("connections") and "other contacts" (auto-collected from Gmail), by
 * name or email substring.
 *
 * Deliberately uses the plain list endpoints rather than
 * people:searchContacts / otherContacts:search — those search endpoints
 * need their cache "warmed up" by an earlier list call before they return
 * good results, which is a well-known footgun. Listing directly and
 * matching here is simpler and predictable, at the cost of paging through
 * up to ~3,000 contacts per search — fine for a firm-sized contact list;
 * worth adding a caching layer if that ever becomes slow.
 */
export async function searchGoogleContacts(
  accessToken: string,
  query: string
): Promise<ContactMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [connections, otherContacts] = await Promise.all([
    fetchAllPages(
      accessToken,
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=1000",
      1
    ),
    fetchAllPages(
      accessToken,
      "https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses&pageSize=1000",
      2
    ),
  ]);

  const all = [...toMatches(connections, "contacts"), ...toMatches(otherContacts, "other")];

  // De-dupe by email; prefer the saved-contact copy (has a real name more often).
  const byEmail = new Map<string, ContactMatch>();
  for (const c of all) {
    const key = c.email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing || (existing.source === "other" && c.source === "contacts")) {
      byEmail.set(key, c);
    }
  }

  // Match every word of the query independently (order-agnostic), rather
  // than requiring the whole query as one contiguous substring. A note
  // written as "John McDermott" should still find a contact saved as
  // "McDermott, John" or with a middle name -- a single combined substring
  // check misses those.
  const qWords = q.split(/\s+/).filter(Boolean);

  return Array.from(byEmail.values())
    .filter((c) => {
      const haystack = `${c.name.toLowerCase()} ${c.email.toLowerCase()}`;
      return qWords.every((w) => haystack.includes(w));
    })
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      if (a.source !== b.source) return a.source === "contacts" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}
