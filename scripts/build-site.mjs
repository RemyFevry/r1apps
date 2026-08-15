import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const appsDir = join(root, 'apps')
const siteDir = join(root, 'site')

rmSync(siteDir, { recursive: true, force: true })
mkdirSync(siteDir, { recursive: true })

const apps = readdirSync(appsDir).filter((name) => existsSync(join(appsDir, name, 'dist')))
const links = apps.map((name) => `<li><a href="/r1apps/${name}/">${name}</a></li>`).join('\n')

for (const name of apps) {
  cpSync(join(appsDir, name, 'dist'), join(siteDir, name), { recursive: true })
}

writeFileSync(
  join(siteDir, 'index.html'),
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>r1apps</title></head>
<body>
<h1>r1apps</h1>
<ul>
${links}
</ul>
</body>
</html>
`,
)
console.log(`site assembled: ${apps.join(', ') || '(no apps built)'}`)
