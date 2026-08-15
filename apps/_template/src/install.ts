import { installPayload, renderQr } from 'r1-kit'

const appUrl = new URL('.', location.href).href

renderQr(
  document.getElementById('install-qr') as HTMLElement,
  installPayload({
    title: 'R1 App',
    url: `${appUrl}?v=${__COMMIT_SHA__}`,
    description: 'My R1 creation',
    themeColor: '#FE5000',
  }),
)
