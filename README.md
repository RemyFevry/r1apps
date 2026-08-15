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

Inspired by [andr3w-hilton/rabbit-r1-creations-public](https://github.com/andr3w-hilton/rabbit-r1-creations-public).

## License

MIT — see [LICENSE](./LICENSE).
