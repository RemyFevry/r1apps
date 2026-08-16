import { installPayload, renderQr } from 'r1-kit'

const appUrl = new URL('.', location.href).href

renderQr(
  document.getElementById('install-qr') as HTMLElement,
  installPayload({
    title: 'SteadyReader',
    url: `${appUrl}?v=${__COMMIT_SHA__}`,
    description: 'Read-along reader — see and hear',
    themeColor: '#FE5000',
  }),
)
