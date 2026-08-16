# r1apps

Monorepo of apps ("creations") for the [Rabbit R1](https://www.rabbit.tech/) — static
web apps installed by scanning a QR, deployed to GitHub Pages.

## Apps

| App | What it is | Install |
| --- | --- | --- |
| **quickreader** | RSVP speed reader for EPUB ebooks — words flash one at a time | [`/quickreader/install.html`](https://remyfevry.github.io/r1apps/quickreader/install.html) |
| `_template` | Starter for new apps | — |

## Develop

Requires Node 20+ and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Run one app locally (with desktop keyboard fallbacks for the R1's inputs):

```sh
pnpm --filter quickreader dev
```

## Structure

- `apps/<name>/` — one Vite TS site per app (`index.html` on-device, `install.html` QR companion)
- `packages/r1-kit/` — shared kit: R1 input events, storage seam, zip reader, QR helper, theme
- `docs/adr/` — the design record (the spec); `docs/glossary.md` — vocabulary
- `.github/workflows/deploy.yml` — builds every app and publishes the site on push to `main`

New app: copy `apps/_template/`, rename, done — the workflow picks it up.

Books for quickreader are never committed here; each book is added on-device by URL
(see `docs/adr/0001-ingestion-qr-deeplink-with-typed-fallback.md`).

### Managing your shelf (bundled books)

The personal shelf build carries your books inside the app itself — the durable
copy lives in the bundle, not device storage.

- `pnpm bookshelf add <book.epub> [--title "…"] [--author "…"]` — appends a record
  to `apps/quickreader/books/` (gitignored; this folder **is** your library
  manifest — don't delete it unless you mean to drop books).
- `pnpm bookshelf sync` — bundles **every** book in that folder into a fresh
  build, deploys `remyf-agent/r1-shelf`, prints the QR page. Every sync lives
  at a permanent `v/<ver>/` URL — old QR links keep serving the exact build
  they were minted for, so a card (or a bug report quoting `v=`) is always
  re-fetchable; the unversioned root always serves the latest build. Rescan to
  pick a new version up; the library then shows old + new books together.
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
