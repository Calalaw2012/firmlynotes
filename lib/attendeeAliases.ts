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

// Keys are scoped per signed-in user (their email) so one attorney's
// remembered attendee names/emails never leak into another's suggestions.
function keyFor(userEmail: string, name: string): string {
  return `alias:${userEmail.toLowerCase()}:${name.trim().toLowerCase()}`;
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
 * "email" -- so future notes mentioning the same name auto-resolve without
 * asking again.
 */
export async function saveAttendeeAlias(
  userEmail: string,
  name: string,
  email: string
): Promise<void> {
  const store = kv();
  if (!store || !name.trim() || !email.trim()) return;

  await store.put(keyFor(userEmail, name), JSON.stringify({ email: email.trim().toLowerCase() }));
}
