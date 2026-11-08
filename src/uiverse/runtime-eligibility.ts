import type {
  UiverseRuntimeComponent,
  UiverseRuntimeEligibility,
  UiverseRuntimeSelectionValues,
} from './runtime-registry.js'
import { validateUiverseRuntimeFieldValue } from './runtime-field-constraints.js'

function hasString(record: unknown, id: string): boolean {
  return !!record && typeof record === 'object' && !Array.isArray(record) && typeof (record as Record<string, unknown>)[id] === 'string'
}
function hasField(record: unknown, id: string, kind: 'value' | 'checked' | 'file'): boolean {
  const value = record && typeof record === 'object' && !Array.isArray(record) ? (record as Record<string, unknown>)[id] : undefined
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[kind] === (kind === 'value' ? 'string' : 'boolean')
}
function fieldValue(record: unknown, id: string): string | undefined {
  const value = record && typeof record === 'object' && !Array.isArray(record) ? (record as Record<string, unknown>)[id] : undefined
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).value === 'string'
    ? (value as Record<string, string>).value
    : undefined
}
function hasImage(record: unknown, id: string): boolean {
  const value = record && typeof record === 'object' && !Array.isArray(record) ? (record as Record<string, unknown>)[id] : undefined
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).src === 'string'
}
function hasAction(record: unknown, id: string): boolean {
  const value = record && typeof record === 'object' && !Array.isArray(record) ? (record as Record<string, unknown>)[id] : undefined
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).actionId === 'string'
}

/**
 * Pure browser/server gate. No raw source, parser, filesystem, or Node module
 * enters this path; both the archive registry and the Shadow DOM renderer use
 * the same decision before a component can mount.
 */
export function evaluateUiverseRuntimeEligibility(component: UiverseRuntimeComponent, values: UiverseRuntimeSelectionValues = {}): UiverseRuntimeEligibility {
  const mode = values.mode ?? (component.inputSchema.actionIds.length ? 'interactive' : 'read-only')
  const missing: string[] = [], reasons: string[] = []
  if (!component.selectableWhenBound || component.availability === 'blocked') reasons.push('component-unavailable')
  if (mode === 'interactive' && component.availability !== 'interactive') reasons.push('interactive-source-capability-unavailable')
  for (const target of component.targets) {
    if (target.kind === 'text' && target.semanticRole === 'content' && values.projectedTextIds?.includes(target.id)) continue
    if ((target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute') && !hasString(values.text, target.id)) missing.push(target.id)
    else if (target.kind === 'value') {
      const value = fieldValue(values.fields, target.id)
      if (value === undefined) missing.push(target.id)
      else {
        const issue = validateUiverseRuntimeFieldValue(target, value)
        if (issue) reasons.push(`field-value-invalid:${target.id}:${issue}`)
      }
    }
    else if (target.kind === 'checked' && !hasField(values.fields, target.id, 'checked')) missing.push(target.id)
    else if (target.kind === 'file' && !hasField(values.fields, target.id, 'file')) missing.push(target.id)
    else if (target.kind === 'image' && !hasImage(values.images, target.id)) missing.push(target.id)
    else if (target.kind === 'action' && mode === 'interactive' && !hasAction(values.actions, target.id)) missing.push(target.id)
  }
  return { eligible: reasons.length === 0 && missing.length === 0, mode, missing, reasons }
}
