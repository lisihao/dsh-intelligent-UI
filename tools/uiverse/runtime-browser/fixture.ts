import { mountUiverseRuntime } from '../../../src/uiverse/runtime-renderer.js'
import type { UiverseRuntimeComponent, UiverseRuntimeFieldValue } from '../../../src/uiverse/runtime-registry.js'
import { uiverseRuntimeFixtureFieldValue } from '../../../src/uiverse/runtime-field-constraints.js'

declare const UIVERSE_RUNTIME_COMPONENTS: readonly (UiverseRuntimeComponent & { readonly needsSharedCss: boolean })[]
declare const UIVERSE_RUNTIME_SHARED_CSS: string
declare const UIVERSE_RUNTIME_KEEP_MOUNTED: boolean
const cssUpdateControlId = 'Buttons/JkHuger_brown-lion-61'

type Result = {
  readonly expected: number
  mounted: number
  readonly viewportWidth: number
  readonly failures: Array<{ readonly id: string, readonly message: string }>
  readonly escapedHosts: string[]
  readonly forbiddenNodes: string[]
  styledRepresentative: { readonly id: string, readonly mounted: boolean, readonly escaped: boolean } | undefined
  readonly focused: boolean
  readonly details: Array<{
    readonly id: string
    readonly bounds: { readonly width: number, readonly height: number, readonly left: number, readonly right: number }
    readonly visibleBoundText: readonly string[]
    readonly svgText: readonly string[]
    readonly inputValues: readonly string[]
    readonly cssBindings: readonly { readonly id: string, readonly applied: boolean }[]
    readonly htmlAttributeBindings: readonly { readonly id: string, readonly attribute: string, readonly applied: boolean, readonly sourceValueReplaced: boolean }[]
    readonly dynamicCssUpdateCount: number
    readonly dynamicFieldUpdate: boolean
    readonly fieldUpdateBindings: readonly { readonly id: string, readonly applied: boolean }[]
  }>
}

async function nextFrame(): Promise<void> { await new Promise(resolve => requestAnimationFrame(() => resolve())) }

function completeFixtureValues(component: UiverseRuntimeComponent) {
  const mode = component.availability === 'interactive' ? 'interactive' as const : 'read-only' as const
  const textValue = (target: UiverseRuntimeComponent['targets'][number], index: number): string => {
    if (component.id === 'Buttons/Custyyyy_silent-sheep-31' && target.kind === 'css-content') return 'Included with verified plan'
    if (component.id === 'Buttons/212004ALJI_fat-eagle-24' && target.kind === 'css-content') return 'VERIFIED'
    if (target.htmlAttribute) return `__uiverse_bound_semantic_${String(index + 1)}__`
    if (target.kind === 'attribute') return `Verified ${component.category} attribute`
    if (target.kind === 'css-content') return `Verified ${component.category} CSS ${String(index + 1)}`
    if (/\/svg\[/u.test(target.path)) return `SVG ${String(index + 1)}`
    return `Verified ${component.category} ${String(index + 1)}`
  }
  return {
    mode,
    text: Object.fromEntries(component.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map((target, index) => [target.id, textValue(target, index)])),
    fields: Object.fromEntries(component.targets.filter(target => target.kind === 'value' || target.kind === 'checked' || target.kind === 'file').map(target => {
      if (target.kind === 'value') {
        const value = uiverseRuntimeFixtureFieldValue(target)
        if (value === undefined) throw new Error(`UIVERSE_RUNTIME_BROWSER_FIXTURE_FIELD_VALUE_UNAVAILABLE:${target.id}`)
        return [target.id, { value }]
      }
      return [target.id, target.kind === 'checked' ? { checked: false } : { file: true }]
    })),
    actions: mode === 'interactive' ? Object.fromEntries(component.targets.filter(target => target.kind === 'action').map((target, index) => [target.id, { actionId: `browser-action-${String(index)}` }])) : {},
    images: Object.fromEntries(component.targets.filter(target => target.kind === 'image').map(target => [target.id, { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'browser bound image' }])),
  }
}
type FixtureValues = ReturnType<typeof completeFixtureValues>

/** One fixed control exercises two CSS updates plus a real field update in Chrome. */
function valuesAfterDynamicUpdate(component: UiverseRuntimeComponent, values: FixtureValues, revision: number): { readonly values: FixtureValues, readonly cssUpdated: boolean, readonly fieldUpdated: boolean } {
  if (component.id !== cssUpdateControlId) return { values, cssUpdated: false, fieldUpdated: false }
  const targets = component.targets.filter(target => target.kind === 'css-content')
  if (!targets.length) return { values, cssUpdated: false, fieldUpdated: false }
  const text = { ...values.text }
  for (const [index, target] of targets.entries()) text[target.id] = `Updated ${component.category} CSS ${String(revision)}.${String(index + 1)}`
  const fields: Record<string, UiverseRuntimeFieldValue> = { ...values.fields }
  let fieldUpdated = false
  for (const target of component.targets) {
    if (target.kind === 'value') { fields[target.id] = { ...(fields[target.id] ?? {}), value: `Updated ${component.category} field ${String(revision)}` }; fieldUpdated = true }
    else if (target.kind === 'checked') { fields[target.id] = { ...(fields[target.id] ?? {}), checked: true }; fieldUpdated = true }
  }
  return { values: { ...values, text, fields }, cssUpdated: true, fieldUpdated }
}

function renderedText(root: ShadowRoot): string {
  const output: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent?.closest('style,script')) continue
    const text = node.textContent?.replace(/\s+/gu, ' ').trim()
    if (text) output.push(text)
  }
  return output.join(' ')
}
function elementForTarget(root: ShadowRoot, target: UiverseRuntimeComponent['targets'][number]): Element | undefined {
  const shell = root.querySelector<HTMLElement>('[data-uiverse-runtime-component]')
  if (!shell) return undefined
  let parent: ParentNode = shell
  for (const segment of target.path.split('/').slice(1)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)\[(\d+)\]$/u.exec(segment)
    if (!match) return undefined
    const child = [...parent.children].filter(candidate => candidate.localName.toLowerCase() === match[1]!.toLowerCase())[Number(match[2])]
    if (!(child instanceof Element)) return undefined
    parent = child
  }
  return parent instanceof Element ? parent : undefined
}
function detail(component: UiverseRuntimeComponent, root: ShadowRoot, host: HTMLElement, values: FixtureValues, dynamicCssUpdateCount: number, dynamicFieldUpdate: boolean) {
  const rect = host.getBoundingClientRect(), visible = renderedText(root)
  const textValues = Object.values(values.text).filter(value => visible.includes(value)).slice(0, 32)
  const svgText = [...root.querySelectorAll('svg text,tspan')].map(element => element.textContent?.trim() ?? '').filter(Boolean).slice(0, 64)
  const inputValues = [...root.querySelectorAll('input,textarea,select')].map(element => element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio') ? `${element.type}:${String(element.checked)}` : (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value).slice(0, 32)
  const cssBindings = component.targets.filter(target => target.kind === 'css-content').map(target => ({ id: target.id, applied: (() => {
    const style = root.querySelector(`[data-uiverse-runtime-component] style`)
    const value = values.text[target.id]
    return typeof value === 'string' && (style?.textContent ?? '').includes(`"${value.replace(/["\\\u0000-\u001f\u007f]/gu, character => `\\${character.codePointAt(0)!.toString(16)} `)}"`)
  })() }))
  const htmlAttributeBindings = component.targets.filter(target => target.kind === 'attribute' && target.htmlAttribute !== undefined).map(target => {
    const binding = target.htmlAttribute!, value = values.text[target.id], element = elementForTarget(root, target)
    // These targets exist only for a nonempty pinned source attribute. The
    // unique fixture value must therefore replace—not preserve—that source
    // fact on the real source element.
    const applied = typeof value === 'string' && element?.getAttribute(binding.attribute) === value
    return { id: target.id, attribute: binding.attribute, applied, sourceValueReplaced: applied }
  })
  const fieldUpdateBindings = component.targets.filter(target => target.kind === 'value' || target.kind === 'checked').map(target => {
    const element = elementForTarget(root, target), field = values.fields[target.id]
    const applied = target.kind === 'checked'
      ? element instanceof HTMLInputElement && field?.checked === element.checked
      : (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && field?.value === element.value
    return { id: target.id, applied }
  })
  return { id: component.id, bounds: { width: rect.width, height: rect.height, left: rect.left, right: rect.right }, visibleBoundText: textValues, svgText, inputValues, cssBindings, htmlAttributeBindings, dynamicCssUpdateCount, dynamicFieldUpdate, fieldUpdateBindings }
}

async function run(): Promise<Result> {
  const fixture = document.querySelector<HTMLElement>('#fixture')!
  const result: Result = { expected: UIVERSE_RUNTIME_COMPONENTS.length, mounted: 0, viewportWidth: window.innerWidth, failures: [], escapedHosts: [], forbiddenNodes: [], styledRepresentative: undefined, focused: UIVERSE_RUNTIME_KEEP_MOUNTED, details: [] }
  const retained: Array<{ dispose(): void }> = []
  for (const component of UIVERSE_RUNTIME_COMPONENTS) {
    const host = document.createElement('article')
    host.className = 'uiverse-runtime-fixture'
    host.style.cssText = 'box-sizing:border-box;display:block;width:100%;max-width:100%;min-width:0;overflow:hidden;contain:layout paint;padding:12px;border:1px solid #d1d5db;border-radius:10px;background:#fff;'
    fixture.append(host)
    try {
      const renderable = component.needsSharedCss ? { ...component, sharedCss: UIVERSE_RUNTIME_SHARED_CSS } : component
      let values = completeFixtureValues(renderable)
      const instance = mountUiverseRuntime({ component: renderable, host, values })
      const firstUpdate = valuesAfterDynamicUpdate(renderable, values, 1)
      let dynamicCssUpdateCount = 0, dynamicFieldUpdate = false
      if (firstUpdate.cssUpdated) {
        instance.update(firstUpdate.values); values = firstUpdate.values; dynamicCssUpdateCount++
        const secondUpdate = valuesAfterDynamicUpdate(renderable, values, 2)
        instance.update(secondUpdate.values); values = secondUpdate.values; dynamicCssUpdateCount++
        dynamicFieldUpdate = firstUpdate.fieldUpdated && secondUpdate.fieldUpdated
      }
      await nextFrame()
      const rect = host.getBoundingClientRect()
      if (rect.left < -0.5 || rect.right > window.innerWidth + 0.5) result.escapedHosts.push(component.id)
      if (instance.shadowRoot.querySelector('script,iframe,object,embed,base,meta,link')) result.forbiddenNodes.push(component.id)
      if (UIVERSE_RUNTIME_KEEP_MOUNTED) result.details.push(detail(renderable, instance.shadowRoot, host, values, dynamicCssUpdateCount, dynamicFieldUpdate))
      if (UIVERSE_RUNTIME_KEEP_MOUNTED) retained.push(instance)
      else instance.dispose()
      result.mounted++
    } catch (error) {
      result.failures.push({ id: component.id, message: error instanceof Error ? error.message : String(error) })
    } finally { if (!UIVERSE_RUNTIME_KEEP_MOUNTED) host.remove() }
    if (result.mounted % 50 === 0) await new Promise(resolve => setTimeout(resolve, 0))
  }
  const representative = !UIVERSE_RUNTIME_KEEP_MOUNTED && UIVERSE_RUNTIME_COMPONENTS.find(component => component.needsSharedCss)
  if (representative) {
    const host = document.createElement('article')
    host.className = 'uiverse-runtime-fixture uiverse-runtime-fixture-styled'
    host.style.cssText = 'box-sizing:border-box;display:block;width:100%;max-width:100%;min-width:0;overflow:hidden;contain:layout paint;'
    fixture.append(host)
    try {
      const styled = { ...representative, sharedCss: UIVERSE_RUNTIME_SHARED_CSS }
      const instance = mountUiverseRuntime({ component: styled, host, values: completeFixtureValues(styled) })
      await nextFrame()
      const rect = host.getBoundingClientRect()
      result.styledRepresentative = { id: representative.id, mounted: true, escaped: rect.left < -0.5 || rect.right > window.innerWidth + 0.5 }
      instance.dispose()
    } catch {
      result.styledRepresentative = { id: representative.id, mounted: false, escaped: false }
    } finally { host.remove() }
  }
  if (UIVERSE_RUNTIME_KEEP_MOUNTED) {
    const styled = UIVERSE_RUNTIME_COMPONENTS.find(component => component.needsSharedCss)
    if (styled) {
      const mounted = result.details.find(item => item.id === styled.id)
      result.styledRepresentative = { id: styled.id, mounted: !!mounted, escaped: !!mounted && (mounted.bounds.left < -0.5 || mounted.bounds.right > window.innerWidth + 0.5) }
    }
  }
  return result
}

void run().then(result => { window.__uiverseRuntimeBrowserResult = result }).catch(error => {
  window.__uiverseRuntimeBrowserResult = { expected: UIVERSE_RUNTIME_COMPONENTS.length, mounted: 0, viewportWidth: window.innerWidth, failures: [{ id: 'fixture', message: error instanceof Error ? error.message : String(error) }], escapedHosts: [], forbiddenNodes: [], styledRepresentative: undefined, focused: UIVERSE_RUNTIME_KEEP_MOUNTED, details: [] }
})

declare global {
  interface Window { __uiverseRuntimeBrowserResult?: Result }
}
