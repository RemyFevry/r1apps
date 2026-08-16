#!/usr/bin/env node
// bookshelf — personal builds with books bundled in, per app.
//
//   pnpm bookshelf [--app quickreader|steadyreader] <command>
//
//     add <book.epub> [--title "T"] [--author "A"]
//                                      extract locally into the app's bundle dir
//     list                             show bundled documents
//     remove <slug>                   remove one
//     bump <major|minor|patch>        increment the app's package.json version
//     sync                            build + deploy the app's shelf repo,
//                                      print the install QR page URL
//
// quickreader (default) bundles into apps/quickreader/books/ and deploys to
// RemyFevry/r1-shelf; steadyreader bundles into apps/steadyreader/docs/ and
// deploys to RemyFevry/steady-shelf.
//
// Why: on-device ingestion needs a public CORS host and a deep-link scan, and
// the R1 mangles long URLs. Bundled builds put the pre-extracted documents
// inside the app itself — no fetch, no CORS, no URL limits, no on-device
// parsing. Each sync lands at an immutable v/<ver>/ path (kept forever) and
// refreshes the root to the latest build. Hosted under RemyFevry (the
// remy-agent account's Pages serving was blocked account-wide on 2026-08-16 —
// deployments succeeded but every URL returned "Site not found"). See
// docs/adr/0001 (amendments).

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Window } from 'happy-dom'
import {
  QUICKREADER_STAGE,
  bumpVersion,
  extractDocFile,
  extractEpubFile,
  lenientDomParser,
  parseSemver,
  shippedVersion,
  slugify,
  smallHash,
  stageShelfSite,
} from './shelf.ts'
import { APP_BASE as STEADY_BASE } from '../apps/steadyreader/app.config'

const ROOT = resolve(import.meta.dirname, '..')
const SHELF_REPO_OWNER = 'RemyFevry'

const APPS = {
  quickreader: {
    name: 'QuickReader',
    pkg: join(ROOT, 'apps/quickreader/package.json'),
    bundleDir: join(ROOT, 'apps/quickreader/books'),
    shelfRepo: `${SHELF_REPO_OWNER}/r1-shelf`,
    shelfUrl: `https://${SHELF_REPO_OWNER.toLowerCase()}.github.io/r1-shelf/`,
    stage: QUICKREADER_STAGE,
    extract: extractEpubFile,
    record: (book, { title, author, id }) => ({
      id,
      title,
      author,
      chapters: book.chapters,
      wordCount: book.wordCount,
      addedAt: Date.now(),
      sourceUrl: 'bundled',
    }),
  },
  steadyreader: {
    name: 'SteadyReader',
    pkg: join(ROOT, 'apps/steadyreader/package.json'),
    bundleDir: join(ROOT, 'apps/steadyreader/docs'),
    shelfRepo: `${SHELF_REPO_OWNER}/steady-shelf`,
    shelfUrl: `https://${SHELF_REPO_OWNER.toLowerCase()}.github.io/steady-shelf/`,
    stage: {
      appBase: STEADY_BASE,
      appTitle: 'SteadyReader',
      companion: 'shelf-install.html',
      dropFiles: ['install.html'],
    },
    extract: extractDocFile,
    record: (doc, { title, author, id }) => ({
      id,
      title,
      author,
      chapters: doc.chapters,
      wordCount: doc.wordCount,
      addedAt: Date.now(),
      sourceUrl: 'bundled',
      kind: 'epub',
    }),
  },
}

function parseArgs(argv) {
  const rest = []
  let app = 'quickreader'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app') {
      app = argv[++i]
      if (!APPS[app]) die(`unknown --app "${app}" (quickreader | steadyreader)`)
    } else {
      rest.push(argv[i])
    }
  }
  return { app, rest }
}

const { app: APP, rest: ARGV } = parseArgs(process.argv.slice(2))
const CFG = APPS[APP]
const BOOKS_DIR = CFG.bundleDir
const APP_PKG = CFG.pkg
const SHELF_REPO = CFG.shelfRepo
const SHELF_URL = CFG.shelfUrl

function die(msg) {
  console.error(msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

function appVersion() {
  const v = JSON.parse(readFileSync(APP_PKG, 'utf8')).version
  try {
    parseSemver(v)
  } catch {
    die(`apps/${APP}/package.json version is not semver: ${v}`)
  }
  return v
}

function extract(file) {
  const win = new Window()
  return CFG.extract(file, lenientDomParser(win))
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
  const [cmd, ...args] = ARGV

  if (cmd === 'add') {
    const flags = {}
    const positional = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--title' || args[i] === '--author') flags[args[i].slice(2)] = args[++i]
      else positional.push(args[i])
    }
    const file = positional[0]
    if (!file) die(`usage: pnpm bookshelf --app ${APP} add <book.epub> [--title "Title"] [--author "Name"]`)
    if (!/\.epub$/i.test(file)) die('not a .epub file')
    console.log(`extracting ${basename(file)} …`)
    const extracted = await extract(file)
    const slug = slugify(basename(file)) || 'book'
    const title =
      flags.title || (extracted.title !== 'Untitled' ? extracted.title : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    const author = flags.author ?? extracted.author
    const id = `shelf-${smallHash(`${title}|${author}|${extracted.wordCount}`)}`
    const record = CFG.record(extracted, { title, author, id })
    mkdirSync(BOOKS_DIR, { recursive: true })
    writeFileSync(join(BOOKS_DIR, `${slug}.json`), JSON.stringify(record))
    console.log(`added: "${title}"${author ? ' — ' + author : ''} (${extracted.wordCount} words, ${extracted.chapters.length} chapters)`)
    console.log(`run \`pnpm bookshelf --app ${APP} sync\` to deploy the shelf, then rescan its QR.`)
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
    if (!['major', 'minor', 'patch'].includes(part)) die(`usage: pnpm bookshelf --app ${APP} bump <major|minor|patch>`)
    let from, to
    try {
      ;({ from, to } = bumpVersion(APP_PKG, part))
    } catch (e) {
      die(`apps/${APP}/package.json ${e?.message ?? String(e)}`)
    }
    console.log(`bumped ${part}: v${from} → v${to} (apps/${APP}/package.json — commit it with your change)`)
    return
  }

  if (cmd === 'sync') {
    if (!bundledFiles().length) die(`no documents bundled — add one first: pnpm bookshelf --app ${APP} add <book.epub>`)
    const ver = appVersion()
    console.log(`building ${APP} with bundled documents …`)
    run('pnpm', ['--filter', APP, 'build'], { cwd: ROOT, env: { ...process.env, BUILD_ID: ver } })

    const dist = join(ROOT, 'apps', APP, 'dist')
    const site = mkdtempSync(join(tmpdir(), 'r1-shelf-site-'))
    const stage = mkdtempSync(join(tmpdir(), 'r1-shelf-stage-'))
    let created = false
    try {
      // Site: only the app + shelf companion page, rebased onto the shelf path.
      stageShelfSite(dist, site, ver, CFG.stage)

      let exists = true
      try {
        run('gh', ['api', `repos/${SHELF_REPO}`, '--jq', '.full_name'])
      } catch {
        exists = false
      }
      if (!exists) {
        console.log(`creating ${SHELF_REPO} …`)
        run('gh', ['repo', 'create', SHELF_REPO, '--public', '--description', `${CFG.name} shelf (personal build)`])
        created = true
      }
      run('git', ['init', '-b', 'main'], { cwd: stage })
      run('git', ['remote', 'add', 'origin', `https://github.com/${SHELF_REPO}.git`], { cwd: stage })
      if (!created) {
        // Prior version artifacts carry forward: every v/<ver>/ ever synced stays served.
        run('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: stage })
        if (shippedVersion(stage, ver)) {
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
      console.log(`  - the R1 creation is named "${CFG.name} ${ver}" — the version is visible on the card`)
      console.log(`  - versions are semver from apps/${APP}/package.json; bump before each sync (a shipped v/<ver>/ is immutable):`)
      console.log(`    pnpm bookshelf --app ${APP} bump <major|minor|patch> — then commit the package.json change and sync`)
      console.log(`  - the unversioned root (${SHELF_URL}) always serves the latest build (browsers)`)
      console.log('  - the shelf repo is public (unguessable exposure model, same as r1book transit)')
    } finally {
      rmSync(site, { recursive: true, force: true })
      rmSync(stage, { recursive: true, force: true })
    }
    return
  }

  die('usage: pnpm bookshelf [--app quickreader|steadyreader] <add|list|remove|bump|sync>')
}

main().catch((e) => die(e?.message ?? String(e)))
