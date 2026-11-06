import { describe, expect, it } from 'vitest'

import { DilCompileError, MAX_DIL_SOURCE_BYTES, compileDilSource } from '../src/dil/compiler.js'

describe('Host-only DIL compiler adapter', () => {
  it('compiles a real declared DIL program into inert code/constants without executing it in the test host', () => {
    const marker = '__dilCompilerMustNotExecute'
    const source = [
      'A source-owned calculator.',
      '{@body const [seats,setSeats] = DIL.useState(5)}',
      '{@body const total = seats * 2}',
      `{@body globalThis[${JSON.stringify(marker)}] = "executed-by-generated-dil"}`,
      '<box gap={4}>',
      '  <title>Seats</title>',
      '  <slider value={seats} onChange={setSeats}/>',
      '  <text>{total}</text>',
      '</box>',
    ].join('\n')
    delete (globalThis as Record<string, unknown>)[marker]

    const compiled = compileDilSource(source)

    expect(compiled.source).toBe(source)
    expect(compiled.sourceLength).toBe(source.length)
    expect(compiled.protocolVersion).toBe(1)
    expect(compiled.code).toContain('DIL.render')
    expect(compiled.code).toContain(marker)
    expect(compiled.codeLength).toBe(compiled.code.length)
    expect(compiled.constants).toEqual(expect.any(Object))
    expect(compiled.stateKeys).toContain('seats')
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
  })

  it('returns a complete program and diagnostics for a partial stream prefix without evaluating it', () => {
    const partial = [
      'Partially streamed source.',
      '{@body const [count,setCount] = DIL.useState(1)}',
      '<box>',
      '  <text>{count}',
    ].join('\n')

    const compiled = compileDilSource(partial)

    expect(compiled.source).toBe(partial)
    expect(compiled.code).toContain('DIL.render')
    expect(compiled.diagnostics).toEqual(expect.any(Array))
    expect(compiled.fallbackMarkdown).toContain('Partially streamed source.')
  })

  it('rejects source beyond the explicit 128 KiB authoring boundary before invoking the reference compiler', () => {
    const oversized = 'x'.repeat(MAX_DIL_SOURCE_BYTES + 1)
    try {
      compileDilSource(oversized)
      throw new Error('Expected source-size rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(DilCompileError)
      expect((error as DilCompileError).code).toBe('DIL_SOURCE_TOO_LARGE')
    }
  })
})
