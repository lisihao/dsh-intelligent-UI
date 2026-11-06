import { describe, expect, it } from 'vitest'

import {
  DIL_PROTOCOL_VERSION,
  DIL_CURATED_UIVERSE_COMPONENT_IDS,
  DIL_LIBRARY_COMPONENT_IDS,
  DilProtocolError,
  MAX_DIL_COMPONENT_INPUT_BYTES,
  MAX_DIL_TREE_BYTES,
  validateCompiledDil,
  validateDilTree,
} from '../src/dil/protocol.js'

function compiled(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const source = 'source'
  const code = 'DIL.render(__dil.jsx("box",null));'
  return {
    ok: true,
    protocolVersion: DIL_PROTOCOL_VERSION,
    source,
    sourceLength: source.length,
    code,
    codeLength: code.length,
    constants: {},
    constantCount: 0,
    requiredComponents: [],
    appData: { opGenui: { componentResults: {}, modelDataBindings: {} } },
    genuiComponents: [],
    stateKeys: [],
    fallbackMarkdown: 'source',
    diagnostics: [],
    diagnosticSummary: 'clean',
    durationMs: 0,
    compiledAt: '2026-11-06T00:00:00.000Z',
    ...overrides,
  }
}

function codeOf(run: () => unknown): string {
  try {
    run()
    throw new Error('Expected DilProtocolError')
  } catch (error) {
    expect(error).toBeInstanceOf(DilProtocolError)
    return (error as DilProtocolError).code
  }
}

describe('DIL compiled payload boundary', () => {
  it('clones a complete supported compiler payload and rejects a version mismatch', () => {
    const payload = compiled()
    const safe = validateCompiledDil(payload)
    expect(safe).toMatchObject({ source: 'source', protocolVersion: 1, appData: { opGenui: { componentResults: {} } } })
    expect(safe).not.toBe(payload)
    expect(codeOf(() => validateCompiledDil(compiled({ protocolVersion: 2 })))).toBe('DIL_COMPILED_VERSION_UNSUPPORTED')
  })

  it('preserves a parsed __proto__ JSON key without changing Object.prototype', () => {
    const constants = JSON.parse('{"__proto__":{"retained":true}}')
    const safe = validateCompiledDil(compiled({ constants, constantCount: 1 }))

    expect(Object.prototype).not.toHaveProperty('retained')
    expect(Object.getPrototypeOf(safe.constants)).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(safe.constants, '__proto__')).toBe(true)
    expect(safe.constants.__proto__).toEqual({ retained: true })
  })
})

describe('DIL snapshot tree boundary', () => {
  it('accepts and clones only the explicit intrinsic vocabulary and handler-ref shape', () => {
    const source = {
      t: 'box',
      p: { gap: 4, onClick: { __dilFn: 'fn1' } },
      c: [
        { t: 'title', c: [{ t: '#text', v: 'Source title' }] },
        { t: 'link', p: { href: 'https://example.test/path' }, c: [{ t: '#text', v: 'Read source' }] },
      ],
    }
    const safe = validateDilTree(source)
    expect(safe).toEqual(source)
    expect(safe).not.toBe(source)

    const referenceFragment = { t: '#frag', c: [{ t: '#text', v: 'Leading reference text' }, { t: 'badge', c: [{ t: '#text', v: 'Ready' }] }] }
    expect(validateDilTree(referenceFragment)).toEqual(referenceFragment)
  })

  it('accepts source-only markdown nodes and rejects missing, non-string, or child content', () => {
    const markdown = '# 目录\n\n```ts\nconst total = 3\n```\n\n$E=mc^2$'
    const source = { t: 'markdown', p: { source: markdown } }
    expect(validateDilTree(source)).toEqual(source)
    expect(codeOf(() => validateDilTree({ t: 'markdown' }))).toBe('DIL_TREE_INVALID_PROPS')
    expect(codeOf(() => validateDilTree({ t: 'markdown', p: { source: 3 } }))).toBe('DIL_TREE_INVALID_PROPS')
    expect(codeOf(() => validateDilTree({ t: 'markdown', p: { source: markdown }, c: [{ t: '#text', v: 'ignored' }] }))).toBe('DIL_TREE_INVALID_NODE')
  })

  it('accepts only bounded source JSON for exact host-owned external components', () => {
    const source = {
      t: 'component',
      p: {
        id: 'tuffui:data-table',
        input: {
          title: '实际表格',
          data: { code: 'const actual = 12', sources: [{ url: 'https://example.test/source', image: { src: 'data:image/png;base64,AA==' } }], rows: [{ label: 'Q1', value: 12, action: 'inspect' }] },
          binding: { actions: [{ actionId: 'host-table-select' }] },
        },
        onChange: { __dilFn: 'updateTable' },
      },
    }
    const safe = validateDilTree(source)
    expect(safe).toEqual(source)
    expect(safe).not.toBe(source)

    expect(codeOf(() => validateDilTree({ t: 'component' }))).toBe('DIL_TREE_COMPONENT_INVALID')
    expect(codeOf(() => validateDilTree({ t: 'component', p: { id: 'dil:component', input: {} } }))).toBe('DIL_TREE_COMPONENT_INVALID')
    expect(codeOf(() => validateDilTree({ t: 'component', p: { id: 'tuffui:data-table', input: {}, rendererKey: 'untrusted' } }))).toBe('DIL_TREE_COMPONENT_INVALID')
    const semanticJson = {
      data: { code: 'const actual = 12', sources: [{ url: 'https://example.test/source', src: 'data:image/png;base64,AA==' }], rows: [{ action: 'inspect' }] },
      binding: { actions: [{ actionId: 'host-action' }] },
      rendererKey: 'schema-data-only',
      eval: 'documented as data',
      __dilFn: 'documented-example',
      componentId: 'dil:component',
      document: { type: 'component', literal: 'dil:component' },
    }
    expect(validateDilTree({ t: 'component', p: { id: 'tuffui:code-block', input: semanticJson } })).toMatchObject({ t: 'component' })
    expect(DIL_CURATED_UIVERSE_COMPONENT_IDS).toHaveLength(15)
    for (const id of [...DIL_CURATED_UIVERSE_COMPONENT_IDS, ...DIL_LIBRARY_COMPONENT_IDS]) {
      expect(validateDilTree({ t: 'component', p: { id, input: { source: 'actual' } } })).toMatchObject({ t: 'component' })
    }
    expect(codeOf(() => validateDilTree({ t: 'component', p: { id: 'component:not-pinned', input: {} } }))).toBe('DIL_TREE_COMPONENT_INVALID')
    expect(codeOf(() => validateDilTree({ t: 'component', p: { id: 'tuffui:data-table', input: { value: () => 'not-json' } } }))).toBe('DIL_TREE_COMPONENT_INPUT_INVALID')
    expect(codeOf(() => validateDilTree({ t: 'component', p: { id: 'canvas:glitch', input: 'x'.repeat(MAX_DIL_COMPONENT_INPUT_BYTES + 1) } }))).toBe('DIL_TREE_COMPONENT_INPUT_LIMIT_EXCEEDED')
    expect(codeOf(() => validateDilTree({ t: 'component', p: { id: 'canvas:glitch', input: {} }, c: [{ t: '#text', v: 'children forbidden' }] }))).toBe('DIL_TREE_INVALID_NODE')
  })

  it('keeps form submission host-owned while applying tag-specific link, image, and event boundaries', () => {
    const source = {
      t: 'form',
      p: { action: 'confirm' },
      c: [
        { t: 'input', p: { onChange: { __dilFn: 'change1' } } },
        { t: 'link', p: { href: 'https://example.test/continue?source=dil' }, c: [{ t: '#text', v: 'Continue' }] },
        { t: 'image', p: { src: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    }
    expect(validateDilTree(source)).toEqual(source)

    expect(codeOf(() => validateDilTree({ t: 'form' }))).toBe('DIL_TREE_INVALID_PROPS')
    expect(codeOf(() => validateDilTree({ t: 'form', p: { action: 'javascript:alert(1)' } }))).toBe('DIL_TREE_INVALID_PROPS')
    expect(codeOf(() => validateDilTree({ t: 'form', p: { action: 'confirm', onSubmit: { __dilFn: 'submit1' } } }))).toBe('DIL_TREE_UNSAFE_PROP')
    expect(codeOf(() => validateDilTree({ t: 'button', p: { type: 'submit', onClick: { __dilFn: 'submit1' } } }))).toBe('DIL_TREE_UNSAFE_PROP')
    expect(codeOf(() => validateDilTree({ t: 'link', p: { href: '/relative' } }))).toBe('DIL_TREE_UNSAFE_URL')
    expect(codeOf(() => validateDilTree({ t: 'image', p: { src: 'https://example.test/model-controlled.png' } }))).toBe('DIL_TREE_UNSAFE_URL')
    expect(codeOf(() => validateDilTree({ t: 'input', p: { onValueChange: { __dilFn: 'change1' } } }))).toBe('DIL_TREE_UNSAFE_PROP')
  })

  it('rejects arbitrary/unsafe tags, props, URLs, and forged handler references by named error', () => {
    expect(codeOf(() => validateDilTree({ t: 'script', c: [] }))).toBe('DIL_TREE_UNSAFE_TAG')
    expect(codeOf(() => validateDilTree({ t: 'UnknownPascalComponent' }))).toBe('DIL_TREE_UNSUPPORTED_TAG')
    expect(codeOf(() => validateDilTree({ t: 'box', p: { innerHTML: '<b>x</b>' } }))).toBe('DIL_TREE_UNSAFE_PROP')
    expect(codeOf(() => validateDilTree({ t: 'box', p: { style: { backgroundImage: 'url(https://example.test/x)' } } }))).toBe('DIL_TREE_UNSAFE_STYLE')
    expect(codeOf(() => validateDilTree({ t: 'link', p: { href: 'javascript:alert(1)' } }))).toBe('DIL_TREE_UNSAFE_URL')
    expect(codeOf(() => validateDilTree({ t: 'button', p: { onClick: { __dilFn: 'fn1', extra: true } } }))).toBe('DIL_TREE_INVALID_HANDLER')
  })

  it('rejects cycles, depth, node-count, and serialized-size overflow', () => {
    const cyclic: Record<string, unknown> = { t: 'box', c: [] }
    ;(cyclic.c as unknown[]).push(cyclic)
    expect(codeOf(() => validateDilTree(cyclic))).toBe('DIL_TREE_CYCLE')

    const deep: Record<string, unknown> = { t: 'box' }
    let cursor = deep
    for (let index = 0; index <= 32; index += 1) {
      const child: Record<string, unknown> = { t: 'box' }
      cursor.c = [child]
      cursor = child
    }
    expect(codeOf(() => validateDilTree(deep))).toBe('DIL_TREE_DEPTH_EXCEEDED')

    const wide = { t: 'box', c: Array.from({ length: 2_000 }, () => ({ t: '#text', v: 'x' })) }
    expect(codeOf(() => validateDilTree(wide))).toBe('DIL_TREE_NODE_LIMIT_EXCEEDED')
    expect(codeOf(() => validateDilTree({ t: '#text', v: 'x'.repeat(MAX_DIL_TREE_BYTES + 1) }))).toBe('DIL_TREE_SIZE_EXCEEDED')
  })
})
