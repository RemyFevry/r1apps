import { decodeTransitRef, transitRawUrl } from './transit'

/**
 * One decoder for the two deep-link doors (#16): the app entry reads the raw
 * URL from `?add=`, the companion QR page prefills from `?book=` — both fall
 * back to the compact `?b=` transit code for raw.githubusercontent URLs.
 */
export function decodeBookParam(params: URLSearchParams, rawParam: string): string | null {
  const raw = params.get(rawParam)
  if (raw) return raw
  const code = params.get('b')
  if (!code) return null
  const ref = decodeTransitRef(code)
  return ref ? transitRawUrl(ref) : null
}
