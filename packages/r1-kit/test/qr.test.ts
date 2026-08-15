import { describe, expect, test } from 'vitest'
import { installPayload } from '../src/qr'

describe('installPayload', () => {
  test('emits pure ASCII even with non-ASCII input', () => {
    const p = installPayload({
      title: 'QuickReader — café ☕ shelf',
      url: 'https://example.com/a/?v=1',
      description: 'personal — shelf',
      themeColor: '#FE5000',
    })
    expect(p).toMatch(/^[\x20-\x7e]*$/)
    expect(JSON.parse(p)).toEqual({
      title: 'QuickReader — café ☕ shelf',
      url: 'https://example.com/a/?v=1',
      description: 'personal — shelf',
      iconUrl: '',
      themeColor: '#FE5000',
    })
  })

  test('ASCII input passes through unchanged', () => {
    const card = { title: 'T', url: 'https://x/', description: 'd', themeColor: '#000000' }
    expect(JSON.parse(installPayload(card))).toEqual({ ...card, iconUrl: '' })
  })
})
