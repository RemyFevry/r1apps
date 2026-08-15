#!/usr/bin/env node
// host-book — push a local EPUB to an unguessable GitHub repo and hand back a
// CORS-clean raw URL the R1 can fetch. See docs/adr/0001 (amendment).
//
//   node scripts/host-book.mjs <book.epub>     host a book
//   node scripts/host-book.mjs --clean         delete all r1book-* transit repos
//
// Why GitHub raw: filebin/litterbox/uguu/x0/0x0 etc. either serve HTML to
// browser user agents (the R1 webview), block uploads, or drop CORS headers.
// raw.githubusercontent.com serves raw bytes with access-control-allow-origin:
// * to any UA (verified with a browser UA + 30 MB round-trip).

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename } from 'node:path'

const MAX_BYTES = 150 * 1024 * 1024
const INSTALL_PAGE = 'https://remyfevry.github.io/r1apps/quickreader/install.html'

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }).trim()
}

function die(msg) {
  console.error(msg)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)

  if (args[0] === '--clean') {
    const repos = gh('repo', 'list', '--json', 'name', '--limit', '200')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l).name]
        } catch {
          return []
        }
      })
      .filter((n) => n.startsWith('r1book-'))
    if (!repos.length) die('no r1book-* transit repos found')
    for (const repo of repos) {
      try {
        gh('repo', 'delete', repo, '--yes')
        console.log(`deleted ${repo}`)
      } catch {
        die(
          `could not delete ${repo}: run once:\n` +
            '  gh auth refresh -h github.com -s delete_repo\n' +
            'then retry --clean',
        )
      }
    }
    return
  }

  const file = args[0]
  if (!file) die('usage: node scripts/host-book.mjs <book.epub> | --clean')
  if (!/\.epub$/i.test(file)) die('not a .epub file')
  const size = statSync(file).size
  if (size > MAX_BYTES) die(`book too large (${Math.round(size / 1024 / 1024)} MB > 150 MB)`)

  const account = gh('api', 'user', '--jq', '.login')
  const repo = `r1book-${randomBytes(5).toString('hex')}`
  const name = basename(file).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')

  console.log(`hosting ${name} (${(size / 1024 / 1024).toFixed(1)} MB) as ${account}/${repo} …`)
  gh('repo', 'create', `${account}/${repo}`, '--public', '--description', 'QuickReader book transit — safe to delete')

  const body = `/tmp/host-book-${Date.now()}.json`
  writeFileSync(body, JSON.stringify({ message: 'book', content: readFileSync(file).toString('base64') }))
  try {
    gh('api', '--method', 'PUT', `repos/${account}/${repo}/contents/${encodeURIComponent(name)}`, '--input', body)
  } finally {
    unlinkSync(body)
  }

  const rawUrl = `https://raw.githubusercontent.com/${account}/${repo}/main/${encodeURIComponent(name)}`
  const code = Buffer.from(`${account}|${repo}|${name}`).toString('base64url')
  const deepLink = `${INSTALL_PAGE}?b=${code}`
  console.log('\nbook URL (paste anywhere, incl. the app\'s Add-book screen):')
  console.log(`  ${rawUrl}`)
  console.log('\nQR page (open on your phone/computer, scan with the R1):')
  console.log(`  ${deepLink}`)
  console.log('\nwhen done: node scripts/host-book.mjs --clean')
}

main().catch((e) => die(e?.message ?? String(e)))
