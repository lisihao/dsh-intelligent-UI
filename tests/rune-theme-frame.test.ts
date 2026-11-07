import { describe, expect, it, vi } from 'vitest'
import { RuneFrameHost, type RuneChannelLike, type RunePortLike } from '../src/rune/frame-host.js'

class Port implements RunePortLike {
  readonly messages: unknown[] = []
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  readonly close = vi.fn()
  readonly start = vi.fn()
  postMessage(message: unknown): void { this.messages.push(message) }
  receive(data: unknown): void { this.onmessage?.({ data }) }
}

const payload = Object.freeze({
  version: 1 as const, width: 390, height: 320, reducedMotion: false,
  surfaces: Object.freeze([{ id: 'button', role: 'button' as const, x: 12, y: 18, width: 96, height: 36, state: 'idle' as const, material: 'liquid-metal' as const }]),
})

describe('Rune MessageChannel host', () => {
  it('uses a nonce-bound channel, queues until ready, and leaves dispose deliverable until closed', () => {
    const port1 = new Port(), port2 = new Port(), frame = { postMessage: vi.fn() }, events: string[] = []
    const host = new RuneFrameHost(frame, 'http://localhost:3000', 'http://127.0.0.1:48765', () => ({ port1, port2 } satisfies RuneChannelLike), event => events.push(event.kind), '01'.repeat(16))
    host.connect()
    expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'rune/connect', nonce: '01'.repeat(16) }), '*', [port2])
    const mountRevision = host.mount(payload)
    expect(port1.messages).toEqual([])
    port1.receive({ type: 'rune/ready', protocolVersion: 1, nonce: '01'.repeat(16), revision: 0 })
    expect(events).toEqual(['ready'])
    expect(port1.messages).toEqual([expect.objectContaining({ type: 'rune/mount', revision: mountRevision })])
    const disposeRevision = host.requestDispose()
    expect(disposeRevision).toBe(mountRevision + 1)
    expect(port1.messages.at(-1)).toEqual(expect.objectContaining({ type: 'rune/dispose', revision: disposeRevision }))
    expect(port1.close).not.toHaveBeenCalled()
    port1.receive({ type: 'rune/disposed', protocolVersion: 1, nonce: '01'.repeat(16), revision: disposeRevision })
    expect(events).toEqual(['ready', 'disposed'])
    host.close()
    expect(port1.close).toHaveBeenCalledTimes(1)
  })

  it('does not allow sends after a requested dispose and ignores forged nonce messages', () => {
    const port1 = new Port(), port2 = new Port(), frame = { postMessage: vi.fn() }
    const host = new RuneFrameHost(frame, 'http://localhost:3000', 'http://127.0.0.1:48765', () => ({ port1, port2 }), () => {}, '02'.repeat(16))
    host.connect()
    port1.receive({ type: 'rune/ready', protocolVersion: 1, nonce: 'ff'.repeat(16), revision: 0 })
    expect(host.isReady()).toBe(false)
    port1.receive({ type: 'rune/ready', protocolVersion: 1, nonce: '02'.repeat(16), revision: 0 })
    host.mount(payload); host.requestDispose()
    expect(() => host.update(payload)).toThrow('RUNE_FRAME_CLOSED')
  })
})
