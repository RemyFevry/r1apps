import { THEME, installPayload, renderQr } from 'r1-kit'

const appUrl = new URL('.', location.href).href

renderQr(
  document.getElementById('install-qr') as HTMLElement,
  installPayload({
    title: 'R1voice Probe',
    url: `${appUrl}?v=${__BUILD_ID__}`,
    description: 'Rabbit voice bridge timing probe',
    themeColor: THEME.accent,
  }),
)
