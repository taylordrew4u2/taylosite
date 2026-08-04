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
| **Themes** | The A / B / C switch: every colour of every theme, which one is the default, whether the switch shows at all |
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
| **serverless** (Vercel) | Redis | Redis, with expiry | Vercel Blob |

The filesystem backend is used whenever no Redis credentials are present — local
development, a VPS, Fly.io, Railway, Render with a disk. Each save copies the
previous version into `data/backups/` (last 30 kept) and then writes atomically,
so a crash mid-save cannot corrupt the file. Point `TAYLOSITE_DATA_DIR` at a
mounted volume to keep the data outside the checkout.

To move a site between hosts, use **Backups & data → Download a copy** and
import the file on the other end.

## Deploying to Vercel

Vercel's filesystem is read-only and per-instance, so the site needs two
integrations before the admin panel can save anything. Both have free tiers.

1. **Redis** — in the Vercel dashboard, open the project → **Storage** → add
   **Upstash for Redis**. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
   This holds the site content, snapshots and sign-in sessions.
2. **Blob** — same screen, add **Blob**. It sets `BLOB_READ_WRITE_TOKEN`, and
   uploaded photos are stored there and served from Vercel's CDN.
3. **Redeploy** so the new environment variables are picked up.

Until Redis is connected, every page answers with a "Setup needed" notice
explaining exactly what is missing rather than a blank 500. Blob is optional: if
only Redis is connected, the whole site works except image uploads, which say so.

Two behaviours differ on Vercel, both by design:

- **Link click counts** are kept in their own Redis hash and merged in when the
  site is read, so a visitor clicking a link can never overwrite an edit that is
  being saved at the same moment.
- **Login rate limiting** is per-instance rather than global, because it is held
  in memory. Eight wrong guesses still lock that instance out for 15 minutes.

`vercel.json` routes every request to `api/index.js`, which passes it to the same
`server.js` used everywhere else — there is no separate serverless codebase.
