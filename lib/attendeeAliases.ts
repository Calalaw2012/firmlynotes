import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface AttendeeAlias {
  email: string;
}

// Minimal surface of the Cloudflare KV binding this file needs. Typed
// locally (instead of relying on ambient KVNamespace types, which may not
// be configured for this project) so this compiles regardless.
interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

function kv(): KVLike | null {
  try {
    const ns = (getCloudflareContext().env as Record<string, unknown>)
      .ATTENDEE_ALIASES as KVLike | undefined;
    return ns ?? null;
  } catch {
    // Not running in a Cloudflare Workers request context (e.g. local dev
    // without wrangler) -- treat as "no alias store available".
    return null;
  }
}

// Collapses whitespace and strips a trailing comma/period/semicolon/colon
// (the kind a name picks up from note punctuation, e.g. "with Sarah Chen,
// and John") before it becomes part of the lookup key -- otherwise a
// trivially different spelling of the exact same name misses the exact-
// match lookup below.
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/g, "");
}

// Keys are scoped per signed-in user (their email) so one attorney's
// remembered attendee names/emails never leak into another's suggestions.
function keyFor(userEmail: string, name: string): string {
  return `alias:${userEmail.toLowerCase()}:${normalizeName(name)}`;
}

/** The first word of a normalized multi-word name, or null for a single-word name (which is already its own key). */
function firstNameOf(name: string): string | null {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

/**
 * Looks up a previously-confirmed name -> email mapping for this user.
 * Returns null if there's no KV binding, or nothing has been saved yet for
 * this name.
 */
export async function getAttendeeAlias(
  userEmail: string,
  name: string
): Promise<AttendeeAlias | null> {
  const store = kv();
  if (!store || !name.trim()) return null;

  const raw = await store.get(keyFor(userEmail, name));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AttendeeAlias;
    return parsed.email ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remembers that, for this user, the attendee name "name" resolves to
 * "email" -- so future notes mentioning the same name auto-resolve
 * without asking again.
 *
 * Also remembers a first-name-only shortcut when the name has more than
 * one word (e.g. saving "Sarah Chen" also tries "Sarah"), so a later note
 * that only gives the first name still resolves -- unless that first name
 * is already aliased to a *different* email for this user, in which case
 * the shortcut is cleared instead of silently guessing which of two
 * same-first-named contacts a bare first name means going forward. The
 * full name stays exact-match only either way.
 */
export async function saveAttendeeAlias(
  userEmail: string,
  name: string,
  email: string
): Promise<void> {
  const store = kv();
  if (!store || !name.trim() || !email.trim()) return;

  const normalizedEmail = email.trim().toLowerCase();
  await store.put(keyFor(userEmail, name), JSON.stringify({ email: normalizedEmail }));

  const firstName = firstNameOf(name);
  if (!firstName) return;

  const firstNameKey = keyFor(userEmail, firstName);
  const existingRaw = await store.get(firstNameKey);
  if (!existingRaw) {
    await store.put(firstNameKey, JSON.stringify({ email: normalizedEmail }));
    return;
  }
  try {
    const existing = JSON.parse(existingRaw) as AttendeeAlias;
    if (existing.email && existing.email !== normalizedEmail) {
      await store.delete(firstNameKey);
    }
  } catch {
    await store.put(firstNameKey, JSON.stringify({ email: normalizedEmail }));
  }
}
