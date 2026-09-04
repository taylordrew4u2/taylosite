# taylosite

The Taylor Drew website — a black / white / red brutalist site with a full admin
panel at `/admin` where every word, link, photo, date and colour on the public
pages can be edited.

No build step, no framework, no npm dependencies. Node 18+ and `node server.js`.

## Running it

```bash
npm start          # http://localhost:3000
PORT=8080 npm start
```

- Public site: `/`, `/about`, `/reels`, `/links`
- Admin panel: `/admin`
- Default password: **`weed`** — change it in **Admin → Security**. (Set
  `ADMIN_PASSWORD` before the very first run to seed a different one.)

## Tests

```bash
npm test
```

Node's built-in runner, no test dependencies. Covers input sanitising (unsafe
URL schemes, forged click counts, credentials in the payload, oversized text),
both storage backends against one shared contract, and the HTTP surface
end-to-end against a real server process — auth, CSRF, rate limiting, upload
validation, path traversal, click counting, snapshots and restore.

The serverless backend is exercised against a stand-in for Upstash's REST API
(`test/helpers/fake-redis.js`), so the Redis path runs for real without needing
credentials.

## What the admin panel can edit

| Section | What it controls |
| --- | --- |
| **Overview** | Live stats, most-clicked links, quick actions |
| **Brand & SEO** | Name, logo text, location, booking email, page title, description, social share image, favicon, Google/Bing verification codes |
| **Home page** | Kicker, big headline, subhead, hero photo + alt text, both buttons (label / link / visibility), the "Upcoming" block |
| **Reels** | The wall at `/reels` — pulled from the connected Instagram account, plus any reels pinned by hand |
| **Links** | Add, edit, delete, reorder (drag or arrows), hide, feature; label, sub-label, URL; click counts per link |
| **Shows** | Date, time, venue, city, ticket link, button label, note, sold-out and hidden flags |
| **About page** | Kicker, title, photo, unlimited bio paragraphs, label/value facts, credits and awards, press quotes, questions and answers |
| **Navigation** | The header menu — labels, targets, order, visibility |
| **Themes** | Every colour of every scheme, and which one the site is served with |
| **Footer** | Left text, right text and its link, optional middle note |
| **Media** | Upload / browse / delete images, copy URLs |
| **Backups & data** | Restore any of the last 30 auto-snapshots, export or import the whole site as JSON, reset to defaults |
| **Security** | Change password, see signed-in devices, sign out everywhere |

Editing notes:

- Changes are held locally until **Save changes** (or `⌘/Ctrl+S`); the tab warns
  before you navigate away with unsaved work. The sidebar marks which sections
  have unsaved edits, and edits you undo by hand clear themselves.
- **Preview** opens a live pane of the real pages beside the form.
- Media items show where they are in use, and deleting one that is in use says
  so before it goes.
- A headline of one or two words stacks one word per line like `TAYLOR / DREW`;
  longer headings wrap at a smaller size instead.
- Links pointing at `http(s)` go through `/go/<id>` so clicks are counted; the
  visitor lands on the real URL.
- Shows whose date has passed drop off the home page and move to a "Past"
  list at the bottom of the links page automatically.

## How it is put together

```
server.js            HTTP server, routing, JSON API, sessions, uploads
api/index.js         Vercel entrypoint — hands each invocation to that server
lib/defaults.js      the starting content for a fresh install
lib/schema.js        validates + sanitises everything the admin panel sends
lib/storage.js       the two storage backends (filesystem / serverless)
lib/store.js         site document, snapshots and uploads on top of a backend
lib/auth.js          scrypt password hashing, sessions, login rate limiting
lib/render.js        server-side HTML for the three public pages
public/admin.html    the admin panel shell
public/assets/       site + admin CSS and JS
data/                site.json, sessions, snapshots, uploads (git-ignored)
```

Pages are rendered on the server, so the site works with JavaScript disabled and
reads correctly to search engines and link previews. The admin panel is a
single-page app that talks to the JSON API.

### Findability and accessibility

All of this is machine-facing — none of it changes a single pixel of the page.

Every page carries canonical, Open Graph and Twitter card tags built from the
admin content, plus one `schema.org` graph rather than loose objects: a
`WebSite`, the `Person` (with her booking `ContactPoint`), the page itself
(`WebPage` / `ProfilePage` / `CollectionPage` — `ProfilePage` sits on `/about`
wrapping the person, which is the case Google documents as valid, rather than
on a mixed-content home page, which it documents as invalid), a
`BreadcrumbList` on sub-pages, a `Quotation` per press quote attributed to who said it, an
`FAQPage` of her own answers on `/about`, and an `Event` per upcoming show
carrying a real `PostalAddress` (open a date's row in the admin panel to add
the venue's street address — `Event` is the one type here that still earns a
documented Google search appearance, and a full address is what it wants), its
door time as a real start time, and an `Offer` with its ticket link and
sold-out status. The nodes cross-reference by
`@id`, so a crawler can tell that the site, the page and the performer are one
subject and the shows are hers.

A note on what this does and does not buy. Google's own documentation is
explicit that no AI-specific file or markup is needed to appear in AI Overviews
or AI Mode, that `llms.txt` is ignored by Google Search outright, and that FAQ
rich results stopped appearing in May 2026. So `/llms.txt` and the `FAQPage`
markup are kept because they cost nothing, are harmless by Google's own
statement, and may be read by other engines — not because they are known to
work. The parts with documented payoff are narrower: `Event` for tour dates,
`ProfilePage` for disambiguation, and ordinary crawlability and indexing, which
is the only stated gate on AI Overview eligibility. Treat the rest as cheap
optionality rather than as a ranking lever.

The **Questions** section of the about page is the part aimed squarely at
answer engines. Anything asked often enough to be worth answering — who she is,
where to see her, how to book her — is answered there in her words, and the
same text is published three ways: on the page, in `/llms.txt`, and as
structured `Question` / `Answer` pairs. When a model is asked about her, that
is what it has to repeat instead of guessing.

`/llms.txt` is the plain-text summary answer engines fetch before crawling —
generated from the same content the pages render, linked from every page's head
and pointed at from `robots.txt`. Verification codes for Google Search Console
and Bing Webmaster Tools go in **Brand & SEO**; either accepts the bare token
or the whole `<meta>` tag pasted in, and anything that is not a token is
refused rather than written into the head.

Social profiles among the links become `sameAs` in the graph and `rel="me"` in
the head, and a linked X profile supplies the Twitter card's `creator`. The
`robots` meta opts into large image previews and untruncated snippets.
`/sitemap.xml` and `/robots.txt` are generated from the live content, and a URL
with a trailing slash is redirected rather than answering as a duplicate.

The hero image is preloaded and marked `fetchpriority="high"`, and images below
the fold are lazy, which is what the Core Web Vitals measurement actually
rewards.

There is a skip link, `aria-current` on the active nav item, real `<time>`
elements on show dates, visible focus rings, a keyboard-closable mobile menu,
and a `prefers-reduced-motion` opt-out.

### The reel wall

`/reels` is one edge-to-edge grid: no padding, no gaps, every tile the 9:16 a
reel is shot in, separated by hairlines rather than space.

A tile plays silently on a loop when the reel has a **video URL** of its own.
Instagram's embed cannot be made to autoplay from another site — that is their
player's decision, not a setting we are missing — so a reel with only a
permalink falls back to that embed, and one with a poster falls back to the
still. Videos are `muted playsinline`, which is what lets a phone play them
inline at all, and an `IntersectionObserver` plays only the tiles on screen and
pauses the rest: twenty videos decoding at once will stall a phone. Anyone who
asked for reduced motion gets controls instead of movement.

### Connecting the Instagram account

`/reels` fills itself from the account: captions, cover frames, and the MP4
behind each reel — which is the whole point, because that file is what makes a
silent autoplaying loop possible. Instagram's embed cannot be made to autoplay
from another site; their own API is the only route to a wall that moves.

Set these two and a **Connect Instagram** button appears in **Admin → Reels**:

| Variable | |
| --- | --- |
| `INSTAGRAM_APP_ID` | Instagram app ID |
| `INSTAGRAM_APP_SECRET` | Instagram app secret — read server-side only, never sent to the browser |
| `INSTAGRAM_USER_ID` | optional, defaults to `me` |
| `INSTAGRAM_LIMIT` | optional, defaults to 24 |
| `INSTAGRAM_TOKEN` | optional seed: an existing long-lived token, adopted on first sight |

Both come from **Meta App Dashboard → Instagram → API setup with Instagram
login → Set up Instagram business login**. Add `https://<your-domain>/admin` to
that app's **OAuth redirect URIs** — the panel prints the exact string it will
send. The button opens Meta's authorization window asking for
`instagram_business_basic`; approving it returns to `/admin?code=…`, and the
panel redeems that code, exchanges it for a 60-day token and wipes it from the
address bar. The account must be a **Business** or **Creator** account.

**Why the token is not simply an environment variable.** A long-lived token
lasts 60 days, and Meta's rule is that one not refreshed inside that window can
never be refreshed again. A token pasted into the environment and forgotten
would work all summer and break in the autumn, silently. So the site stores it
and renews it: any token within ten days of expiry (and older than the 24 hours
Meta requires) is refreshed on the next request, and a failed refresh keeps the
working token rather than discarding it. An `INSTAGRAM_TOKEN` is adopted into
the same store on first sight so that it, too, is kept alive.

It lives at `site.auth.instagram` — `auth` is the one branch `publicSite()`
strips before anything is served and that `normalizeSite()` never takes from
user input, so it cannot leak through `/api/content` or be overwritten by a
form post. The admin panel is told the connection's *state*, never the token.

Reels added by hand in the admin panel are **pinned above** the feed, and a
pinned reel is matched against the feed by permalink so the same one never
appears twice.

The MP4 URLs their API returns are signed and expire within hours, so nothing
is written into the site document: the wall is rendered from a 20-minute cache
and re-fetched, which keeps every link fresh and stays far inside the 200
calls/hour limit. If Instagram is unreachable the last good wall is served for
up to a day rather than blanking the page, and an expired token is reported as
an expired token rather than as "no reels" — that one needs the owner to act.
`/healthz` reports whether the account is connected at all.

Uploads accept `mp4` and `webm`, but whether a video *fits* is the storage
backend's call — Redis caps uploads at 700 KB, far below any video, while
Vercel Blob allows 8 MB. Without Blob, host the file anywhere and paste the URL.

### On a phone

Below 900px the two-column layouts become one and the menu goes behind a
hamburger. The breakpoints under that are named after what runs out of room
rather than after any device: 640px is where a show row stops trying to fit a
date, a venue and a ticket button on one line, and 400px is where a fact's label
and value stop sitting at opposite ends of their row.

- Photo panels are given a ratio — square for the hero, 4:5 for the about page,
  neither taller than 70% of the screen — instead of growing to the full height
  of whatever was uploaded.
- Hover styles sit behind `@media (hover: hover)` with `:active` equivalents. A
  touch screen has no way to leave a hover, so without the guard a tapped link
  card keeps its accent colour until you tap somewhere else.
- Nav rows, the logo, the footer email, the menu button and the ticket buttons
  are all at least 40px tall.
- A phone held sideways gets the two columns back while keeping the hamburger —
  844px of width is plenty for both, and stacking them there would leave the
  headline alone on screen.
- `viewport-fit=cover` and `env(safe-area-inset-*)` padding keep content clear
  of a notch in landscape, and `theme-color` matches the page background so the
  browser's chrome continues the header rather than banding it.

The admin panel is meant to be usable from a phone as well. Below 700px its
dense tables stack into one named field per line; reordering falls back from
drag to buttons, since touch screens never fire drag events; fields are 16px so
iOS does not zoom the page in on focus and leave it there; and the sidebar
becomes a drawer that dims the panel behind it and closes on an outside tap or
Escape.

### Security

- Password hashed with `scrypt`; only the hash is stored, and it is stripped
  from every API response, export and backup restore.
- Session cookie is `HttpOnly` + `SameSite=Lax`, and every mutating request also
  carries a per-session CSRF token.
- Eight failed sign-ins from one IP triggers a 15-minute lockout.
- All admin input is validated server-side: text is length-capped, colours must
  be hex, `javascript:` and other unsafe URL schemes are rejected, uploads must
  be images under 8 MB, and every value is HTML-escaped on output.
- `/admin` is excluded in `robots.txt`.

### Data

There are two storage backends and the right one is picked automatically. The
admin panel shows which is live under **Overview → Site status**, and so does
`/healthz`:

```json
{ "ok": true,
  "storage": "Redis + images in Redis",
  "credentials": { "redis": true, "blob": false, "github": false },
  "build": { "env": "production", "commit": "a9703b2", "branch": "main",
             "deployment": "…vercel.app" } }
```

`credentials` reports presence only — never a token, never a store URL. Since
environment variables are read at build time, `"blob": false` on a deployment
you have just redeployed means the variable did not reach that environment, and
an unchanged `commit` means the build itself did not change.

| | Site content & snapshots | Sessions | Images |
| --- | --- | --- | --- |
| **filesystem** (default) | `data/site.json`, `data/backups/` | `data/sessions.json` | `data/uploads/` |
| **github** | the repo, via the Contents API — commit history is the snapshot list | signed cookies | committed to `data/uploads/` |
| **serverless** | Redis | Redis, with expiry | Vercel Blob when configured, otherwise Redis; older Redis images stay readable either way |

The filesystem backend is used whenever no Redis credentials are present — local
development, a VPS, Fly.io, Railway, Render with a disk. Each save copies the
previous version into `data/backups/` (last 30 kept) and then writes atomically,
so a crash mid-save cannot corrupt the file. Point `TAYLOSITE_DATA_DIR` at a
mounted volume to keep the data outside the checkout.

To move a site between hosts, use **Backups & data → Download a copy** and
import the file on the other end.

## Deploying to Vercel

Vercel's filesystem is read-only and per-instance, so the site needs somewhere
to keep its content. There are two ways, and the first costs nothing.

### Option 1 — the repository itself (no extra service)

The admin panel commits changes straight back to this repo through the GitHub
API, and reads them back the same way. No database, no object store, no paid
tier. Content is version-controlled, every save is a commit you can read and
revert, and the snapshot list in the admin panel *is* the file's history.

1. Create a GitHub token: **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens**. Give it access to this repository only, with
   **Contents: Read and write**. (A classic token with `repo` scope works too.)
2. In Vercel → project → **Settings → Environment Variables**, add for
   **Production**:

   | Name | Value |
   | --- | --- |
   | `GITHUB_TOKEN` | the token you just created |
   | `GITHUB_REPO` | `owner/name` — optional on Vercel, which already exposes it |

3. **Redeploy.** Environment variables are read at build time, so the existing
   deployment will not pick them up on its own.

`/healthz` will then report `GitHub repository owner/name@main`.

Worth knowing about this backend:

- Content commits carry `[skip ci]`, so saving does **not** trigger a rebuild.
  The site reads content live through the API, so edits appear immediately.
- Reads are cached for 15 seconds per instance, so a page view is usually not
  an API call. An edit you just saved is visible at once regardless.
- Images are committed to `data/uploads/` and must stay under **900 KB**, the
  Contents API's inline limit. The admin panel resizes uploads to at most
  1800px and re-encodes them to WebP first, so ordinary photos land well under.
- Sessions are signed cookies rather than stored records, because a commit per
  sign-in would be absurd. Consequences: the signed-in devices list only shows
  the current one, and signing out of a single device just clears that cookie.
  **Sign out everywhere** and **changing the password** both invalidate every
  outstanding cookie immediately.
- Link click counts are per-instance and reset on cold starts — the alternative
  was a commit per click.

### Option 2 — Redis (and optionally Blob)

If you have an Upstash Redis database, use it instead: it holds sessions
properly, keeps click counts exactly, and has no size ceiling worth worrying
about. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the
`KV_REST_API_*` pair that Vercel's own integration sets) and redeploy. Redis
takes precedence over the GitHub backend when both are configured.

Adding **Blob** on top sets `BLOB_READ_WRITE_TOKEN`. New uploads then go to
Blob, are served from Vercel's CDN, and the size limit rises from 700 KB to
8 MB. Images uploaded before Blob was connected stay in Redis and keep working
— listings, pages and deletes fall back there — so adding Blob never orphans an
existing photo and nothing needs migrating.

Until one of these is configured, every page answers with a "Setup needed"
notice naming both options rather than a blank 500.

Two behaviours differ on Vercel, both by design:

- **Link click counts** are kept in their own Redis hash and merged in when the
  site is read, so a visitor clicking a link can never overwrite an edit that is
  being saved at the same moment.
- **Login rate limiting** is per-instance rather than global, because it is held
  in memory. Eight wrong guesses still lock that instance out for 15 minutes.

`vercel.json` routes every request to `api/index.js`, which passes it to the same
`server.js` used everywhere else — there is no separate serverless codebase.
