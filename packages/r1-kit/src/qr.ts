import qrcode from 'qrcode-generator'

export interface InstallCard {
  title: string
  url: string
  description: string
  iconUrl?: string
  themeColor: string
}

export function installPayload(card: InstallCard): string {
  return JSON.stringify({
    title: card.title,
    url: card.url,
    description: card.description,
    iconUrl: card.iconUrl ?? '',
    themeColor: card.themeColor,
  })
}

export function renderQr(el: HTMLElement, text: string, size = 200): void {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  el.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 })
  const svg = el.firstElementChild as SVGSVGElement | null
  if (svg) {
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
  }
}
