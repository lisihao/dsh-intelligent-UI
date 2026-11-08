import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { canvasExtendedLiquidFrameDocument } from './canvas-extended-isolated-frame.js'

/** Same-origin fixed frame avoids inheriting a host page's restrictive blob CSP. */
export const CANVAS_EXTENDED_LIQUID_FRAME_PATH = '/api/intelligent-ui-canvas-liquid-frame'

export function canvasExtendedLiquidFrameUrl(nonce: string): string {
  if (!/^[0-9a-f]{32}$/u.test(nonce)) throw new Error('CANVAS_EXTENDED_LIQUID_NONCE')
  return `${CANVAS_EXTENDED_LIQUID_FRAME_PATH}?${new URLSearchParams({ nonce }).toString()}`
}

/**
 * Registers only a fixed plugin frame. Request input is one random nonce used
 * to bind the parent MessagePort handshake; it never selects code or content.
 */
export function installCanvasExtendedLiquidFrameHost(ctx: Context): () => void {
  return ctx.connection.fetch.register({
    path: CANVAS_EXTENDED_LIQUID_FRAME_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const url = new URL(request.url)
      const nonce = url.searchParams.get('nonce')
      if (!nonce || url.searchParams.size !== 1 || !/^[0-9a-f]{32}$/u.test(nonce)) {
        return new Response('Invalid Liquid frame request.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
      }
      return new Response(canvasExtendedLiquidFrameDocument(nonce), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
          'x-content-type-options': 'nosniff',
        },
      })
    },
  })
}
