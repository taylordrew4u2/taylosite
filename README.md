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

- Public site: `/`, `/about`, `/links`
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
| **Brand & SEO** | Name, logo text, location, booking email, page title, description, social share image, favicon |
| **Home page** | Kicker, big headline, subhead, hero photo + alt text, both buttons (label / link / visibility), the "Upcoming" block |
| **Links** | Add, edit, delete, reorder (drag or arrows), hide, feature; label, sub-label, URL; click counts per link |
| **Shows** | Date, time, venue, city, ticket link, button label, note, sold-out and hidden flags |
| **About page** | Kicker, title, photo, unlimited bio paragraphs, label/value facts, press quotes |
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

Every page carries canonical, Open Graph and Twitter card tags built from the
admin content, plus `schema.org` structured data — a `Person` for Taylor and an
`Event` for each upcoming show, so dates can surface directly in search results.
`/sitemap.xml` and `/robots.txt` are generated from the live content.

There is a skip link, `aria-current` on the active nav item, real `<time>`
elements on show dates, visible focus rings, a keyboard-closable mobile menu,
and a `prefers-reduced-motion` opt-out.

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
`/healthz`.

| | Site content & snapshots | Sessions | Images |
| --- | --- | --- | --- |
| **filesystem** (default) | `data/site.json`, `data/backups/` | `data/sessions.json` | `data/uploads/` |
| **github** | the repo, via the Contents API — commit history is the snapshot list | signed cookies | committed to `data/uploads/` |
| **serverless** | Redis | Redis, with expiry | Vercel Blob, or Redis when no Blob token is set |

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

Adding **Blob** on top sets `BLOB_READ_WRITE_TOKEN` and moves images there,
served from Vercel's CDN with the limit raised to 8 MB.

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
