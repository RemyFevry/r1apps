export function closeApp(): void {
  const api = (globalThis as { closeWebView?: { postMessage(msg: string): unknown } }).closeWebView
  if (api && typeof api.postMessage === 'function') api.postMessage('')
}
