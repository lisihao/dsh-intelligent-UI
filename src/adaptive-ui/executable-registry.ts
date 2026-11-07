/**
 * The executable component registry is intentionally narrower than a visual
 * catalog. A record enters this registry only when one exact renderer key and
 * one source-bound input contract are available. Discovery metadata therefore
 * cannot accidentally become a model-selectable component.
 */

export type ExecutableJson = null | boolean | number | string | readonly ExecutableJson[] | { readonly [key: string]: ExecutableJson }

export const MAX_EXECUTABLE_COMPONENT_INPUT_BYTES = 512 * 1024
export const MAX_EXECUTABLE_COMPONENT_INPUT_DEPTH = 64

export interface ExecutableComponentContext {
  /** Compiler-owned source or an adapter-owned source projection. It is never copied into options. */
  readonly source: unknown
  readonly capabilities: { readonly webgl: boolean, readonly reducedMotion: boolean }
  readonly isStreaming?: boolean
  /** Only action IDs the Host already owns may be surfaced by a component. */
  readonly hostActionIds?: readonly string[]
}

export interface ExecutableInputSchema<Input extends ExecutableJson = ExecutableJson> {
  parse(value: unknown): Input
}

export type ExecutableComponentBinding = {
  readonly eligible: true
  readonly input: unknown
  /** Source/capability facts that make this exact component legal for this block. */
  readonly reasons: readonly string[]
  /** UI event names are returned to the Host; this module never executes them. */
  readonly actionIds?: readonly string[]
} | {
  readonly eligible: false
  /** Named source, capability, or input-contract reasons. These stay auditable. */
  readonly reasons: readonly string[]
}

export interface ExecutableComponentDefinition<Input extends ExecutableJson = ExecutableJson> {
  readonly id: string
  readonly family: string
  readonly title: string
  /** A content-fit description supplied to Jev, without duplicating source text. */
  readonly suitability: string
  /** The consumer dispatches this exact key; it is not a display-only label. */
  readonly rendererKey: string
  readonly inputSchema: ExecutableInputSchema<Input>
  readonly bind: (context: ExecutableComponentContext) => ExecutableComponentBinding
}

export type ExecutableComponentEvaluation = {
  readonly id: string
  readonly family: string
  readonly title: string
  readonly suitability: string
  readonly rendererKey: string
  readonly eligible: true
  readonly reasons: readonly string[]
  readonly actionIds: readonly string[]
} | {
  readonly id: string
  readonly family: string
  readonly title: string
  readonly suitability: string
  readonly rendererKey: string
  readonly eligible: false
  readonly reasons: readonly string[]
}

/** A renderer receives this only after the same ID passed selection validation. */
export interface ExecutableComponentDispatch {
  readonly id: string
  readonly family: string
  readonly rendererKey: string
  readonly input: ExecutableJson
  readonly actionIds: readonly string[]
}

/** Persistable/mount-time reference. It deliberately excludes bound source input. */
export interface ExecutableComponentSelection {
  readonly id: string
  readonly family: string
  readonly rendererKey: string
  readonly actionIds: readonly string[]
}

export function executableComponentSelection(dispatch: ExecutableComponentDispatch): ExecutableComponentSelection {
  return Object.freeze({ id: dispatch.id, family: dispatch.family, rendererKey: dispatch.rendererKey, actionIds: dispatch.actionIds })
}

export interface ExecutableComponentAudit {
  readonly entries: readonly ExecutableComponentEvaluation[]
  readonly eligibleIds: readonly string[]
  readonly excluded: readonly { readonly id: string, readonly reasons: readonly string[] }[]
}

/** Input is deliberately transient until dispatch. It is never kept in an audit. */
type EvaluatedBinding = { readonly evaluation: ExecutableComponentEvaluation, readonly input?: ExecutableJson }

export class ExecutableComponentRegistryError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'ExecutableComponentRegistryError'
  }
}

/** Upstream component identities remain opaque; they are never filesystem paths or URLs here. */
const componentIdentifier = /^[A-Za-z][A-Za-z0-9:_.\/-]{0,159}$/u
/** Families, renderer keys, and Host action IDs are local controlled identifiers. */
const internalIdentifier = /^[a-z][a-z0-9:_-]{0,159}$/u
const humanText = (value: unknown, field: string, max: number): string => {
  if (typeof value !== 'string') throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DEFINITION_INVALID', `${field} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > max) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DEFINITION_INVALID', `${field} must be a non-empty string up to ${String(max)} characters.`)
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Canonical JSON rejects classes, non-finite values, cycles, and excessive depth. */
export function stableExecutableJson(value: unknown, ancestors = new WeakSet<object>(), depth = 0): string {
  if (depth > MAX_EXECUTABLE_COMPONENT_INPUT_DEPTH) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_INPUT_DEPTH_EXCEEDED')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_INPUT_INVALID', 'Input JSON numbers must be finite.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_INPUT_CYCLE')
    ancestors.add(value)
    try { return `[${value.map(item => stableExecutableJson(item, ancestors, depth + 1)).join(',')}]` }
    finally { ancestors.delete(value) }
  }
  if (!isRecord(value)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_INPUT_INVALID', 'Component input must be JSON data.')
  if (ancestors.has(value)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_INPUT_CYCLE')
  ancestors.add(value)
  try {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableExecutableJson(value[key], ancestors, depth + 1)}`).join(',')}}`
  } finally { ancestors.delete(value) }
}

export function normalizeExecutableJson(value: unknown): ExecutableJson {
  const encoded = stableExecutableJson(value)
  if (new TextEncoder().encode(encoded).byteLength > MAX_EXECUTABLE_COMPONENT_INPUT_BYTES) {
    throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_INPUT_TOO_LARGE')
  }
  return JSON.parse(encoded) as ExecutableJson
}

function normalizeReasons(value: readonly string[] | undefined, fallback: string): readonly string[] {
  const unique = new Set<string>()
  for (const raw of value ?? []) {
    if (typeof raw !== 'string') continue
    const reason = raw.trim()
    if (reason && reason.length <= 300) unique.add(reason)
  }
  if (!unique.size) unique.add(fallback)
  return Object.freeze([...unique].sort((left, right) => left.localeCompare(right)))
}

function normalizeActionIds(value: readonly string[] | undefined, context: ExecutableComponentContext): readonly string[] | undefined {
  if (value === undefined) return Object.freeze([])
  const allowed = new Set<string>()
  for (const raw of context.hostActionIds ?? []) {
    if (typeof raw !== 'string' || !internalIdentifier.test(raw)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_CONTEXT_ACTION_INVALID')
    allowed.add(raw)
  }
  const result = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string' || !internalIdentifier.test(raw)) return undefined
    if (!allowed.has(raw)) return undefined
    result.add(raw)
  }
  return Object.freeze([...result].sort((left, right) => left.localeCompare(right)))
}

function validateContext(context: ExecutableComponentContext): void {
  if (!context || typeof context !== 'object' || !context.capabilities || typeof context.capabilities.webgl !== 'boolean' || typeof context.capabilities.reducedMotion !== 'boolean') {
    throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_CONTEXT_INVALID')
  }
  if (context.isStreaming !== undefined && typeof context.isStreaming !== 'boolean') throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_CONTEXT_INVALID')
  // Validate host action IDs even when the chosen component is display-only.
  normalizeActionIds([], context)
}

function normalizeDefinition<Input extends ExecutableJson>(definition: ExecutableComponentDefinition<Input>): ExecutableComponentDefinition<Input> {
  if (!definition || typeof definition !== 'object') throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DEFINITION_INVALID')
  if (!componentIdentifier.test(definition.id)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DEFINITION_INVALID', 'id must be an opaque namespace-preserving component identifier.')
  for (const field of ['family', 'rendererKey'] as const) if (!internalIdentifier.test(definition[field])) {
    throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DEFINITION_INVALID', `${field} must be a stable internal executable identifier.`)
  }
  humanText(definition.title, 'title', 200)
  humanText(definition.suitability, 'suitability', 2_000)
  if (!definition.inputSchema || typeof definition.inputSchema.parse !== 'function' || typeof definition.bind !== 'function') {
    throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DEFINITION_INCOMPLETE', 'Executable components require inputSchema and bind functions.')
  }
  return definition
}

/**
 * A per-Host registry. Definitions are injected by concrete adapters (DIL,
 * Uiverse, Canvas, TuffUI, Rune); this generic module deliberately imports none
 * of their source archives or DOM runtimes.
 */
export class ExecutableComponentRegistry {
  private readonly definitions = new Map<string, ExecutableComponentDefinition>()

  register<Input extends ExecutableJson>(definition: ExecutableComponentDefinition<Input>): () => void {
    const normalized = normalizeDefinition(definition)
    if (this.definitions.has(normalized.id)) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DUPLICATE', `Component already registered: ${normalized.id}`)
    this.definitions.set(normalized.id, normalized as ExecutableComponentDefinition)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.definitions.get(normalized.id) === normalized) this.definitions.delete(normalized.id)
    }
  }

  get(id: string): ExecutableComponentDefinition | undefined { return this.definitions.get(id) }

  list(): readonly ExecutableComponentDefinition[] {
    return Object.freeze([...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id)))
  }

  evaluate(id: string, context: ExecutableComponentContext): ExecutableComponentEvaluation {
    return this.evaluateBinding(id, context, false).evaluation
  }

  private evaluateBinding(id: string, context: ExecutableComponentContext, retainInput: boolean): EvaluatedBinding {
    validateContext(context)
    const definition = this.definitions.get(id)
    if (!definition) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_UNKNOWN', `No executable component is registered for ${id}.`)
    let binding: ExecutableComponentBinding
    try { binding = definition.bind(context) }
    catch (error) {
      const code = error instanceof ExecutableComponentRegistryError ? error.code : 'EXECUTABLE_COMPONENT_BIND_FAILED'
      return { evaluation: Object.freeze({ ...publicFields(definition), eligible: false as const, reasons: Object.freeze([code]) }) }
    }
    if (!binding || typeof binding !== 'object' || typeof binding.eligible !== 'boolean') {
      return { evaluation: Object.freeze({ ...publicFields(definition), eligible: false as const, reasons: Object.freeze(['EXECUTABLE_COMPONENT_BIND_INVALID']) }) }
    }
    if (!binding.eligible) return { evaluation: Object.freeze({ ...publicFields(definition), eligible: false as const, reasons: normalizeReasons(binding.reasons, 'EXECUTABLE_COMPONENT_INELIGIBLE') }) }
    let input: ExecutableJson
    try { input = normalizeExecutableJson(definition.inputSchema.parse(binding.input)) }
    catch (error) {
      const code = error instanceof ExecutableComponentRegistryError ? error.code : 'EXECUTABLE_COMPONENT_INPUT_SCHEMA_REJECTED'
      return { evaluation: Object.freeze({ ...publicFields(definition), eligible: false as const, reasons: Object.freeze([code]) }) }
    }
    const actionIds = normalizeActionIds(binding.actionIds, context)
    if (actionIds === undefined) return { evaluation: Object.freeze({ ...publicFields(definition), eligible: false as const, reasons: Object.freeze(['EXECUTABLE_COMPONENT_ACTION_NOT_HOST_OWNED']) }) }
    return {
      evaluation: Object.freeze({ ...publicFields(definition), eligible: true as const, reasons: normalizeReasons(binding.reasons, 'EXECUTABLE_COMPONENT_ELIGIBLE'), actionIds }),
      ...(retainInput ? { input } : {}),
    }
  }

  audit(context: ExecutableComponentContext): ExecutableComponentAudit {
    const entries = this.list().map(definition => this.evaluate(definition.id, context))
    const eligibleIds = entries.filter((entry): entry is Extract<ExecutableComponentEvaluation, { eligible: true }> => entry.eligible).map(entry => entry.id)
    const excluded = entries.filter((entry): entry is Extract<ExecutableComponentEvaluation, { eligible: false }> => !entry.eligible).map(entry => ({ id: entry.id, reasons: entry.reasons }))
    return Object.freeze({ entries: Object.freeze(entries), eligibleIds: Object.freeze(eligibleIds), excluded: Object.freeze(excluded) })
  }

  /** Strict same-ID selection-to-dispatch bridge. No fallback renderer is chosen here. */
  dispatch(id: string, context: ExecutableComponentContext): ExecutableComponentDispatch {
    const { evaluation: selected, input } = this.evaluateBinding(id, context, true)
    if (!selected.eligible) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_SELECTION_INELIGIBLE', `${id}: ${selected.reasons.join(',')}`)
    if (input === undefined) throw new ExecutableComponentRegistryError('EXECUTABLE_COMPONENT_DISPATCH_INPUT_MISSING')
    return Object.freeze({ id: selected.id, family: selected.family, rendererKey: selected.rendererKey, input, actionIds: selected.actionIds })
  }
}

function publicFields(definition: ExecutableComponentDefinition): Pick<ExecutableComponentEvaluation, 'id' | 'family' | 'title' | 'suitability' | 'rendererKey'> {
  return { id: definition.id, family: definition.family, title: definition.title, suitability: definition.suitability, rendererKey: definition.rendererKey }
}
