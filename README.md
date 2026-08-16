# r1apps

Monorepo of apps ("creations") for the [Rabbit R1](https://www.rabbit.tech/) — static
web apps installed by scanning a QR, deployed to GitHub Pages.

## Apps

| App | What it is | Install |
| --- | --- | --- |
| **quickreader** | RSVP speed reader for EPUB ebooks — words flash one at a time | [`/quickreader/install.html`](https://remyfevry.github.io/r1apps/quickreader/install.html) |
| `_template` | Starter for new apps | — |

## Installing on an R1

Open the install page on any phone/computer, then open the R1 camera and scan
the QR. Two build channels:

| Channel | URL | Version | Old versions kept? |
| --- | --- | --- | --- |
| **Main site** (public, no books) | `https://remyfevry.github.io/r1apps/quickreader/install.html` | always latest `main` (`?v=<commit SHA>` cache-bust) | no |
| **Shelf** (personal, books bundled) | `https://remyfevry.github.io/r1-shelf/v/<version>/install.html` | semver, e.g. `v/0.6.6/` | **yes** — every synced version is immutable and permanent |

To install a **specific version**: pick it from the
[Releases of RemyFevry/r1-shelf](https://github.com/RemyFevry/r1-shelf/releases)
(each `v<version>` release carries the exact site zip), open its
`v/<version>/install.html` page, scan. The R1 card is named "QuickReader
`<version>`" so you can see what's installed. Per-app details:
[quickreader](apps/quickreader/README.md).

## R1 compatibility gate

Everything pushed passes `.github/workflows/ci.yml` before it can deploy —
nothing reaches an R1 without it:

1. **Build locked to the device floor** — vite targets `chrome103` from
   `r1.config.mjs` (Android 13-era webview; bump one constant if a device
   report proves higher).
2. **`pnpm r1:compat`** — static scan of every built app for post-floor JS
   built-ins and CSS, viewport contract, external resources, bundle budget.
3. **`pnpm r1:smoke`** — device-sim: Chromium at 240×282, `creationStorage`/
   `closeWebView` mocked, post-floor built-ins deleted, driven through R1
   hardware events; zero console errors, no overflow.
4. **Branch protection** — `verify` required on `main`, enforced for admins
   too; deploy publishes exactly the verified artifact.

Run it all locally with `pnpm verify`. Full decision record:
[ADR-0013](docs/adr/0013-r1-compatibility-gate-ci.md).

## Develop

Requires Node 20+ and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm verify          # typecheck + test + build + R1 gate (what CI runs)
```

Run one app locally (with desktop keyboard fallbacks for the R1's inputs):

```sh
pnpm --filter quickreader dev
```

## Structure

- `apps/<name>/` — one Vite TS site per app (`index.html` on-device, `install.html` QR companion; each has its own README)
- `packages/r1-kit/` — shared kit: R1 input events, storage seam, zip reader, QR helper, theme ([README](packages/r1-kit/README.md))
- `r1.config.mjs` — the R1 device profile; single source of truth for the gate
- `docs/adr/` — the design record (the spec); `docs/glossary.md` — vocabulary
- `.github/workflows/ci.yml` — the gate + deploy on push to `main`

New app: copy `apps/_template/` (see [its README](apps/_template/README.md)),
rename, done — the workflow picks it up.

Books for quickreader are never committed here; each book is added on-device by URL
(see `docs/adr/0001-ingestion-qr-deeplink-with-typed-fallback.md`).

### Managing your shelf (bundled books)

The personal shelf build carries your books inside the app itself — the durable
copy lives in the bundle, not device storage.

- `pnpm bookshelf add <book.epub> [--title "…"] [--author "…"]` — appends a record
  to `apps/quickreader/books/` (gitignored; this folder **is** your library
  manifest — don't delete it unless you mean to drop books).
- `pnpm bookshelf sync` — bundles **every** book in that folder into a fresh
  build, deploys `RemyFevry/r1-shelf`, publishes the `v<ver>` GitHub Release
  (site zip attached — the artifact record), prints the QR page. Versions are
  semver from `apps/quickreader/package.json` — `pnpm bookshelf bump
  <major|minor|patch>` before each sync (a shipped version is immutable; sync
  refuses to overwrite). Every sync lives at a permanent `v/<ver>/` URL and the
  R1 creation is named **QuickReader \<ver\>**, so the card itself shows what
  it's running; old QR links keep serving the exact build they were minted
  for. The unversioned root always serves the latest build. Rescan to pick a
  new version up; the library then shows old + new books together.
  Nothing is ever dropped by adding books.
- `pnpm bookshelf list` / `pnpm bookshelf remove <slug>` — review or permanently
  remove; removal takes effect at the next `sync`.
- Deleting a book on-device is a temporary hide — the next sync restores all
  bundled books. Permanent removal is `remove` + `sync`.
- One record per filename: adding a different book under an existing filename
  overwrites that record. Keep filenames distinct.
- Books added by URL (Add-book screen / deep-link QR) live in device storage,
  which may not persist across closes on current R1 firmware — treat the shelf
  as the reliable lane until the on-device checklist
  ([#9](https://github.com/RemyFevry/r1apps/issues/9)) says otherwise.

Inspired by [andr3w-hilton/rabbit-r1-creations-public](https://github.com/andr3w-hilton/rabbit-r1-creations-public).

## License

MIT — see [LICENSE](./LICENSE).
