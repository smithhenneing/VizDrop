# VizDrop — drop a spreadsheet, get a dashboard

A micro-SaaS that turns raw business data (Excel, CSV, TSV, JSON) into a beautiful,
presentation-ready dashboard — entirely in the visitor's browser. Free tier +
Pro tier at **$5/month** via Lemon Squeezy license keys.

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
| `vizdrop/assets/js/license.js` | Free/Pro gating + Lemon Squeezy license validation. **Config lives here.** |
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

## Free vs Pro

| | Free | Pro ($5/mo) |
|---|---|---|
| All chart types, editing, dark mode | ✓ | ✓ |
| Rows per file | first 5,000 | unlimited |
| PNG exports | ✓ (small watermark) | no watermark, 3× resolution |
| PowerPoint (.pptx) export | — | ✓ |

Limits are set in `license.js` (`FREE_ROW_LIMIT`) and the watermark text in `export.js`.

---

## Launch checklist

### 1. Set up payments (Lemon Squeezy — works for Indonesian sellers)

Lemon Squeezy is a *merchant of record*: they handle global payments, VAT/tax,
and payouts to you. Stripe doesn't directly support Indonesian accounts; this is
the standard route.

1. Create an account at lemonsqueezy.com and create a store.
2. Create a **Subscription** product: $5/month. In the product's settings enable
   **License keys**.
3. Copy the product's **checkout link** (looks like
   `https://YOURSTORE.lemonsqueezy.com/buy/xxxxxxxx-xxxx-...`).
4. Paste it in **one place**: `vizdrop/assets/js/license.js` → `CHECKOUT_URL`.
5. Done. When a customer pays, Lemon Squeezy emails them a license key; they paste
   it into the app's Upgrade dialog, and the app validates it against Lemon
   Squeezy's public license API (no server of yours involved).

Testing without paying: any key starting with `VIZDROP-DEV-` activates Pro locally.
Remove that prefix check in `license.js` before launch if you don't want it.

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
- **Lemon Squeezy license keys** instead of accounts/auth: no backend, no user
  database, no password resets. One config value to go live.

## Ideas for later

- PDF export (jsPDF), CSV re-export of aggregated tables
- Shareable read-only links (would need a tiny backend or URL-encoded state)
- More chart types: stacked bars for two categories, small multiples
- Indonesian UI translation (the number/date parsing already handles Indonesian formats)
- Saved dashboards (localStorage first, cloud later)
