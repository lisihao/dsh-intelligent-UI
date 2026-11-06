import { describe, expect, it } from 'vitest'

import { DilCompileError, MAX_DIL_SOURCE_BYTES, compileDilSource } from '../src/dil/compiler.js'
import { DIL_REPETITION_EXAMPLE } from '../src/dil/catalog.js'

describe('Host-only DIL compiler adapter', () => {
  it('compiles the published nested repetition grammar against real table bindings', () => {
    const compiled = compileDilSource(DIL_REPETITION_EXAMPLE, { tables: [{header:['名称','值'],rows:[['A','12'],['B','24']]}] })
    expect(compiled.ok).toBe(true)
    expect(compiled.source).toBe(DIL_REPETITION_EXAMPLE)
    expect(compiled.diagnostics).toEqual([])
  })
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

  it('binds original source data through the reference appData option without rewriting the model program', () => {
    const source = '{@body const data = DIL.useAppData(a => a.opGenui.modelDataBindings)}\n<text>{data.source}</text>'
    const bindings = { source: 'Original **source** with `code` and $x^2$.', rows: [{ label: 'A', value: 12 }] }
    const compiled = compileDilSource(source, bindings)
    expect(compiled.source).toBe(source)
    expect(compiled.ok).toBe(true)
    expect(compiled.appData).toMatchObject({ opGenui: { modelDataBindings: bindings } })
    expect(compiled.code).not.toContain(bindings.source)
  })

  it('compiles an external component declaration to inert DIL output without running its input', () => {
    const marker = '__dilExternalComponentMustRemainInert'
    const source = [
      `{@body const input = { title: "Actual source", rows: [{ label: "A", value: 2 }] }}`,
      `{@body globalThis[${JSON.stringify(marker)}] = "not executed by compiler"}`,
      '<component id="tuffui:data-table" input={input}/>',
    ].join('\n')
    delete (globalThis as Record<string, unknown>)[marker]
    const compiled = compileDilSource(source)
    expect(compiled.source).toBe(source)
    expect(compiled.code).toContain('component')
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
  })

})
