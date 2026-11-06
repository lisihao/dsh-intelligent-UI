import { parseUiverseRuntimeMount, UIVERSE_SHADOW_RENDERER_KEY, type UiverseRuntimeMount } from './runtime-contract.js'
import {
  evaluateUiverseRuntimeEligibility,
  uiverseRuntimeQualifiedId,
  type UiverseRuntimeComponent,
  type UiverseRuntimeRegistry,
  type UiverseRuntimeSelectionValues,
} from './runtime-registry.js'
import type { ExecutableComponentBinding, ExecutableComponentContext, ExecutableComponentRegistry, ExecutableJson } from '../adaptive-ui/executable-registry.js'

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function family(category: string): string { return `uiverse-${category.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'visual'}` }
function sourceValue(source: unknown): unknown { return record(source) && 'value' in source ? source.value : undefined }
function sourceFlags(component: UiverseRuntimeComponent): string {
  const traits = component.visualCharacteristics.declared
  const labels = [
    traits.shadows && 'shadow', traits.rounded && 'rounded', traits.borders && 'border', traits.gradients && 'gradient',
    traits.transparency && 'transparency', traits.blur && 'blur', traits.transform3d && '3d transform', traits.motion && 'motion',
    traits.keyframes && 'keyframes', ...traits.layouts,
  ].filter((value): value is string => typeof value === 'string')
  return labels.length ? labels.join(', ') : 'source structure'
}
function suitability(component: UiverseRuntimeComponent): string {
  const schema = component.inputSchema
  const needs = [schema.textIds.length && `${String(schema.textIds.length)} text slot(s)`, schema.fieldIds.length && `${String(schema.fieldIds.length)} field(s)`, schema.imageIds.length && `${String(schema.imageIds.length)} image slot(s)`, schema.actionIds.length && `${String(schema.actionIds.length)} host action(s)`].filter(Boolean).join(', ')
  return `${component.category}; source-declared ${sourceFlags(component)}; requires ${needs || 'no semantic data'} before mount.`
}
function explicitBinding(component: UiverseRuntimeComponent, value: unknown): UiverseRuntimeSelectionValues | undefined {
  if (!record(value) || value.type !== 'uiverse-content' || !record(value.bindings)) return undefined
  const raw = value.bindings[component.id]
  if (raw === undefined) return undefined
  return parseUiverseRuntimeMount({ componentId: component.id, values: raw }).values
}
/** Only one complete content slot can receive automatic trusted Markdown projection. */
function automaticMarkdownBinding(component: UiverseRuntimeComponent, value: unknown): UiverseRuntimeSelectionValues | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const content = component.targets.filter(target => target.kind === 'text' && target.semanticRole === 'content')
  if (content.length !== 1 || component.targets.length !== 1) return undefined
  return { mode: 'read-only', projectedTextIds: [content[0]!.id] }
}
function actions(values: UiverseRuntimeSelectionValues): readonly string[] {
  if (values.mode === 'read-only') return []
  return Object.values(values.actions ?? {}).map(action => action.actionId).sort((left, right) => left.localeCompare(right))
}
function excluded(reasons: readonly string[]): ExecutableComponentBinding { return { eligible: false, reasons: [...new Set(reasons)].slice(0, 16) } }
function binding(component: UiverseRuntimeComponent, context: ExecutableComponentContext): ExecutableComponentBinding {
  const value = sourceValue(context.source)
  let values: UiverseRuntimeSelectionValues | undefined
  let provenance = 'UIVERSE_SOURCE_BINDING_MISSING'
  try {
    values = explicitBinding(component, value)
    if (values) provenance = 'UIVERSE_SOURCE_BOUND_EXPLICIT'
    else {
      values = automaticMarkdownBinding(component, value)
      if (values) provenance = 'UIVERSE_MARKDOWN_NATIVE_SLOT'
    }
  } catch (error) {
    return excluded(['UIVERSE_EXPLICIT_BINDING_INVALID', error instanceof Error ? error.message.slice(0, 240) : 'invalid'])
  }
  if (!values) return excluded([provenance])
  const eligibility = evaluateUiverseRuntimeEligibility(component, values)
  if (!eligibility.eligible) return excluded(['UIVERSE_BINDING_INCOMPLETE', ...eligibility.reasons, ...eligibility.missing.map(id => `missing:${id}`)])
  const input: UiverseRuntimeMount = { componentId: component.id, values }
  return { eligible: true, input, reasons: [provenance, `visual:${sourceFlags(component)}`, ...component.notes], actionIds: actions(values) }
}

/**
 * Registers opaque `uiverse:<originalId>` entries. The original archive ID is
 * retained inside every renderer input so dispatch can retrieve exactly the
 * fixed source record and no local fallback style can be substituted.
 */
export function registerUiverseRuntimeComponents(registry: ExecutableComponentRegistry, archiveRegistry: UiverseRuntimeRegistry): () => void {
  const components = archiveRegistry.components.filter(component => component.selectableWhenBound)
  const duplicates = components.map(component => uiverseRuntimeQualifiedId(component.id)).filter(id => registry.get(id))
  if (duplicates.length) throw new Error(`UIVERSE_RUNTIME_EXECUTABLE_DUPLICATE:${duplicates.join(',')}`)
  const dispose: Array<() => void> = []
  try {
    for (const component of components) {
      const id = uiverseRuntimeQualifiedId(component.id)
      dispose.push(registry.register({
        id,
        family: family(component.category),
        title: `${component.category} · ${component.title}`,
        suitability: suitability(component),
        rendererKey: UIVERSE_SHADOW_RENDERER_KEY,
        inputSchema: { parse(value: unknown): ExecutableJson {
          const parsed = parseUiverseRuntimeMount(value)
          if (parsed.componentId !== component.id) throw new Error('UIVERSE_EXECUTABLE_COMPONENT_ID_MISMATCH')
          return parsed as unknown as ExecutableJson
        } },
        bind: context => binding(component, context),
      }))
    }
  } catch (error) {
    for (const release of dispose.reverse()) release()
    throw error
  }
  return () => { for (const release of dispose.splice(0).reverse()) release() }
}

export type { UiverseRuntimeMount }
