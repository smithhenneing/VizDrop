# VizDrop — drop a spreadsheet, get a dashboard

A web app that turns raw business data (Excel, CSV, TSV, JSON) into a beautiful,
presentation-ready dashboard — entirely in the visitor's browser. **Free forever**
(every feature, no account, no limits), sustained by an optional donation link:
*"If VizDrop saved you time, you can help keep it free."*

Live at **https://vizdrop.netlify.app** (auto-deploys from `main`).

**The whole product lives in [`vizdrop/`](vizdrop/). That folder is the deployable
website.** No build step, no server, no database — hosting costs $0.

---

## Run it locally

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/server.ps1 -Port 8321
```

Then open http://localhost:8321 (landing page) / http://localhost:8321/app.html (the app).
Or just double-click `vizdrop/index.html` — everything except the "Try sample data"
button works from `file://` too.

## What's inside

| Path | What it is |
|---|---|
| `vizdrop/index.html` | Landing / sales page (hero, features, pricing, FAQ) |
| `vizdrop/app.html` | The app itself |
| `vizdrop/assets/js/parse.js` | File readers: xlsx/xls (SheetJS), csv/tsv (PapaParse), JSON. Header detection, banner-row skipping, empty-column cleanup |
| `vizdrop/assets/js/profile.js` | Column type detection — handles `Rp 1.234.567`, `$1,234.56`, `1.234,56`, `(500)`, `12%`, dd/mm/yyyy vs mm/dd/yyyy, Excel serial dates |
| `vizdrop/assets/js/auto.js` | Auto-dashboard heuristics (which KPIs, which charts) + aggregation |
| `vizdrop/assets/js/charts.js` | Hand-rolled SVG chart renderer (line, area, column, bar, donut, scatter, histogram) with tooltips, crosshairs, dark mode |
| `vizdrop/assets/js/export.js` | PNG export (per-chart + full dashboard) and PowerPoint export (Pro) |
| `vizdrop/assets/js/config.js` | **The one config value**: the donation link (`DONATE_URL`). Support buttons stay hidden until it's set. |
| `vizdrop/assets/js/app.js` | App shell: state, UI, edit menus, upgrade modal |
| `tools/server.ps1` | Local dev server (also has a dev-only `/__save` capture endpoint — never deployed) |

External libraries (SheetJS, PapaParse, pptxgenjs) are **vendored** in
`vizdrop/assets/vendor/` — the site is fully self-contained with no CDN
dependency. pptxgenjs is lazy-loaded on first PowerPoint export.

## Tests

A Playwright suite covers the landing page, dashboard generation, chart editing,
the messy-file parsing engine (Indonesian currency, dd/mm dates, EU decimals,
xlsx round-trips), licensing, and exports:

```bash
npm install
npx playwright install chromium
npm test
```

## Business model: free + donations

Everything is free and ungated. Exports carry a small "Made with VizDrop ·
vizdrop.netlify.app" credit line (`WATERMARK` in `export.js`) — it's marketing,
not a paywall, and every shared chart advertises the site. After an export the
app shows a gentle toast: *"If VizDrop saved you time, you can help keep it
free ♥"* linking to the donation page.

---

## Launch checklist

### 1. Set up the donation link

Any payment/donation page works — the app just opens a URL. Good options for an
Indonesian creator:

- **Lemon Squeezy** (works globally, merchant of record): create a product with
  the **"Pay what you want"** pricing type, e.g. suggested $5 / minimum $1, one-time.
  Copy its checkout link.
- **Ko-fi / Buy Me a Coffee**: simplest to set up, made for exactly this.
- **Saweria / Trakteer**: Indonesian platforms with QRIS/GoPay — best if most
  supporters are local.

Paste the link in **one place**: `vizdrop/assets/js/config.js` → `DONATE_URL`.
Until it's set, all Support buttons stay hidden automatically.

### 2. Deploy (pick one — all free)

The deployable site is the `vizdrop/` folder.

- **Netlify (current setup)**: the repo has a `netlify.toml` that publishes the
  `vizdrop/` folder — connect the GitHub repo to a Netlify site and every
  `git push` deploys automatically.
- **Cloudflare Pages / Vercel**: also work; set publish/root directory to `vizdrop`.
- **Your existing personal website**: upload the *contents* of `vizdrop/` to any
  subdirectory or subdomain via FTP/cPanel. It's plain static files.

After the first deploy:
- Update the `og:image` meta tag in `index.html` / `app.html` to the full URL
  (`https://YOUR-SITE.netlify.app/assets/og-image.png`) so WhatsApp/LinkedIn
  link previews work everywhere.
- Put the same site URL in your Lemon Squeezy store settings.

### 3. Optional polish before launch

- Rename the product: search-and-replace "VizDrop" across `vizdrop/` (it's a
  placeholder name — pick your own).
- Add your real contact email to the landing footer.
- Add an `og:image` meta tag (screenshot of the dashboard) for social sharing.
- Add a privacy page (easy to write honestly: "we never see your data").
- Analytics: a privacy-friendly one like Plausible/Umami if you want traffic data.

---

## Why this architecture (decisions log)

- **100% client-side**: your users' data never leaves their device — a genuine
  selling point for business users, and your hosting bill is $0 at any scale.
- **No build toolchain**: this machine has no Node.js/npm, and more importantly a
  zero-build static site is the easiest thing in the world to maintain and deploy.
  Editing a file *is* the deployment artifact.
- **Hand-rolled SVG charts** instead of a chart library: exact control over the
  design (thin marks, rounded data-ends, hairline grids, validated colorblind-safe
  palette in both light and dark mode) — output looks designed, not default.
- **Donations instead of subscriptions**: no accounts, no license servers, no
  billing support burden. One config value (`DONATE_URL`) to go live.

## Ideas for later

- PDF export (jsPDF), CSV re-export of aggregated tables
- Shareable read-only links (would need a tiny backend or URL-encoded state)
- More chart types: stacked bars for two categories, small multiples
- Indonesian UI translation (the number/date parsing already handles Indonesian formats)
- Saved dashboards (localStorage first, cloud later)
