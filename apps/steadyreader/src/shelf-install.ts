import { installPayload, renderQr } from 'r1-kit'

;(globalThis as unknown as { __shelfInstall: unknown }).__shelfInstall = { installPayload, renderQr }
