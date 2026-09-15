export interface ContactMatch {
  name: string;
  email: string;
  source: "contacts" | "other" | "directory";
}

interface PeopleApiPerson {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
}

type PeopleListField = "connections" | "otherContacts" | "people";

async function fetchPeoplePage(
  accessToken: string,
  url: string,
  listField: PeopleListField
): Promise<{ people: PeopleApiPerson[]; nextPageToken?: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Missing/stale contacts or directory scope, or the API being briefly
    // unhappy, shouldn't break attendee entry -- callers just get
    // fewer/no matches from that source.
    console.error("People API request failed", res.status, await res.text().catch(() => ""));
    return { people: [] };
  }
  const data = await res.json();
  return {
    people: (data[listField] ?? []) as PeopleApiPerson[],
    nextPageToken: data.nextPageToken,
  };
}

async function fetchAllPages(
  accessToken: string,
  baseUrl: string,
  listField: PeopleListField,
  maxPages: number
): Promise<PeopleApiPerson[]> {
  let people: PeopleApiPerson[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const url = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
    const page = await fetchPeoplePage(accessToken, url, listField);
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

// Preference order when the same email address shows up from more than one
// source: an explicitly-saved personal contact wins (most likely to have a
// deliberately-chosen display name), then the firm's Workspace directory
// (an official name for a colleague), then "other contacts" (just
// auto-collected from Gmail, often no real name at all).
const SOURCE_PRIORITY: Record<ContactMatch["source"], number> = {
  contacts: 0,
  directory: 1,
  other: 2,
};

/**
 * Looks up matching people from the signed-in user's Google Contacts
 * ("connections"), "other contacts" (auto-collected from Gmail), and the
 * calalaw.com Workspace directory (every colleague at the firm, whether or
 * not Peter has ever emailed or saved them), by name or email substring.
 *
 * Deliberately uses the plain list endpoints rather than
 * people:searchContacts / otherContacts:search / people:searchDirectoryPeople
 * -- those search endpoints need their cache "warmed up" by an earlier list
 * call before they return good results, which is a well-known footgun.
 * Listing directly and matching here is simpler and predictable, at the
 * cost of paging through the firm's full contacts/directory per search --
 * fine for a firm-sized list; worth adding a caching layer if that ever
 * becomes slow.
 *
 * The directory lookup requires the directory.readonly OAuth scope (see
 * lib/auth.ts) and the calalaw.com Workspace admin's directory-sharing
 * setting to allow it -- until both are in place, Google returns an error
 * for that one source and this just falls back to contacts + other
 * contacts, same as before.
 */
export async function searchGoogleContacts(
  accessToken: string,
  query: string
): Promise<ContactMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [connections, otherContacts, directory] = await Promise.all([
    fetchAllPages(
      accessToken,
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=1000",
      "connections",
      1
    ),
    fetchAllPages(
      accessToken,
      "https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses&pageSize=1000",
      "otherContacts",
      2
    ),
    fetchAllPages(
      accessToken,
      "https://people.googleapis.com/v1/people:listDirectoryPeople" +
        "?readMask=names,emailAddresses" +
        "&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE" +
        "&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT" +
        "&pageSize=1000",
      "people",
      5
    ),
  ]);

  const all = [
    ...toMatches(connections, "contacts"),
    ...toMatches(otherContacts, "other"),
    ...toMatches(directory, "directory"),
  ];

  // De-dupe by email; prefer whichever source ranks highest above.
  const byEmail = new Map<string, ContactMatch>();
  for (const c of all) {
    const key = c.email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing || SOURCE_PRIORITY[c.source] < SOURCE_PRIORITY[existing.source]) {
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
      if (a.source !== b.source) return SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}
