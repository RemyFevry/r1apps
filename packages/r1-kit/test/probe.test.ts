import { describe, expect, test } from 'vitest'
import { probeDeviceStorage } from '../src/storage'

function healthyArea() {
  const m = new Map<string, string>()
  return {
    async getItem(k: string) {
      return m.get(k) ?? null
    },
    async setItem(k: string, v: string) {
      m.set(k, v)
    },
    async removeItem(k: string) {
      m.delete(k)
    },
  }
}

describe('probeDeviceStorage', () => {
  test('absent when the bridge is missing', async () => {
    delete (globalThis as Record<string, unknown>).creationStorage
    expect(await probeDeviceStorage()).toBe('absent')
  })

  test('device when a write reads back', async () => {
    ;(globalThis as Record<string, unknown>).creationStorage = { plain: healthyArea() }
    expect(await probeDeviceStorage()).toBe('device')
  })

  test('write-lost for fire-and-forget bridges', async () => {
    ;(globalThis as Record<string, unknown>).creationStorage = {
      plain: {
        async getItem() {
          return null
        },
        async setItem() {},
        async removeItem() {},
      },
    }
    expect(await probeDeviceStorage()).toBe('write-lost')
  })

  test('write-lost when setItem throws', async () => {
    ;(globalThis as Record<string, unknown>).creationStorage = {
      plain: {
        async getItem() {
          return null
        },
        async setItem() {
          throw new Error('quota')
        },
        async removeItem() {},
      },
    }
    expect(await probeDeviceStorage()).toBe('write-lost')
    delete (globalThis as Record<string, unknown>).creationStorage
  })
})
