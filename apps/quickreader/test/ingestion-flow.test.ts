import { describe, expect, test } from 'vitest'
import {
  failIngest,
  ingestView,
  startIngest,
  submitIngest,
  type IngestFlow,
} from '../src/screens/ingestion-flow'

const LONG = 'https://example.com/' + 'a'.repeat(80) + '.epub'

describe('startIngest', () => {
  test('no url → idle (typed flow, form shown)', () => {
    expect(startIngest()).toEqual({ t: 'idle' })
  })

  test('url → busy auto-start (deep-link flow, no form)', () => {
    expect(startIngest('https://x.example/b.epub')).toEqual({ t: 'busy', url: 'https://x.example/b.epub', auto: true })
  })
})

describe('submitIngest (typed flow)', () => {
  test('idle + url → busy typed', () => {
    expect(submitIngest({ t: 'idle' }, 'https://x.example/b.epub')).toEqual({
      t: 'busy',
      url: 'https://x.example/b.epub',
      auto: false,
    })
  })

  test('empty or whitespace url is ignored', () => {
    expect(submitIngest({ t: 'idle' }, '')).toEqual({ t: 'idle' })
    expect(submitIngest({ t: 'idle' }, '   ')).toEqual({ t: 'idle' })
  })

  test('submit while busy is ignored (no re-entry)', () => {
    const busy: IngestFlow = { t: 'busy', url: 'https://x.example/b.epub', auto: false }
    expect(submitIngest(busy, 'https://other.example/c.epub')).toBe(busy)
  })

  test('submit after failure retries (failed → busy)', () => {
    const failed: IngestFlow = { t: 'failed', url: 'https://x.example/b.epub', auto: false, message: 'Not a readable EPUB' }
    expect(submitIngest(failed, 'https://x.example/b.epub')).toEqual({
      t: 'busy',
      url: 'https://x.example/b.epub',
      auto: false,
    })
  })
})

describe('failIngest', () => {
  test('busy → failed carrying the message', () => {
    expect(failIngest({ t: 'busy', url: 'https://x.example/b.epub', auto: true }, 'Could not fetch')).toEqual({
      t: 'failed',
      url: 'https://x.example/b.epub',
      auto: true,
      message: 'Could not fetch',
    })
  })

  test('non-busy states are unchanged', () => {
    const idle: IngestFlow = { t: 'idle' }
    expect(failIngest(idle, 'x')).toBe(idle)
    const failed: IngestFlow = { t: 'failed', url: 'u', auto: false, message: 'm' }
    expect(failIngest(failed, 'x')).toBe(failed)
  })
})

describe('ingestView — typed flow (no url provided)', () => {
  test('idle: form with Add, empty status, side exits', () => {
    expect(ingestView({ t: 'idle' })).toEqual({
      heading: 'Add book',
      status: '',
      linkUrl: null,
      form: true,
      addLabel: 'Add',
      addLocked: false,
      sideExits: true,
    })
  })

  test('busy: form locked, downloading status truncated at 40 chars', () => {
    const v = ingestView({ t: 'busy', url: LONG, auto: false })
    expect(v.heading).toBe('Add book')
    expect(v.form).toBe(true)
    expect(v.addLabel).toBe('…')
    expect(v.sideExits).toBe(false)
    expect(v.status).toBe('Downloading ' + LONG.slice(0, 40) + '…')
  })

  test('busy status short url has no ellipsis', () => {
    expect(ingestView({ t: 'busy', url: 'https://x.example/b.epub', auto: false }).status).toBe(
      'Downloading https://x.example/b.epub',
    )
  })

  test('failed: form back, message only, side exits (retry)', () => {
    const v = ingestView({ t: 'failed', url: 'https://x.example/b.epub', auto: false, message: 'Not a readable EPUB' })
    expect(v.form).toBe(true)
    expect(v.addLabel).toBe('Add')
    expect(v.status).toBe('Not a readable EPUB')
    expect(v.sideExits).toBe(true)
  })
})

describe('ingestView — auto flow (deep-link url provided)', () => {
  test('busy: no form, plain Downloading…, side inert', () => {
    const v = ingestView({ t: 'busy', url: LONG, auto: true })
    expect(v.heading).toBe('Adding book')
    expect(v.status).toBe('Downloading…')
    expect(v.linkUrl).toBe(LONG)
    expect(v.form).toBe(false)
    expect(v.addLocked).toBe(true)
    expect(v.sideExits).toBe(false)
  })

  test('failed: no form, message + url provenance, side exits', () => {
    const v = ingestView({ t: 'failed', url: LONG, auto: true, message: 'Server returned an error (404)' })
    expect(v.form).toBe(false)
    expect(v.linkUrl).toBe(LONG)
    expect(v.sideExits).toBe(true)
    expect(v.status).toBe('Server returned an error (404) — ' + LONG.slice(0, 60) + '…')
  })

  test('failed status short url has no ellipsis', () => {
    expect(ingestView({ t: 'failed', url: 'https://x.example/b.epub', auto: true, message: 'Storage full' }).status).toBe(
      'Storage full — https://x.example/b.epub',
    )
  })
})
