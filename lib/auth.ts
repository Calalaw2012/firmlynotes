import type { NextAuthOptions, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";

// Scopes: identify the user, create/edit events on their calendar (including
// attaching a Google Meet link, which rides along on calendar.events — no
// extra scope needed for that part), and look up attendees by name from
// their Google Contacts + "other contacts" (people they've emailed via
// Gmail but never explicitly saved). All three are Google "sensitive"
// scopes, not "restricted" — same verification bar as calendar.events alone.
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
].join(" ");

// Only accounts on this domain may sign in — a law firm's internal tool,
// not a public one. Empty/unset disables the restriction (anyone can sign in).
const ALLOWED_EMAIL_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? "calalaw.com")
  .trim()
  .toLowerCase();

interface GoogleToken extends JWT {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // seconds since epoch
  error?: string;
}

async function refreshAccessToken(token: GoogleToken): Promise<GoogleToken> {
  try {
    if (!token.refreshToken) {
      return { ...token, error: "MissingRefreshToken" };
    }
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const refreshed = await res.json();
    if (!res.ok) throw refreshed;

    return {
      ...token,
      accessToken: refreshed.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      // Google only sends a new refresh_token sometimes; keep the old one otherwise.
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (err) {
    console.error("Failed to refresh Google access token", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // The built-in Google provider preset normally resolves its OAuth
      // endpoints via `wellKnown` (a live https://accounts.google.com/
      // .well-known/openid-configuration discovery fetch through the
      // `openid-client` library). That library issues the request with
      // Node's raw `https.request()`, which Cloudflare Workers' nodejs_compat
      // layer does not implement "[unenv] https.request is not implemented
      // yet!" — it throws before the user ever reaches Google's sign-in
      // page. Setting `wellKnown: undefined` and supplying Google's (stable,
      // published) endpoints directly skips discovery entirely, so the
      // provider only ever uses ordinary `fetch`, which Workers supports.
      wellKnown: undefined,
      // The Google provider preset also defaults to `idToken: true`, which
      // tells next-auth to cryptographically verify the id_token Google
      // returns (via openid-client's `client.callback()`). That verification
      // needs an `issuer` (and a JWKS endpoint) that normally comes from the
      // `wellKnown` discovery document we just skipped — without it,
      // openid-client throws "issuer must be configured on the issuer" the
      // moment Google redirects back. We don't need that verification: the
      // `userinfo` endpoint below (a plain `fetch` call) already gets us the
      // user's verified profile straight from Google over HTTPS, which is
      // exactly what `profile()` maps below. Turning it off skips the
      // id_token check entirely and uses the userinfo endpoint instead.
      idToken: false,
      authorization: {
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          // Forces Google to re-issue a refresh_token on every sign-in.
          // Without a database we can't tell if we already have one on file,
          // so this keeps things simple and reliable.
          prompt: "consent",
          // UX nudge only, not enforcement: pre-restricts Google's account
          // chooser to this Workspace domain. A user can still pick "use
          // another account" and get a different one through, which is why
          // the signIn callback below is the real gate.
          ...(ALLOWED_EMAIL_DOMAIN ? { hd: ALLOWED_EMAIL_DOMAIN } : {}),
        },
      },
      token: "https://oauth2.googleapis.com/token",
      userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  // Both point back at the app's own page so it can show an on-brand message
  // instead of NextAuth's default unstyled error screen (see app/page.tsx,
  // which reads ?error= off the URL).
  pages: {
    signIn: "/",
    error: "/",
  },
  callbacks: {
    async signIn({ user }) {
      if (!ALLOWED_EMAIL_DOMAIN) return true;
      const domain = user.email?.split("@")[1]?.toLowerCase();
      return domain === ALLOWED_EMAIL_DOMAIN;
    },
    async jwt({ token, account }): Promise<JWT> {
      const t = token as GoogleToken;

      // Initial sign-in: persist the tokens Google just issued.
      if (account) {
        t.accessToken = account.access_token;
        t.refreshToken = account.refresh_token;
        t.expiresAt = account.expires_at as number | undefined;
        t.error = undefined;
        return t;
      }

      // Still valid (with a 60s safety margin).
      if (t.expiresAt && Date.now() / 1000 < t.expiresAt - 60) {
        return t;
      }

      return refreshAccessToken(t);
    },
    async session({ session, token }): Promise<Session> {
      const t = token as GoogleToken;
      // Deliberately NOT attaching accessToken/refreshToken to the session:
      // useSession() on the client would expose it to page JS. API routes
      // read the token server-side instead (see lib/googleCalendar.ts).
      session.calendarConnected = Boolean(t.accessToken) && !t.error;
      session.authError = t.error ?? null;
      return session;
    },
  },
};
