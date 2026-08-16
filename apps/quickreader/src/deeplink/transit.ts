// Compact transit reference: a raw.githubusercontent.com book URL packed into a
// base64url string with no slashes or percent-encoding, so the deep-link QR
// stays short enough for the R1's install-URL handling (full URLs in the QR
// produced truncated/mangled fetches → on-device 404s).

export interface TransitRef {
  account: string
  repo: string
  file: string
}

export function encodeTransitRef(ref: TransitRef): string {
  const raw = `${ref.account}|${ref.repo}|${ref.file}`
  const b64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return b64
}

export function decodeTransitRef(code: string): TransitRef | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(b64)
    const [account, repo, file] = raw.split('|')
    if (!account || !repo || !file) return null
    if (!/^[A-Za-z0-9-]+$/.test(account) || !/^[A-Za-z0-9._-]+$/.test(repo) || !/^[A-Za-z0-9._-]+$/.test(file)) return null
    return { account, repo, file }
  } catch {
    return null
  }
}

export function transitRawUrl(ref: TransitRef): string {
  return `https://raw.githubusercontent.com/${ref.account}/${ref.repo}/main/${encodeURIComponent(ref.file)}`
}

export function rawUrlToTransitCode(url: string): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/main\/([A-Za-z0-9._-]+)$/.exec(url)
  if (!m) return null
  return encodeTransitRef({ account: m[1], repo: m[2], file: m[3] })
}
