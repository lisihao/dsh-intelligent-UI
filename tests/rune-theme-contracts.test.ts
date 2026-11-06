import { describe, expect, it } from 'vitest'
import {
  RUNE_SOURCE_COMMIT,
  createRuneNonce,
  parseRuneMaterialPayload,
  parseRuneRuntimeInfo,
  runeConnectMessage,
} from '../src/rune/contracts.js'

const payload = {
  version: 1,
  width: 390,
  height: 320,
  reducedMotion: false,
  surfaces: [{ id: 'glass', role: 'card', x: 16, y: 12, width: 358, height: 120, state: 'hover', material: 'fluted-glass' }],
}

describe('Rune runtime contract', () => {
  it('accepts a bounded real fluted-glass surface without widening the data boundary', () => {
    expect(parseRuneMaterialPayload(payload)).toEqual(payload)
    expect(() => parseRuneMaterialPayload({ ...payload, extra: true })).toThrow('RUNE_THEME_PAYLOAD_EXTRA_FIELD')
    expect(() => parseRuneMaterialPayload({ ...payload, surfaces: [{ ...payload.surfaces[0], material: 'fake-glass' }] })).toThrow('RUNE_THEME_SURFACE_MATERIAL_INVALID')
  })

  it('accepts only the fixed loopback asset frame and makes a nonce-bound connect message', () => {
    const runtime = parseRuneRuntimeInfo({
      protocolVersion: 1,
      library: 'rune',
      sourceCommit: RUNE_SOURCE_COMMIT,
      frameUrl: 'http://127.0.0.1:48765/component-assets/rune/frame.html',
    })
    expect(runtime.library).toBe('rune')
    expect(() => parseRuneRuntimeInfo({ ...runtime, frameUrl: 'https://example.com/frame.html' })).toThrow('COMPONENT_RUNTIME_URL_INVALID')
    const deterministicCrypto = {
      getRandomValues<T extends ArrayBufferView | null>(bytes: T): T {
        if (bytes instanceof Uint8Array) bytes.fill(0xab)
        return bytes
      },
    }
    const nonce = createRuneNonce(deterministicCrypto)
    expect(nonce).toBe('ab'.repeat(16))
    expect(runeConnectMessage(nonce, 'http://localhost:3000')).toEqual({ type: 'rune/connect', protocolVersion: 1, nonce, parentOrigin: 'http://localhost:3000' })
  })
})
