#!/usr/bin/env node
// bookshelf — personal QuickReader builds with books bundled in.
//
//   pnpm bookshelf add <book.epub>     extract locally, add to apps/quickreader/books/
//   pnpm bookshelf list                show bundled books
//   pnpm bookshelf remove <slug>       remove one
//   pnpm bookshelf bump <major|minor|patch>
//                                      increment apps/quickreader/package.json version
//   pnpm bookshelf sync                build + deploy the shelf (RemyFevry/r1-shelf),
//                                      print the install QR page URL
//
// Why: on-device ingestion needs a public CORS host and a deep-link scan, and
// the R1 mangles long URLs. Bundled builds put the pre-extracted word streams
// inside the app itself — no fetch, no CORS, no URL limits, no on-device
// parsing. Each sync lands at an immutable v/<ver>/ path (kept forever) and
// refreshes the root to the latest build. Hosted under RemyFevry (the
// remy-agent account's Pages serving was blocked account-wide on 2026-08-16 —
// deployments succeeded but every URL returned "Site not found"). See
// docs/adr/0001 (amendments).

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Window } from 'happy-dom'

const ROOT = resolve(import.meta.dirname, '..')
const BOOKS_DIR = join(ROOT, 'apps/quickreader/books')
const APP = 'quickreader'
const APP_PKG = join(ROOT, 'apps', APP, 'package.json')
const SHELF_REPO_OWNER = 'RemyFevry'
const SHELF_REPO = `${SHELF_REPO_OWNER}/r1-shelf`
const SHELF_URL = `https://${SHELF_REPO_OWNER.toLowerCase()}.github.io/r1-shelf/`
const SHELF_BASE = '/r1-shelf/'

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

function slugify(name) {
  return name
    .replace(/\.epub$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function smallHash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function appVersion() {
  const v = JSON.parse(readFileSync(APP_PKG, 'utf8')).version
  if (!/^\d+\.\d+\.\d+$/.test(v)) die(`apps/quickreader/package.json version is not semver: ${v}`)
  return v
}

async function extract(file) {
  const win = new Window()
  globalThis.DOMParser = win.DOMParser
  const { extractEpub } = await import('../apps/quickreader/src/ingestion/epub.ts')
  return extractEpub(new Uint8Array(readFileSync(file)))
}

const SHELF_WORKFLOW = `name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
`

function bundledFiles() {
  return existsSync(BOOKS_DIR) ? readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json')).sort() : []
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)

  if (cmd === 'add') {
    const flags = {}
    const positional = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--title' || args[i] === '--author') flags[args[i].slice(2)] = args[++i]
      else positional.push(args[i])
    }
    const file = positional[0]
    if (!file) die('usage: pnpm bookshelf add <book.epub> [--title "Title"] [--author "Name"]')
    if (!/\.epub$/i.test(file)) die('not a .epub file')
    console.log(`extracting ${basename(file)} …`)
    const book = await extract(file)
    const slug = slugify(basename(file)) || 'book'
    const title = flags.title || (book.title !== 'Untitled' ? book.title : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    const author = flags.author ?? book.author
    const id = `shelf-${smallHash(`${title}|${author}|${book.wordCount}`)}`
    const record = {
      id,
      title,
      author,
      chapters: book.chapters,
      wordCount: book.wordCount,
      addedAt: Date.now(),
      sourceUrl: 'bundled',
    }
    mkdirSync(BOOKS_DIR, { recursive: true })
    writeFileSync(join(BOOKS_DIR, `${slug}.json`), JSON.stringify(record))
    console.log(`added: "${title}"${author ? ' — ' + author : ''} (${book.wordCount} words, ${book.chapters.length} chapters)`)
    console.log('run `pnpm bookshelf sync` to deploy the shelf, then rescan its QR.')
    return
  }

  if (cmd === 'list') {
    const files = bundledFiles()
    if (!files.length) die('no books bundled')
    for (const f of files) {
      const b = JSON.parse(readFileSync(join(BOOKS_DIR, f), 'utf8'))
      console.log(`${f.replace(/\.json$/, '')}  "${b.title}" — ${b.author || 'unknown'} · ${b.wordCount} words · id ${b.id}`)
    }
    return
  }

  if (cmd === 'remove') {
    const slug = args[0]
    if (!slug) die('usage: pnpm bookshelf remove <slug>')
    const target = join(BOOKS_DIR, `${slug}.json`)
    if (!existsSync(target)) die(`no such book: ${slug} (see pnpm bookshelf list)`)
    rmSync(target)
    console.log(`removed ${slug}`)
    return
  }

  if (cmd === 'bump') {
    const part = args[0]
    if (!['major', 'minor', 'patch'].includes(part)) die('usage: pnpm bookshelf bump <major|minor|patch>')
    const [major, minor, patch] = appVersion().split('.').map(Number)
    const next = part === 'major' ? `${major + 1}.0.0` : part === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
    const pkg = JSON.parse(readFileSync(APP_PKG, 'utf8'))
    pkg.version = next
    writeFileSync(APP_PKG, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`bumped ${part}: v${[major, minor, patch].join('.')} → v${next} (apps/quickreader/package.json — commit it with your change)`)
    return
  }

  if (cmd === 'sync') {
    if (!bundledFiles().length) die('no books bundled — add one first: pnpm bookshelf add <book.epub>')
    const ver = appVersion()
    console.log('building quickreader with bundled books …')
    run('pnpm', ['--filter', APP, 'build'], { cwd: ROOT, env: { ...process.env, BUILD_ID: ver } })

    const dist = join(ROOT, 'apps', APP, 'dist')
    const site = mkdtempSync(join(tmpdir(), 'r1-shelf-site-'))
    const stage = mkdtempSync(join(tmpdir(), 'r1-shelf-stage-'))
    let created = false
    try {
      // Site: only the app + shelf companion page, rebased onto the shelf path.
      cpSync(dist + '/', site + '/', { recursive: true })
      rmSync(join(site, 'install.html'))
      rmSync(join(site, 'index.html'))
      const appHtml = readFileSync(join(dist, 'index.html'), 'utf8')
      const shelfHtml = appHtml
        .replaceAll('/r1apps/quickreader/', SHELF_BASE)
        .replace('<title>QuickReader</title>', `<title>QuickReader shelf v${ver}</title>`)
      writeFileSync(join(site, 'app.html'), shelfHtml)
      const companion = readFileSync(join(site, 'shelf-install.html'), 'utf8').replaceAll(
        '/r1apps/quickreader/',
        SHELF_BASE,
      )
      writeFileSync(join(site, 'install.html'), companion)
      rmSync(join(site, 'shelf-install.html'))

      let exists = true
      try {
        run('gh', ['api', `repos/${SHELF_REPO}`, '--jq', '.full_name'])
      } catch {
        exists = false
      }
      if (!exists) {
        console.log(`creating ${SHELF_REPO} …`)
        run('gh', ['repo', 'create', SHELF_REPO, '--public', '--description', 'QuickReader shelf (personal build)'])
        created = true
      }
      run('git', ['init', '-b', 'main'], { cwd: stage })
      run('git', ['remote', 'add', 'origin', `https://github.com/${SHELF_REPO}.git`], { cwd: stage })
      if (!created) {
        // Prior version artifacts carry forward: every v/<ver>/ ever synced stays served.
        run('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: stage })
        if (existsSync(join(stage, 'v', ver))) {
          die(`v/${ver}/ is already shipped and immutable — bump first: pnpm bookshelf bump <major|minor|patch>`)
        }
        if (!existsSync(join(stage, 'v'))) {
          // One-time migration: the pre-versioning root build becomes v/<its ver>/.
          const priorMsg = run('git', ['log', '-1', '--format=%s'], { cwd: stage })
          const priorVer = /v=([A-Za-z0-9]+)/.exec(priorMsg)?.[1] ?? 'pre-versioning'
          mkdirSync(join(stage, 'v', priorVer), { recursive: true })
          for (const e of readdirSync(stage)) {
            if (e === 'v' || e === '.git' || e === '.github') continue
            renameSync(join(stage, e), join(stage, 'v', priorVer, e))
          }
          console.log(`migrated existing root build to v/${priorVer}/ (now immutable)`)
        }
      }

      // New version dir is the permanent artifact; root is refreshed to it (latest).
      mkdirSync(join(stage, 'v'), { recursive: true })
      cpSync(site + '/', join(stage, 'v', ver) + '/', { recursive: true })
      for (const e of readdirSync(stage)) {
        if (e === 'v' || e === '.git') continue
        rmSync(join(stage, e), { recursive: true, force: true })
      }
      cpSync(site + '/', stage + '/', { recursive: true })
      mkdirSync(join(stage, '.github/workflows'), { recursive: true })
      writeFileSync(join(stage, '.github/workflows/deploy.yml'), SHELF_WORKFLOW)

      run('git', ['add', '-A'], { cwd: stage })
      run('git', ['commit', '-m', `shelf sync v=${ver}: ${bundledFiles().length} book(s), versioned at v/${ver}/`], { cwd: stage })
      run('git', ['push', '-u', 'origin', 'main'], { cwd: stage })

      let pagesMissing = true
      try {
        run('gh', ['api', `repos/${SHELF_REPO}/pages`, '--jq', '.html_url'])
        pagesMissing = false
      } catch {}

      if (pagesMissing) {
        console.log('enabling Pages (workflow mode) on the shelf repo …')
        try {
          run('gh', ['api', '--method', 'POST', `repos/${SHELF_REPO}/pages`, '-F', 'build_type=workflow'])
        } catch {
          console.error('could not enable Pages via API — open https://github.com/' + SHELF_REPO + '/settings/pages and set Source: GitHub Actions')
        }
        try {
          run('gh', ['workflow', 'run', 'deploy', '-R', SHELF_REPO])
          console.log('deployment workflow dispatched')
        } catch {}
      }

      console.log(`\nshelf deployed (v=${ver})`)
      console.log('install QR page — permanent URL for this build (open on phone/computer, scan with the R1):')
      console.log(`  ${SHELF_URL}v/${ver}/install.html`)
      console.log('\nnotes:')
      console.log(`  - the R1 creation is named "QuickReader ${ver}" — the version is visible on the card`)
      console.log('  - versions are semver from apps/quickreader/package.json; bump before each sync (a shipped v/<ver>/ is immutable):')
      console.log('    pnpm bookshelf bump <major|minor|patch> — then commit the package.json change and sync')
      console.log(`  - the unversioned root (${SHELF_URL}) always serves the latest build (browsers)`)
      console.log('  - the shelf repo is public (unguessable exposure model, same as r1book transit)')
    } finally {
      rmSync(site, { recursive: true, force: true })
      rmSync(stage, { recursive: true, force: true })
    }
    return
  }

  die('usage: pnpm bookshelf <add|list|remove|bump|sync>')
}

main().catch((e) => die(e?.message ?? String(e)))
