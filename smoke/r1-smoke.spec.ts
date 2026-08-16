import { test, expect } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { R1_JS_DENYLIST } from '../r1.config.mjs'

/**
 * R1 device simulation: each app boots in Chromium at 240×282 with the device's
 * JS bridge mocked, then gets driven through R1 hardware events (side button,
 * scroll wheel, push-to-talk) exactly as r1-kit receives them on-device.
 *
 * Chromium here is newer than the R1 floor, so the suite also neutralizes every
 * post-floor built-in from R1_JS_DENYLIST before app code runs — runtime usage
 * the static scan cannot grep (iterator helpers, dynamic dispatch) throws and
 * fails the test instead of silently passing.
 */

const denyPaths = R1_JS_DENYLIST.flatMap((e) => (e.path ? [e.path] : []))

const apps = readdirSync(join(process.cwd(), 'apps')).filter((app) =>
  existsSync(join(process.cwd(), 'apps', app, 'dist', 'index.html')),
)

if (!apps.length) {
  test('build produced at least one app', () => {
    throw new Error('no app dist found (apps/<name>/dist/index.html) — run `pnpm build` first')
  })
}

for (const app of apps) {
  test.describe(`R1 device sim — ${app}`, () => {
    test('boots and survives hardware input at 240×282', async ({ page }) => {
      const problems: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`)
      })
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

      // The R1 injects creationStorage + closeWebView into the webview before app
      // code runs. Same moment: delete built-ins newer than the R1 floor.
      await page.addInitScript(
        ({ paths }) => {
          const w = window as unknown as Record<string, Record<string, unknown>>
          for (const p of paths) {
            const parts = p.split('.')
            let obj: Record<string, unknown> | undefined = w[parts[0]]
            for (const k of parts.slice(1, -1)) obj = obj?.[k] as Record<string, unknown> | undefined
            const last = parts[parts.length - 1]
            if (obj && last in obj) delete obj[last]
          }
          const mem = new Map<string, string>()
          w.creationStorage = {
            plain: {
              getItem: (k: string) => Promise.resolve(mem.get(k) ?? null),
              setItem: (k: string, v: string) => {
                mem.set(k, v)
                return Promise.resolve()
              },
              removeItem: (k: string) => {
                mem.delete(k)
                return Promise.resolve()
              },
            },
          }
          w.closeWebView = { postMessage: () => {} }
        },
        { paths: denyPaths },
      )

      await page.goto(`/r1apps/${app}/`)

      // The floor shim must be active — guards against a silent addInitScript failure.
      expect(await page.evaluate(() => typeof (window as unknown as { Promise?: { withResolvers?: unknown } }).Promise?.withResolvers)).toBe('undefined')
      expect(
        await page.evaluate(() => typeof (window as unknown as { Iterator?: { prototype?: { take?: unknown } } }).Iterator?.prototype?.take),
      ).toBe('undefined')

      // Exact R1 screen size.
      expect(await page.evaluate(() => window.innerWidth), 'viewport width').toBe(240)
      expect(await page.evaluate(() => window.innerHeight), 'viewport height').toBe(282)

      // App actually mounted something.
      await expect
        .poll(() => page.evaluate(() => document.querySelector('#app')?.children.length ?? document.body.children.length), { timeout: 10_000 })
        .toBeGreaterThan(0)

      // Nothing spills horizontally off the 240px screen.
      const scrollWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(240)

      // R1 hardware events, as the device dispatches them (see r1-kit attachInputs).
      await page.evaluate(() => {
        for (const type of ['scrollDown', 'scrollDown', 'scrollUp', 'sideClick', 'longPressStart', 'longPressEnd']) {
          window.dispatchEvent(new Event(type))
        }
      })

      // Keyboard fallbacks the kit maps to the same handlers (desktop dev path).
      for (const key of ['ArrowDown', 'ArrowUp', 'Escape', ' ']) await page.keyboard.press(key)

      // Give async fallout (storage probes, renders) a beat to surface.
      await page.waitForTimeout(500)

      expect(problems, 'no console errors or page errors').toEqual([])
    })

    test('install QR companion page is deployed next to the app', async ({ request }) => {
      const res = await request.get(`/r1apps/${app}/install.html`)
      expect(res.status(), 'install.html served').toBe(200)
    })
  })
}
