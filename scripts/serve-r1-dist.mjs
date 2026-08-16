/**
 * Serves every built app (apps/<name>/dist) at its deployed base path (/r1apps/<app>/) so the
 * smoke suite loads apps exactly as GitHub Pages will. Zero dependencies.
 *
 * Run: node scripts/serve-r1-dist.mjs [port]   (GET /healthz for readiness)
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..')
const port = Number(process.argv[2] ?? 4173)

const apps = readdirSync(join(root, 'apps')).filter((name) => {
  try {
    return statSync(join(root, 'apps', name, 'dist')).isDirectory()
  } catch {
    return false
  }
})

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/healthz') {
    res.writeHead(200).end('ok')
    return
  }

  // Browsers auto-request this; answer it so smoke console logs stay clean.
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end()
    return
  }

  const m = url.pathname.match(/^\/r1apps\/([^/]+)(\/.*)?$/)
  const app = m?.[1]
  if (!app || !apps.includes(app)) {
    res.writeHead(404).end(`unknown app: ${url.pathname} (serving: ${apps.join(', ')})`)
    return
  }

  const rel = decodeURIComponent(m[2] ?? '/')
  const file = normalize(join(root, 'apps', app, 'dist', rel === '/' ? 'index.html' : rel))
  if (!file.startsWith(join(root, 'apps', app, 'dist'))) {
    res.writeHead(403).end()
    return
  }

  const target = existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file
  if (!existsSync(target)) {
    res.writeHead(404).end(`not found: ${url.pathname}`)
    return
  }

  res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' })
  createReadStream(target).pipe(res)
}).listen(port, () => {
  console.log(`serving ${apps.map((a) => `/r1apps/${a}/`).join(' ')} on http://localhost:${port}`)
})
