import { describe, expect, it } from 'vitest'

import { compileDilSource } from '../src/dil/compiler.js'
import {
  DIL_PROTOCOL,
  DIL_REFERENCE_COMMIT,
  artifactSchema,
  dilCompilePreviewInputSchema,
  dilPayloadSchema,
  dilRuntimeInfoSchema,
  publishSchema,
} from '../src/contracts.js'
import { RPC_REMOTE } from '../src/remote.js'

const source = [
  'A source-owned calculator.',
  '{@body const [seats,setSeats] = DIL.useState(5)}',
  '<box gap={4}>',
  '  <title>Seats</title>',
  '  <slider value={seats} onChange={setSeats}/>',
  '</box>',
].join('\n')

function payload() {
  return {
    formatVersion: 1 as const,
    source,
    compiled: compileDilSource(source),
    referenceCommit: DIL_REFERENCE_COMMIT,
  }
}

describe('DIL durable contracts', () => {
  it('accepts only a compiler-validated, source-preserving durable payload', () => {
    const durable = payload()
    expect(dilPayloadSchema.parse(durable)).toMatchObject({ source, referenceCommit: DIL_REFERENCE_COMMIT })
    expect(artifactSchema.parse({
      formatVersion: 1,
      id: '123e4567-e89b-42d3-a456-426614174000',
      createdAt: '2026-11-06T00:00:00.000Z',
      source: { sessionId: 'session-1', callId: 'call-1', kind: 'generated', label: 'Calculator' },
      protocol: DIL_PROTOCOL,
      raw: source,
      payload: durable,
      providerId: DIL_PROTOCOL,
    })).toMatchObject({ protocol: DIL_PROTOCOL, raw: source, payload: { source } })
  })

  it('rejects unknown payload versions, forged compiled data, source mismatches, and non-source DIL publishing', () => {
    const durable = payload()
    expect(dilPayloadSchema.safeParse({ ...durable, formatVersion: 2 }).success).toBe(false)
    expect(dilPayloadSchema.safeParse({ ...durable, compiled: { protocolVersion: 99 } }).success).toBe(false)
    const compiledOtherSource = 'compiler source differs from durable source'
    expect(dilPayloadSchema.safeParse({ ...durable, compiled: { ...durable.compiled, source: compiledOtherSource, sourceLength: compiledOtherSource.length } }).success).toBe(false)
    expect(artifactSchema.safeParse({
      formatVersion: 1,
      id: '123e4567-e89b-42d3-a456-426614174000',
      createdAt: '2026-11-06T00:00:00.000Z',
      source: { sessionId: 'session-1', kind: 'generated', label: 'Calculator' },
      protocol: DIL_PROTOCOL,
      raw: 'changed after compilation',
      payload: durable,
      providerId: DIL_PROTOCOL,
    }).success).toBe(false)
    expect(publishSchema.safeParse({
      source: { sessionId: 'session-1', kind: 'generated', label: 'Calculator' },
      protocol: DIL_PROTOCOL,
      raw: source,
      payload: durable,
      providerId: DIL_PROTOCOL,
    }).success).toBe(false)
  })

  it('keeps preview and runtime RPC shapes finite and explicit', () => {
    expect(dilCompilePreviewInputSchema.parse({ sessionId: 'session-1', source })).toEqual({ sessionId: 'session-1', source })
    expect(dilCompilePreviewInputSchema.safeParse({ sessionId: 'session-1', source, compiled: {} }).success).toBe(false)
    expect(dilRuntimeInfoSchema.parse({ protocolVersion: 1, frameUrl: 'http://127.0.0.1:43123/runner.html' })).toEqual({ protocolVersion: 1, frameUrl: 'http://127.0.0.1:43123/runner.html' })
    expect(dilRuntimeInfoSchema.safeParse({ protocolVersion: 2, frameUrl: 'http://127.0.0.1:43123/runner.html' }).success).toBe(false)
    for (const method of ['dilRuntimeInfo', 'dilCompilePreview']) {
      const descriptor = RPC_REMOTE.descriptors!.find(value => value.method === method)
      expect(descriptor?.parameters[0]?.codec.mode).toBe('strict')
      expect(descriptor?.result.mode).toBe('strict')
    }
  })
})
