# Firmly Notes

Type a note the way you'd say it out loud. Firmly Notes reads it, pulls out the date, time,
duration, attendees, and reminder, shows you what it found so you can fix anything, and then
puts it on your Google Calendar — with a Google Meet link attached if you asked for one. Built
as a companion to FirmlyResearch, in the same visual style.

Each visitor signs in with their own Google account, so notes always land on *their* calendar,
not a shared one. It's a firm-internal tool: only `@calalaw.com` Google accounts can sign in —
anyone else is turned away with an explanatory message.

## How it works

- **Frontend:** Next.js 14 (App Router) + Tailwind, single page at `/`.
- **Sign-in:** NextAuth.js with Google OAuth, restricted to the `calalaw.com` domain (see
  "Restricting sign-in" below). No database: tokens live in an encrypted session cookie and
  refresh automatically.
- **Note parsing:** the note text goes to the Anthropic API (Claude), which returns a
  structured event (title, date, start/end time, reminders, attendees, whether a video call was
  asked for) that you can edit before sending.
- **Attendees:** anyone the note names by email is used as-is. Anyone named without an email
  (e.g. "meeting with Sarah") is looked up against the signed-in user's Google Contacts and
  "other contacts" (people they've emailed but never explicitly saved) — automatically right
  after parsing, and via a live search-as-you-type box in the confirm card for adding more.
  An attendee that can't be matched is flagged so it can be fixed or removed before sending;
  the app never guesses an email address.
- **Google Meet:** checking "Add a Google Meet video call" attaches a real Meet link to the
  event via the Calendar API's conference-data support — no separate Meet/Zoom integration.
- **Sending:** on confirm, the event (with attendees and conference data) is created directly on
  the signed-in user's primary Google Calendar, and Google emails the invites.

Nothing is stored server-side — no database, no note history — beyond the current browser
session's "sent this session" list, which just links back to the events on Google Calendar.

---

## 1. Set up Google OAuth

Google restructured this flow into a few tabs under **Google Auth Platform** in Cloud Console
(if your console still shows a single old-style "OAuth consent screen" page, skip the tab names
below and just find the equivalent settings on that page instead).

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), and create a new
   project (or pick an existing one) — e.g. "Firmly Notes".
2. Open **Google Auth Platform** (left sidebar, or search "Auth Platform" / "OAuth consent
   screen" in the top search bar) and go through its tabs:
   - **Branding tab** — first-time setup runs a short "Get started" wizard here: app name
     ("Firmly Notes"), support email, etc.
   - **Audience tab** — choose the user type:
     - If this Cloud project was created under a **calalaw.com Google Workspace** account (i.e.
       calalaw.com is a Workspace domain, not just email hosting), choose **Internal**. Internal
       apps are automatically restricted to your Workspace's own users, skip Google's
       verification process entirely, and never show an "unverified app" warning — the best
       option for a firm-only tool like this one. If Internal isn't offered (the project isn't
       under a Workspace org, or calalaw.com isn't on Workspace), choose **External** instead
       and see "Restricting sign-in" below for how the app enforces the domain restriction
       itself.
     - **If External:** while the app is in **Testing**, only accounts added as test users here
       can sign in — add yourself and anyone else who needs early access. When ready for the
       whole firm, click **Publish app** on this tab; because the scopes below are Google
       "sensitive" scopes (not "restricted"), Google runs a brief verification (usually a few
       days, no security assessment) before removing the "unverified app" warning — you'll need
       a privacy policy URL and a link to the live app. The app still works for test users
       meanwhile. **If Internal:** there's no Testing/Publishing step at all.
   - **Data access tab** — click **Add or remove scopes**. These three likely won't be in the
     checkbox table (it mostly shows non-sensitive/common scopes, or scopes tied to APIs you've
     already enabled) — scroll to the **Manually add scopes** box near the bottom of that same
     panel and paste each full URL on its own line, then click the button next to the box to add
     it, then **Update** to save:
     - `https://www.googleapis.com/auth/calendar.events` — create/edit events (not full
       calendar read access)
     - `https://www.googleapis.com/auth/contacts.readonly` — read the user's saved Google
       Contacts
     - `https://www.googleapis.com/auth/contacts.other.readonly` — read their "other contacts"
       (people they've emailed via Gmail but never explicitly saved) — this is what makes typing
       just a first name work for most people, not only contacts saved on purpose.
     - Enabling the Calendar API and People API first (step 3 below) sometimes makes their
       scopes appear in the checkbox table too — either way works, manual entry just always
       works regardless of ordering.
   - **Clients tab** — **Create client**:
     - Application type: **Web application**.
     - Authorized redirect URIs — add both:
       - `http://localhost:3000/api/auth/callback/google` (for local development)
       - `https://firmlynotes.com/api/auth/callback/google` (production — update if you deploy
         under a different domain first, e.g. a `vercel.app` preview URL)
     - Save, then copy the **Client ID** and **Client secret** immediately — the secret isn't
       shown again later.
3. **APIs & Services → Library** — enable both:
   - **Google Calendar API**
   - **Google People API** (powers the attendee name-to-email lookup)

## 2. Get an Anthropic API key

1. Create a key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Note parsing calls are small (one short note in, one JSON object out), so cost per note is a
   small fraction of a cent even on Sonnet.

## 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_EMAIL_DOMAIN=calalaw.com   # see "Restricting sign-in" below
NEXTAUTH_SECRET=...        # generate with: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-5   # optional; this is the default
```

These are for local development only — deploying to Cloudflare (section 5 below) sets the
production values separately, as Cloudflare secrets/variables rather than this file.

## 4. Run it locally

```
npm install
npm run dev
```

Open http://localhost:3000, sign in with a Google account you added as a test user, and try a
note like:

> Deposition prep with Sarah, Thursday 2pm, 90 minutes, remind me the morning of

> Video call with John Ramirez and opposing counsel tomorrow at 10, add a Meet link

## 5. Deploy to Cloudflare

Since `firmlynotes.com` is already a Cloudflare-managed domain, deploying to **Cloudflare
Workers** means no DNS records to hand-copy anywhere — attaching the domain to the Worker (step
5 below) sets up the DNS side automatically. The app ships to Workers via the
[OpenNext adapter](https://opennext.js.org/cloudflare), which is why `open-next.config.ts` and
`wrangler.jsonc` are already in this project — the pieces below just configure and use them.
Deploying builds a standard Next.js production build and runs it in a Worker with Node.js APIs
enabled (the `nodejs_compat` flag in `wrangler.jsonc`), so the API routes, NextAuth, and
server-side `fetch` calls to Google/Anthropic all work the same as anywhere else Next.js runs.

You can deploy by pushing from your own machine with the CLI, or by connecting the repo to
Cloudflare so it builds and deploys automatically on every push — see "Option B" below.

### One-time setup

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up) if you don't have
   one (you likely already do, since the domain is there).
2. `npm install` — this pulls in `wrangler` and `@opennextjs/cloudflare` (already listed in
   `package.json`) alongside the app's normal dependencies.
3. `npx wrangler login` — opens a browser tab to authorize the CLI against your Cloudflare
   account. (Skip this if you're using Option B, the GitHub-connected path, exclusively —
   Cloudflare's own build environment doesn't need your machine to be logged in.)
4. Open `wrangler.jsonc` and check the `name` field (`"firmly-notes"`) — this becomes both the
   Worker's name in the dashboard and part of its default `*.workers.dev` URL. Change it now if
   you'd rather call it something else; it's a hassle to rename later.

### Set the environment variables and secrets

Cloudflare splits these into two buckets. **Secrets** are write-only (nobody, including you in
the dashboard, can read them back after saving) — use these for anything sensitive:

```
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put NEXTAUTH_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
```

Each command pauses and asks you to paste the value, one at a time. **Plain variables** (visible
in the dashboard, fine for non-sensitive config) are already set in `wrangler.jsonc`'s `vars`
block — `ALLOWED_EMAIL_DOMAIN` and `ANTHROPIC_MODEL` — edit that file directly if you need to
change them, rather than using `wrangler secret put`.

Two variables are set separately because their value depends on the domain:

```
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put NEXTAUTH_URL
```

(`GOOGLE_CLIENT_ID` isn't actually sensitive, but `wrangler.jsonc` is a file you'll likely commit
to Git, so it's simplest to keep both Google credentials together as secrets.) For
`NEXTAUTH_URL`, paste `https://firmlynotes.com` — no trailing slash.

### Option A: deploy from your machine

```
npm run deploy
```

This runs the OpenNext build (turns the Next.js build into a Worker) and then `wrangler deploy`.
Watch the output for the deployed URL — a `*.workers.dev` address you can use to sanity-check
the app before the custom domain is attached (step 5 below makes `firmlynotes.com` itself work).

### Option B: connect GitHub for automatic deploys

Instead of (or in addition to) deploying from your machine, Cloudflare can build and deploy
straight from your repo on every push:

1. Push this project to a GitHub repo, if you haven't already.
2. In the Cloudflare dashboard, go to **Workers & Pages → your Worker → Settings → Build →
   Connect** (or **Workers & Pages → Create → Connect to Git** if the Worker doesn't exist yet).
   Authorize Cloudflare's GitHub app and pick the repo.
3. Build settings: build command `npm run deploy` (or leave Cloudflare's Next.js preset if it
   offers one), and set the same secrets/variables from the step above in this build
   configuration's own **Environment variables** section — the build step doesn't automatically
   see values you set with `wrangler secret put` from your machine.
4. Pick the branch to deploy from (e.g. `main`). From then on, every push to that branch
   triggers a build and deploy automatically, and Cloudflare posts the build status back to the
   commit/PR on GitHub so you can see it without leaving your workflow.

Either option deploys the same Worker — use whichever fits how you want to make future changes;
switching between them later is fine.

### Attach the domain

5. In the dashboard, go to **Workers & Pages → your Worker → Settings → Domains & Routes → Add
   → Custom Domain**, and enter `firmlynotes.com`. Because the domain is already on Cloudflare,
   this creates the necessary DNS record for you — no registrar step, and typically live within
   a minute or two rather than hours.
6. Once that's done, double-check the Google OAuth redirect URI (step 1 near the top of this
   README) matches exactly — `https://firmlynotes.com/api/auth/callback/google` — and that the
   `NEXTAUTH_URL` secret you set above is exactly `https://firmlynotes.com` (no trailing slash).

### Making changes later

- Code/config changes: Option A, run `npm run deploy` again; Option B, just push.
- Changing a secret's value: re-run `npx wrangler secret put <NAME>` with the new value (works
  the same whether you're using Option A or B, since secrets live on the Worker, not in your
  repo).
- Local development (`npm run dev`) is unaffected by any of this — it still runs plain
  `next dev` against your `.env.local`, same as before. `npm run preview` runs the app through
  the actual Workers runtime locally first, if you want to sanity-check a change before
  deploying it for real.

## Customizing

- **Colors/branding:** `tailwind.config.ts` — the palette (`bg`, `ink`, `indigo`, `sage`,
  `success`, `danger`) was sampled from firmlyresearch.com so the two feel like the same
  product family. Change it there if your brand shifts.
- **Parsing behavior:** `lib/anthropic.ts` — the system prompt controls defaults (60-minute
  events, 30-minute-before popup reminders, how relative dates like "next Thursday" resolve).
- **Calendar target:** events are created on the signed-in user's `primary` calendar
  (`lib/googleCalendar.ts`) — change the calendar ID there if you'd rather target a specific
  shared firm calendar instead of each user's own.

## Restricting sign-in

Only `@calalaw.com` Google accounts can use the app. This is enforced in two layers
(`lib/auth.ts`):

1. The Google account picker is hinted to your Workspace domain (`hd=calalaw.com` on the
   authorization request) — mostly cosmetic, since Google still lets someone pick "use another
   account."
2. The real gate: NextAuth's `signIn` callback checks the signed-in account's email domain
   against `ALLOWED_EMAIL_DOMAIN` and rejects anything else, bouncing the person back to `/`
   with a message explaining the tool is firm-only. This runs regardless of the OAuth consent
   screen's user type (Internal or External), so it's a real second layer, not just UX polish.

If you used **Internal** user type on the OAuth consent screen (see step 1 above), Google
itself already refuses non-Workspace accounts before they ever reach this app — the
`signIn` callback becomes a backstop rather than the primary defense.

To change the allowed domain, update `ALLOWED_EMAIL_DOMAIN` (redeploy after changing it) and
the hardcoded domain name in the sign-in error message in `app/page.tsx`. Setting
`ALLOWED_EMAIL_DOMAIN` to an empty string turns the restriction off entirely.

## A note on scope

Every scope here is the narrowest one that does the job: `calendar.events` (not `calendar`) can
create and edit events it makes but can't read the rest of anyone's calendar; `contacts.readonly`
and `contacts.other.readonly` can look someone's email up by name but can't create, edit, or
delete a single contact. That keeps the Google consent screen as unscary as possible and the
verification bar as low as it can be for what the app does.

## Known limitation: contact lookup performance

`lib/googlePeople.ts` lists (not searches) the user's contacts and "other contacts" on every
attendee lookup, then matches locally — simpler and more reliable than Google's search
endpoints, which need their cache "warmed up" first to return good results. It pages through up
to ~1,000 saved contacts and ~2,000 other contacts per lookup, which is fine for a firm-sized
address book but would be worth caching (e.g. per-session, or a short-lived KV cache) if that
list grows into the tens of thousands or lookups start feeling slow.
