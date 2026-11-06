// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { mountUiverseRuntime, type UiverseRuntimeEvent } from '../src/uiverse/runtime-renderer.js'
import type { UiverseRuntimeComponent } from '../src/uiverse/runtime-registry.js'
import { createUiverseRuntimeRegistry } from '../src/uiverse/runtime-registry.js'
import { uiverseRuntimeFixtureFieldValue, validateUiverseRuntimeFieldValue } from '../src/uiverse/runtime-field-constraints.js'
import type { Catalog } from '../src/uiverse/catalog.js'

const mounted: HTMLElement[] = []

function component(overrides: Partial<UiverseRuntimeComponent> = {}): UiverseRuntimeComponent {
  const textId = 'fragment/button[0]/span[0]#text[0]', actionId = 'fragment/button[0]'
  return {
    id: 'fixture/component', title: 'Fixture', category: 'Buttons', sourceSha256: 'a'.repeat(64),
    source: '<button><span>Original</span><svg><path></path></svg></button><style>.bad{background:url(https://assets.example.test/image.png)}@import url(https://assets.example.test/shared.css);</style>',
    sharedCss: undefined, availability: 'interactive', selectableWhenBound: true,
    capabilities: ['action', 'decoration'],
    visualCharacteristics: { basis: 'source-declared-css-and-markup', rootTags: ['button'], elementCount: 3, declared: { shadows: false, rounded: false, borders: false, gradients: false, transparency: false, blur: false, transform3d: false, motion: false, keyframes: false, pseudoElements: false, layouts: [] }, colorTokens: [] },
    inputSchema: { requiredReadOnly: [textId], requiredInteractive: [textId, actionId], textIds: [textId], fieldIds: [], actionIds: [actionId], imageIds: [] },
    targets: [
      { id: textId, path: 'fragment/button[0]/span[0]', tag: 'span', kind: 'text', textIndex: 0, semanticRole: 'label' },
      { id: actionId, path: 'fragment/button[0]', tag: 'button', kind: 'action' },
    ], blockers: [], notes: [], ...overrides,
  }
}

function completeValues(component: UiverseRuntimeComponent) {
  const mode = component.availability === 'interactive' ? 'interactive' as const : 'read-only' as const
  const text = Object.fromEntries(component.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map((target, index) => [target.id, `bound-${String(index)}`]))
  const fields = Object.fromEntries(component.targets.filter(target => target.kind === 'value' || target.kind === 'checked' || target.kind === 'file').map(target => {
    if (target.kind === 'value') {
      const value = uiverseRuntimeFixtureFieldValue(target)
      if (value === undefined) throw new Error(`TEST_FIXTURE_FIELD_VALUE_UNAVAILABLE:${target.id}`)
      return [target.id, { value }]
    }
    return [target.id, target.kind === 'checked' ? { checked: false } : { file: true }]
  }))
  const actions = mode === 'interactive' ? Object.fromEntries(component.targets.filter(target => target.kind === 'action').map((target, index) => [target.id, { actionId: `bound-action-${String(index)}` }])) : {}
  const images = Object.fromEntries(component.targets.filter(target => target.kind === 'image').map(target => [target.id, { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'bound image' }]))
  return { mode, text, fields, actions, images }
}

function host(): HTMLElement {
  const element = document.createElement('div')
  mounted.push(element)
  document.body.append(element)
  return element
}

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove()
  document.body.replaceChildren()
})

describe('Uiverse source-bound runtime renderer', () => {
  test('changes the actual source label, reports a bounded action ID, and preserves source decoration', () => {
    const events: UiverseRuntimeEvent[] = []
    const instance = mountUiverseRuntime({
      component: component(), host: host(),
      values: { mode: 'interactive', text: { 'fragment/button[0]/span[0]#text[0]': 'Save report' }, actions: { 'fragment/button[0]': { actionId: 'save-report' } } },
      onEvent: event => events.push(event),
    })
    const button = instance.shadowRoot.querySelector('button')!
    expect(instance.shadowRoot.querySelector('span')?.textContent).toBe('Save report')
    expect(button.querySelector('svg path')).not.toBeNull()
    expect(instance.shadowRoot.querySelector('script')).toBeNull()
    const css = [...instance.shadowRoot.querySelectorAll('style')].map(style => style.textContent).join('\n')
    expect(css).not.toContain('https://assets.example.test')

    button.click()
    expect(events).toEqual([{ kind: 'action', componentId: 'fixture/component', targetId: 'fragment/button[0]', actionId: 'save-report' }])

    instance.update({ mode: 'interactive', text: { 'fragment/button[0]/span[0]#text[0]': 'Save draft' }, actions: { 'fragment/button[0]': { actionId: 'save-draft', disabled: true } } })
    expect(instance.shadowRoot.querySelector('span')?.textContent).toBe('Save draft')
    button.click()
    expect(events).toHaveLength(1)
    instance.dispose()
    expect(instance.shadowRoot.childNodes).toHaveLength(0)
    expect(() => instance.update({})).toThrow('UIVERSE_RUNTIME_DISPOSED')
  })

  test('binds native fields and toggles inside original source controls, then emits values without host execution', () => {
    const events: UiverseRuntimeEvent[] = []
    const source = '<div><input type="text" value="old"><input type="checkbox"><button type="submit">Submit</button></div>'
    const instance = mountUiverseRuntime({
      host: host(), onEvent: event => events.push(event),
      component: component({
        id: 'fixture/form', category: 'Forms', source,
        capabilities: ['field', 'toggle', 'action', 'decoration'],
        inputSchema: { requiredReadOnly: ['fragment/div[0]/button[0]#text[0]', 'fragment/div[0]/input[0]', 'fragment/div[0]/input[1]'], requiredInteractive: ['fragment/div[0]/button[0]#text[0]', 'fragment/div[0]/input[0]', 'fragment/div[0]/input[1]', 'fragment/div[0]/button[0]'], textIds: ['fragment/div[0]/button[0]#text[0]'], fieldIds: ['fragment/div[0]/input[0]', 'fragment/div[0]/input[1]'], actionIds: ['fragment/div[0]/button[0]'], imageIds: [] },
        targets: [
          { id: 'fragment/div[0]/input[0]', path: 'fragment/div[0]/input[0]', tag: 'input', kind: 'value', fieldConstraint: { element: 'input', inputType: 'text' } },
          { id: 'fragment/div[0]/input[1]', path: 'fragment/div[0]/input[1]', tag: 'input', kind: 'checked' },
          { id: 'fragment/div[0]/button[0]#text[0]', path: 'fragment/div[0]/button[0]', tag: 'button', kind: 'text', textIndex: 0, semanticRole: 'label' },
          { id: 'fragment/div[0]/button[0]', path: 'fragment/div[0]/button[0]', tag: 'button', kind: 'action' },
        ],
      }),
      values: {
        mode: 'interactive', text: { 'fragment/div[0]/button[0]#text[0]': 'Send real record' },
        fields: {
          'fragment/div[0]/input[0]': { value: 'from-source-data' },
          'fragment/div[0]/input[1]': { checked: true },
        },
        actions: { 'fragment/div[0]/button[0]': { actionId: 'submit-form' } },
      },
    })
    const [text, toggle] = [...instance.shadowRoot.querySelectorAll('input')] as HTMLInputElement[]
    expect(text?.value).toBe('from-source-data')
    expect(toggle?.checked).toBe(true)
    text!.value = 'human-change'; text!.dispatchEvent(new Event('input', { bubbles: true }))
    toggle!.checked = false; toggle!.dispatchEvent(new Event('change', { bubbles: true }))
    ;(instance.shadowRoot.querySelector('button') as HTMLButtonElement).click()
    expect(events).toEqual([
      { kind: 'field', componentId: 'fixture/form', targetId: 'fragment/div[0]/input[0]', fieldId: 'fragment/div[0]/input[0]', value: 'human-change' },
      { kind: 'toggle', componentId: 'fixture/form', targetId: 'fragment/div[0]/input[1]', fieldId: 'fragment/div[0]/input[1]', checked: false },
      { kind: 'action', componentId: 'fixture/form', targetId: 'fragment/div[0]/button[0]', actionId: 'submit-form' },
    ])
  })

  test('rejects unreflectable select/date/range values before attach and binds frozen option values after label replacement', () => {
    const source = '<select><option>Author allowed</option><option>Source other</option></select><input type="date" value="2024-01-01"><input type="range" min="0" max="10" step="2" value="4"><input type="number" value="7">'
    const item = { id: 'Forms/typed-field-values', title: 'Typed field values', category: 'Forms', author: 'fixture', tags: [], sourceUrl: 'https://uiverse.io/fixture/typed-field-values', sha256: createHash('sha256').update(source).digest('hex'), framework: 'css' as const, warnings: [] }
    const catalog: Catalog = { formatVersion: 1, commit: '0'.repeat(40), snapshotDate: 'fixture', total: 1, categories: { Forms: 1 }, items: [item] }
    const runtime = createUiverseRuntimeRegistry(catalog, { html: { [item.id]: source } }).components[0]!
    const select = runtime.targets.find(target => target.kind === 'value' && target.tag === 'select')!
    const date = runtime.targets.find(target => target.kind === 'value' && target.fieldConstraint?.inputType === 'date')!
    const range = runtime.targets.find(target => target.kind === 'value' && target.fieldConstraint?.inputType === 'range')!
    const number = runtime.targets.find(target => target.kind === 'value' && target.fieldConstraint?.inputType === 'number')!
    expect(select.fieldConstraint).toEqual({ element: 'select', options: ['Author allowed', 'Source other'] })
    expect(range.fieldConstraint).toMatchObject({ element: 'input', inputType: 'range', min: '0', max: '10', step: '2' })
    expect(validateUiverseRuntimeFieldValue(date, '0001-02-28')).toBeUndefined()

    const values = (overrides: Partial<Record<string, string>> = {}) => ({
      mode: 'read-only' as const,
      text: Object.fromEntries(runtime.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map((target, index) => [target.id, `Bound option ${String(index + 1)}`])),
      fields: {
        [select.id]: { value: overrides[select.id] ?? 'Source other' },
        [date.id]: { value: overrides[date.id] ?? '2024-02-29' },
        [range.id]: { value: overrides[range.id] ?? '6' },
        // Empty number drafts display exactly as empty; they are not failed
        // submissions and must not revert to source value="7".
        [number.id]: { value: overrides[number.id] ?? '' },
      },
    })

    const instance = mountUiverseRuntime({ component: runtime, host: host(), values: values() })
    const elements = [...instance.shadowRoot.querySelectorAll('select,input')] as Array<HTMLSelectElement | HTMLInputElement>
    expect((elements[0] as HTMLSelectElement).value).toBe('Source other')
    expect((elements[1] as HTMLInputElement).value).toBe('2024-02-29')
    expect((elements[2] as HTMLInputElement).value).toBe('6')
    expect((elements[3] as HTMLInputElement).value).toBe('')
    expect(instance.shadowRoot.textContent).not.toContain('Author allowed')
    expect(instance.shadowRoot.textContent).not.toContain('Source other')

    const unknownSelect = host()
    expect(() => mountUiverseRuntime({ component: runtime, host: unknownSelect, values: values({ [select.id]: 'not-an-option' }) })).toThrow(`UIVERSE_RUNTIME_FIELD_VALUE_INVALID:${select.id}:select-option-unknown`)
    expect(unknownSelect.shadowRoot).toBeNull()

    const invalidDate = host()
    expect(() => mountUiverseRuntime({ component: runtime, host: invalidDate, values: values({ [date.id]: '2024-02-30' }) })).toThrow(`UIVERSE_RUNTIME_FIELD_VALUE_INVALID:${date.id}:date-invalid`)
    expect(invalidDate.shadowRoot).toBeNull()

    const clampedRange = host()
    expect(() => mountUiverseRuntime({ component: runtime, host: clampedRange, values: values({ [range.id]: '12' }) })).toThrow(`UIVERSE_RUNTIME_FIELD_VALUE_INVALID:${range.id}:above-max`)
    // The author default value="4" was never attached as a fallback.
    expect(clampedRange.shadowRoot).toBeNull()
  })

  test('binds card content inside a real source text slot and rejects unknown bindings', () => {
    const instance = mountUiverseRuntime({
      host: host(), component: component({
        id: 'fixture/card', category: 'Cards', source: '<article><div class="source-copy">Original text</div><i aria-hidden="true"></i></article>',
        capabilities: ['content', 'decoration'], availability: 'interactive',
        inputSchema: { requiredReadOnly: ['fragment/article[0]/div[0]#text[0]'], requiredInteractive: ['fragment/article[0]/div[0]#text[0]'], textIds: ['fragment/article[0]/div[0]#text[0]'], fieldIds: [], actionIds: [], imageIds: [] },
        targets: [{ id: 'fragment/article[0]/div[0]#text[0]', path: 'fragment/article[0]/div[0]', tag: 'div', kind: 'text', textIndex: 0, semanticRole: 'content' }],
      }), values: { mode: 'read-only', text: { 'fragment/article[0]/div[0]#text[0]': 'Bound document content' } },
    })
    expect(instance.shadowRoot.querySelector('.source-copy')?.textContent).toBe('Bound document content')
    expect(instance.shadowRoot.querySelector('article i')).not.toBeNull()
    expect(() => instance.update({ mode: 'read-only', fields: { 'missing-target': { value: 'nope' } } })).toThrow('UIVERSE_RUNTIME_INPUT_INVALID:field-target')
  })

  test('does not insert an author product name or price until all source slots are real-bound', () => {
    const price = component({
      id: 'fixture/price', category: 'Cards', source: '<article><h2>Creator Pro</h2><strong>$99/month</strong><button>Buy now</button></article>',
      capabilities: ['content', 'action', 'decoration'],
      inputSchema: { requiredReadOnly: ['fragment/article[0]/h2[0]#text[0]', 'fragment/article[0]/strong[0]#text[0]', 'fragment/article[0]/button[0]#text[0]'], requiredInteractive: ['fragment/article[0]/h2[0]#text[0]', 'fragment/article[0]/strong[0]#text[0]', 'fragment/article[0]/button[0]#text[0]', 'fragment/article[0]/button[0]'], textIds: ['fragment/article[0]/h2[0]#text[0]', 'fragment/article[0]/strong[0]#text[0]', 'fragment/article[0]/button[0]#text[0]'], fieldIds: [], actionIds: ['fragment/article[0]/button[0]'], imageIds: [] },
      targets: [
        { id: 'fragment/article[0]/h2[0]#text[0]', path: 'fragment/article[0]/h2[0]', tag: 'h2', kind: 'text', textIndex: 0, semanticRole: 'content' },
        { id: 'fragment/article[0]/strong[0]#text[0]', path: 'fragment/article[0]/strong[0]', tag: 'strong', kind: 'text', textIndex: 0, semanticRole: 'content' },
        { id: 'fragment/article[0]/button[0]#text[0]', path: 'fragment/article[0]/button[0]', tag: 'button', kind: 'text', textIndex: 0, semanticRole: 'label' },
        { id: 'fragment/article[0]/button[0]', path: 'fragment/article[0]/button[0]', tag: 'button', kind: 'action' },
      ],
    })
    const emptyHost = host()
    expect(() => mountUiverseRuntime({ component: price, host: emptyHost, values: { mode: 'interactive' } })).toThrow('UIVERSE_RUNTIME_BINDINGS_INCOMPLETE')
    // Validation precedes Shadow DOM insertion, so the author demo never even
    // briefly appears while a candidate is rejected.
    expect(emptyHost.shadowRoot).toBeNull()

    const instance = mountUiverseRuntime({ component: price, host: host(), values: {
      mode: 'interactive',
      text: {
        'fragment/article[0]/h2[0]#text[0]': '研究计划',
        'fragment/article[0]/strong[0]#text[0]': '预算待批准',
        'fragment/article[0]/button[0]#text[0]': '查看依据',
      },
      actions: { 'fragment/article[0]/button[0]': { actionId: 'open-evidence' } },
    } })
    const rendered = instance.shadowRoot.textContent ?? ''
    expect(rendered).toContain('研究计划')
    expect(rendered).toContain('预算待批准')
    expect(rendered).not.toContain('Creator Pro')
    expect(rendered).not.toContain('$99/month')
  })

  test('clears an author image alt when the bounded source value omits one', () => {
    const imageId = 'fragment/figure[0]/img[0]@image'
    const instance = mountUiverseRuntime({
      host: host(),
      component: component({
        id: 'fixture/image-alt', category: 'Cards',
        source: '<figure><img src="data:image/png;base64,iVBORw0KGgo=" alt="Author premium product illustration"></figure>',
        capabilities: ['content', 'decoration'],
        inputSchema: { requiredReadOnly: [imageId], requiredInteractive: [imageId], textIds: [], fieldIds: [], actionIds: [], imageIds: [imageId] },
        targets: [{ id: imageId, path: 'fragment/figure[0]/img[0]', tag: 'img', kind: 'image' }],
      }),
      values: { mode: 'read-only', images: { [imageId]: { src: 'data:image/png;base64,iVBORw0KGgo=' } } },
    })
    const image = instance.shadowRoot.querySelector('img') as HTMLImageElement
    expect(image.alt).toBe('')
    expect(image.getAttribute('alt')).toBe('')
    expect(instance.shadowRoot.textContent).not.toContain('Author premium product illustration')
  })

  test('requires and replaces fixed HTML title and ARIA source attributes', () => {
    const source = '<button title="Author tooltip" aria-label="Author action" aria-description="Author-only detail">Author visible label</button>'
    const item = { id: 'Buttons/html-semantic-attributes', title: 'HTML semantic attributes', category: 'Buttons', author: 'fixture', tags: [], sourceUrl: 'https://uiverse.io/fixture/html-semantic-attributes', sha256: createHash('sha256').update(source).digest('hex'), framework: 'css' as const, warnings: [] }
    const catalog: Catalog = { formatVersion: 1, commit: '0'.repeat(40), snapshotDate: 'fixture', total: 1, categories: { Buttons: 1 }, items: [item] }
    const runtime = createUiverseRuntimeRegistry(catalog, { html: { [item.id]: source } }).components[0]!
    const htmlAttributes = runtime.targets.filter(target => target.kind === 'attribute' && target.htmlAttribute)
    expect(htmlAttributes.map(target => target.htmlAttribute?.attribute).sort()).toEqual(['aria-description', 'aria-label', 'title'])
    expect(htmlAttributes.every(target => target.cssAttribute === undefined)).toBe(true)

    const boundText = Object.fromEntries(runtime.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map(target => [target.id,
      target.htmlAttribute?.attribute === 'title' ? 'Evidence tooltip' :
        target.htmlAttribute?.attribute === 'aria-label' ? 'Open evidence' :
          target.htmlAttribute?.attribute === 'aria-description' ? 'Open the cited evidence record' : 'Bound visible label',
    ]))
    const missingDescription = Object.fromEntries(Object.entries(boundText).filter(([id]) => id !== htmlAttributes.find(target => target.htmlAttribute?.attribute === 'aria-description')!.id))
    const missing = host()
    expect(() => mountUiverseRuntime({ component: runtime, host: missing, values: { mode: 'read-only', text: missingDescription } })).toThrow('UIVERSE_RUNTIME_BINDINGS_INCOMPLETE')
    expect(missing.shadowRoot).toBeNull()

    const instance = mountUiverseRuntime({ component: runtime, host: host(), values: { mode: 'read-only', text: boundText } })
    const button = instance.shadowRoot.querySelector('button')!
    expect(button.getAttribute('title')).toBe('Evidence tooltip')
    expect(button.getAttribute('aria-label')).toBe('Open evidence')
    expect(button.getAttribute('aria-description')).toBe('Open the cited evidence record')
    expect(button.outerHTML).not.toContain('Author tooltip')
    expect(button.outerHTML).not.toContain('Author action')
    expect(button.outerHTML).not.toContain('Author-only detail')
    expect(button.textContent).toBe('Bound visible label')
  })

  test('rejects an attribute descriptor outside the fixed title and ARIA allowlist before attach', () => {
    const attributeId = 'fragment/div[0]@html-attribute[data-author]'
    const unsafe = component({
      id: 'fixture/unsafe-html-attribute', category: 'Cards', source: '<div data-author="Creator name"></div>',
      capabilities: ['content', 'decoration'],
      inputSchema: { requiredReadOnly: [attributeId], requiredInteractive: [attributeId], textIds: [attributeId], fieldIds: [], actionIds: [], imageIds: [] },
      targets: [{ id: attributeId, path: 'fragment/div[0]', tag: 'div', kind: 'attribute', htmlAttribute: { attribute: 'data-author' as never } }],
    })
    const emptyHost = host()
    expect(() => mountUiverseRuntime({ component: unsafe, host: emptyHost, values: { mode: 'read-only', text: { [attributeId]: 'not allowed' } } })).toThrow('UIVERSE_RUNTIME_HTML_ATTRIBUTE_UNSUPPORTED')
    expect(emptyHost.shadowRoot).toBeNull()
  })

  test('requires and replaces SVG text plus fixed CSS content and attr() source slots', () => {
    const source = '<button class="offer" data-label="author data">Author button</button><svg><text>42</text></svg><style>.offer::before{content:"for free"}.offer::after{content:attr(data-label)}</style>'
    const item = { id: 'Buttons/css-svg', title: 'CSS/SVG', category: 'Buttons', author: 'fixture', tags: [], sourceUrl: 'https://uiverse.io/fixture/css-svg', sha256: createHash('sha256').update(source).digest('hex'), framework: 'css' as const, warnings: [] }
    const catalog: Catalog = { formatVersion: 1, commit: '0'.repeat(40), snapshotDate: 'fixture', total: 1, categories: { Buttons: 1 }, items: [item] }
    const component = createUiverseRuntimeRegistry(catalog, { html: { [item.id]: source } }).components[0]!
    const css = component.targets.find(target => target.kind === 'css-content')!
    const attribute = component.targets.find(target => target.kind === 'attribute')!
    const svg = component.targets.find(target => target.kind === 'text' && /\/svg\[/u.test(target.path))!
    expect(css.cssContent?.expected).toBe('"for free"')
    expect(attribute.cssAttribute).toEqual({ selector: '.offer', attribute: 'data-label' })
    expect(svg).toBeTruthy()

    const missing = host()
    expect(() => mountUiverseRuntime({ component, host: missing, values: { mode: 'read-only', text: { [css.id]: 'actual offer' } } })).toThrow('UIVERSE_RUNTIME_BINDINGS_INCOMPLETE')
    expect(missing.shadowRoot).toBeNull()

    const text = Object.fromEntries(component.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map(target => [target.id, target.id === css.id ? 'actual offer' : target.id === attribute.id ? 'actual attribute' : target.id === svg.id ? '84' : 'actual button']))
    const instance = mountUiverseRuntime({ component, host: host(), values: { mode: 'read-only', text } })
    const style = instance.shadowRoot.querySelector('[data-uiverse-runtime-component] style')?.textContent ?? ''
    expect(style).toContain('"actual offer"')
    expect(style).not.toContain('for free')
    expect(instance.shadowRoot.querySelector('.offer')?.getAttribute('data-label')).toBe('actual attribute')
    expect(instance.shadowRoot.querySelector('svg text')?.textContent).toBe('84')
    expect(instance.shadowRoot.textContent).not.toContain('Author button')
    expect(instance.shadowRoot.textContent).not.toContain('42')
  })

  test('rebases fixed CSS content on repeated updates, preserves a field-only update, and rejects outside style tampering', () => {
    const source = '<div class="offer"><input value="Author value"><button>Author action</button></div><style>.offer::before{content:"for free"}.offer::after{content:"GLITCH"}</style>'
    const item = { id: 'Buttons/css-repeated-update', title: 'CSS repeated update', category: 'Buttons', author: 'fixture', tags: [], sourceUrl: 'https://uiverse.io/fixture/css-repeated-update', sha256: createHash('sha256').update(source).digest('hex'), framework: 'css' as const, warnings: [] }
    const catalog: Catalog = { formatVersion: 1, commit: '0'.repeat(40), snapshotDate: 'fixture', total: 1, categories: { Buttons: 1 }, items: [item] }
    const runtime = createUiverseRuntimeRegistry(catalog, { html: { [item.id]: source } }).components[0]!
    const css = runtime.targets.filter(target => target.kind === 'css-content')
    const field = runtime.targets.find(target => target.kind === 'value')!
    expect(css.map(target => target.cssContent?.expected).sort()).toEqual(['"GLITCH"', '"for free"'])

    const values = (offer: string, glitch: string, fieldValue: string) => ({
      mode: 'read-only' as const,
      text: Object.fromEntries(runtime.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map(target => [target.id,
        target.kind === 'css-content' && target.cssContent?.expected === '"for free"' ? offer :
          target.kind === 'css-content' && target.cssContent?.expected === '"GLITCH"' ? glitch : 'Bound action',
      ])),
      fields: { [field.id]: { value: fieldValue } },
    })
    const instance = mountUiverseRuntime({ component: runtime, host: host(), values: values('First offer', 'FIRST', 'Field A') })
    const style = instance.shadowRoot.querySelector('[data-uiverse-runtime-component] style')!
    instance.update(values('Second offer', 'SECOND', 'Field B'))
    instance.update(values('Third offer', 'THIRD', 'Field C'))
    expect(style.textContent).toContain('"Third offer"')
    expect(style.textContent).toContain('"THIRD"')
    expect(style.textContent).not.toContain('"for free"')
    expect(style.textContent).not.toContain('"GLITCH"')
    expect((instance.shadowRoot.querySelector('input') as HTMLInputElement).value).toBe('Field C')

    const ownedCss = style.textContent
    instance.update(values('Third offer', 'THIRD', 'Field only update'))
    expect(style.textContent).toBe(ownedCss)
    expect((instance.shadowRoot.querySelector('input') as HTMLInputElement).value).toBe('Field only update')

    style.textContent = '.offer::before{content:"outside mutation"}'
    expect(() => instance.update(values('Fourth offer', 'FOURTH', 'Should not apply'))).toThrow('UIVERSE_RUNTIME_CSS_SOURCE_MISMATCH')
    expect((instance.shadowRoot.querySelector('input') as HTMLInputElement).value).toBe('Field only update')
  })

  test('opens a native source content slot for Host-owned Markdown DOM', () => {
    const targetId = 'fragment/article[0]/div[0]#text[0]'
    const outer = host()
    const instance = mountUiverseRuntime({
      host: outer,
      component: component({
        id: 'fixture/projected-card', category: 'Cards', source: '<article><div class="source-copy">Author placeholder</div><i aria-hidden="true"></i></article>',
        capabilities: ['content', 'decoration'], availability: 'interactive',
        inputSchema: { requiredReadOnly: [targetId], requiredInteractive: [targetId], textIds: [targetId], fieldIds: [], actionIds: [], imageIds: [] },
        targets: [{ id: targetId, path: 'fragment/article[0]/div[0]', tag: 'div', kind: 'text', textIndex: 0, semanticRole: 'content' }],
      }),
      values: { mode: 'read-only' }, contentProjection: { targetId },
    })
    expect(instance.contentSlotName).toMatch(/^uiverse-content-/)
    expect(instance.contentProjectionTargetId).toBe(targetId)
    const slot = instance.shadowRoot.querySelector(`slot[name="${instance.contentSlotName}"]`) as HTMLSlotElement | null
    expect(slot?.getAttribute('data-uiverse-content-projection')).toBe(targetId)
    expect(instance.shadowRoot.textContent).not.toContain('Author placeholder')
    const projected = document.createElement('section')
    projected.slot = instance.contentSlotName!
    const code = document.createElement('code'); code.textContent = 'host-owned-code'
    projected.append(code); outer.append(projected)
    expect(projected.parentElement).toBe(outer)
    expect(slot?.assignedNodes()).toContain(projected)
    instance.dispose()
    expect(instance.shadowRoot.childNodes).toHaveLength(0)
  })

  test('does not bind source with unavailable runtime contract', () => {
    expect(() => mountUiverseRuntime({ host: host(), component: component({ availability: 'blocked', selectableWhenBound: false, source: undefined }) })).toThrow('UIVERSE_RUNTIME_COMPONENT_UNAVAILABLE')
  })

  test('mounts every exact pinned source in a network-free Shadow DOM boundary', async () => {
    const catalog = JSON.parse(await readFile(join(process.cwd(), 'resources/uiverse/catalog.json'), 'utf8')) as Catalog
    const archive = JSON.parse(gunzipSync(await readFile(join(process.cwd(), 'resources/uiverse/sources.json.gz'))).toString('utf8')) as { sources: Record<string, string> }
    const registry = createUiverseRuntimeRegistry(catalog, { html: archive.sources })
    let mountedCount = 0
    for (const original of registry.components) {
      // The full Tailwind sheet is checked separately in a real browser. This
      // loop proves every individual source can enter and leave the isolated
      // runtime without allowing scripts or remote element URLs.
      const fixture = { ...original, sharedCss: undefined }
      const item = host()
      const instance = mountUiverseRuntime({ component: fixture, host: item, values: completeValues(fixture) })
      const shell = instance.shadowRoot.querySelector('[data-uiverse-runtime-component]')
      expect(shell?.getAttribute('data-uiverse-runtime-component')).toBe(original.id)
      expect(instance.shadowRoot.querySelector('script,iframe,object,embed,base,meta,link')).toBeNull()
      instance.dispose()
      item.remove()
      mounted.splice(mounted.indexOf(item), 1)
      mountedCount++
    }
    expect(mountedCount).toBe(3802)
  // This full 3,802-source integration loop took 16.58s under the complete
  // suite; keep every mount/assertion and bound only this archive test at 30s.
  }, 30000)
})
