import { installPayload, renderQr } from 'r1-kit'

const appUrl = new URL('.', location.href).href

renderQr(
  document.getElementById('install-qr') as HTMLElement,
  installPayload({
    title: 'SteadyReader',
    url: `${appUrl}?v=${__BUILD_ID__}`,
    description: 'Read-along reader — see and hear',
    themeColor: '#FE5000',
  }),
)
