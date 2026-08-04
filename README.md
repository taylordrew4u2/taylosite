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
lib/defaults.js      the starting content for a fresh install
lib/schema.js        validates + sanitises everything the admin panel sends
lib/store.js         atomic JSON storage, automatic snapshots
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

Everything lives in `data/site.json`. Each save first copies the previous
version into `data/backups/` (last 30 kept) and then writes atomically, so a
crash mid-save cannot corrupt the file.

Because content and uploads are files on disk, deploy to a host with a
persistent filesystem (a VPS, Fly.io, Railway, Render with a disk) rather than a
read-only serverless platform. To move a site, copy the `data/` directory — or
use **Backups & data → Download a copy** and import it on the other end.
