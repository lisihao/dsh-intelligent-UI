/**
 * Read-only projection of the installed `dsh-deepseek-web-login` web API.
 *
 * The route adapter is deliberately injected. A caller can pass a simple
 * `(path) => response` fixture/bridge, or the standard `fetch` function. The
 * optional `RequestInit` is only used for the installed `/models` POST route;
 * simple one-argument adapters may ignore it.
 *
 * This module never writes account state, selects an account, sends a model
 * request, caches a response, or retains an unfiltered response body.
 */

export const MODEL_CENTER_WEB_PATHS = {
  status: '/deepseek-web-login/api/status?light=1',
  accounts: '/deepseek-web-login/api/accounts',
  models: '/deepseek-web-login/api/models',
} as const

export type ModelCenterWebSource = keyof typeof MODEL_CENTER_WEB_PATHS

export interface ModelCenterWebResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** A path-only adapter is sufficient; native `fetch` also satisfies this type. */
export type ModelCenterWebFetcher = (
  path: string,
  init?: RequestInit,
) => Promise<ModelCenterWebResponse>

export interface ModelCenterWebAuthSummary {
  readonly loggedIn?: boolean
  readonly display?: string
  readonly capturedAt?: string
  readonly hasCookie?: boolean
  readonly hasFingerprint?: boolean
  readonly unverified?: boolean
  /** A count is safe to show; the token itself is never read into the result. */
  readonly tokenLength?: number
}

export type ModelCenterWebCapability = 'text' | 'image' | 'thinking'

export interface ModelCenterWebModel {
  /** Stable model identifier declared by the plugin route. */
  readonly id: string
  readonly label?: string
  readonly description?: string
  /** Capabilities are copied only from explicit route metadata. */
  readonly capabilities: readonly ModelCenterWebCapability[]
  readonly contextWindow?: number
}

export type ModelCenterWebAccountState =
  | 'active'
  | 'ready'
  | 'limited'
  | 'unverified'
  | 'verification-error'
  | 'check-error'

export interface ModelCenterWebAccountFlags {
  readonly isActive: boolean
  readonly unverified: boolean
  readonly limited: boolean
  readonly hasVerificationError: boolean
  readonly hasCheckError: boolean
}

export interface ModelCenterWebAccount {
  /** `id` and `internalId` are the same stable account identity. */
  readonly id: string
  readonly internalId: string
  /** Human-facing label, never a token/cookie/session value. */
  readonly label: string
  readonly display?: string
  readonly groupId?: string
  readonly isActive: boolean
  readonly flags: ModelCenterWebAccountFlags
  readonly state: ModelCenterWebAccountState
  readonly capturedAt?: string
  readonly lastVerifiedAt?: string
  readonly limitUntilMs?: number
}

export interface ModelCenterWebStatus {
  readonly provider?: string
  readonly registeredProviders?: readonly string[]
  readonly auth?: ModelCenterWebAuthSummary
  /** The status route's declared model metadata, if present. */
  readonly models?: readonly ModelCenterWebModel[]
}

export interface ModelCenterWebAccounts {
  readonly activeAccountId?: string
  readonly accounts: readonly ModelCenterWebAccount[]
}

export type ModelCenterWebSourceErrorKind = 'request' | 'http' | 'json' | 'payload'

export interface ModelCenterWebSourceError {
  readonly source: ModelCenterWebSource
  readonly path: string
  readonly kind: ModelCenterWebSourceErrorKind
  readonly message: string
  readonly status?: number
}

export interface ModelCenterWebSourceResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: ModelCenterWebSourceError
}

export interface ModelCenterWebSnapshot {
  readonly status: ModelCenterWebStatus | null
  readonly activeAccountId: string | null
  readonly accounts: readonly ModelCenterWebAccount[] | null
  readonly models: readonly ModelCenterWebModel[] | null
  /** Per-route state remains explicit when a route is unavailable. */
  readonly sources: Readonly<{
    status: ModelCenterWebSourceResult<ModelCenterWebStatus>
    accounts: ModelCenterWebSourceResult<ModelCenterWebAccounts>
    models: ModelCenterWebSourceResult<readonly ModelCenterWebModel[]>
  }>
  readonly errors: readonly ModelCenterWebSourceError[]
}

type RecordLike = Record<string, unknown>

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const credentialPattern =
  /(?:bearer\s+|(?:access|refresh|session|auth|api)?[_-]?token|cookie|password|secret|authorization)/iu

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) return undefined
  if (credentialPattern.test(text) || /^[A-Za-z0-9+/=_-]{48,}$/u.test(text)) return undefined
  return text
}

function cleanIdentifier(value: unknown): string | undefined {
  const text = cleanText(value, 128)
  if (!text || !/^[A-Za-z0-9._:-]+$/u.test(text)) return undefined
  return text
}

function redactIdentifier(value: unknown): string | undefined {
  const text = cleanText(value, 256)
  if (!text) return undefined
  const at = text.lastIndexOf('@')
  if (at > 0 && at < text.length - 1) {
    const local = text.slice(0, at)
    const domain = text.slice(at + 1)
    if (/^[^@\s]+$/u.test(domain)) return `${local.slice(0, 2)}***@${domain}`
  }
  if (/^\+?[0-9*()\s.-]+$/u.test(text)) {
    const digits = text.replace(/\D/gu, '')
    if (digits.length >= 4) return `${digits.slice(0, 2)}***${digits.slice(-2)}`
  }
  // The installed route already masks identifiers. Keep only a visibly
  // masked value; arbitrary strings are not account identifiers.
  if (text.includes('*') && text.length <= 128) return text
  return undefined
}

function cleanTimestamp(value: unknown): string | undefined {
  return cleanText(value, 96)
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseAuthSummary(value: unknown): ModelCenterWebAuthSummary | undefined {
  if (!isRecord(value)) return undefined
  const display = redactIdentifier(value.display)
  const capturedAt = cleanTimestamp(value.capturedAt)
  const output: ModelCenterWebAuthSummary = {
    ...(typeof value.loggedIn === 'boolean' ? { loggedIn: value.loggedIn } : {}),
    ...(display ? { display } : {}),
    ...(capturedAt ? { capturedAt } : {}),
    ...(typeof value.hasCookie === 'boolean' ? { hasCookie: value.hasCookie } : {}),
    ...(typeof value.hasFingerprint === 'boolean' ? { hasFingerprint: value.hasFingerprint } : {}),
    ...(typeof value.unverified === 'boolean' ? { unverified: value.unverified } : {}),
    ...(typeof value.tokenLength === 'number' && Number.isInteger(value.tokenLength) && value.tokenLength >= 0 && value.tokenLength <= 4096
      ? { tokenLength: value.tokenLength }
      : {}),
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function parseCapabilities(value: unknown, thinking: unknown): ModelCenterWebCapability[] {
  const capabilities: ModelCenterWebCapability[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === 'text' || item === 'image') capabilities.push(item)
    }
  }
  if (thinking === true) capabilities.push('thinking')
  return [...new Set(capabilities)]
}

function parseModelRecord(value: unknown): ModelCenterWebModel | undefined {
  if (!isRecord(value)) return undefined
  const id = cleanIdentifier(value.id)
  if (!id) return undefined
  const label = cleanText(value.name, 160)
  const description = cleanText(value.description, 512)
  const contextWindow = cleanNumber(value.contextWindow)
  return {
    id,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    capabilities: parseCapabilities(value.inputModalities, value.thinking),
    ...(contextWindow !== undefined && contextWindow > 0 ? { contextWindow } : {}),
  }
}

/** Whitelist the light status response; config, paths, guest state and errors are dropped. */
export function parseModelCenterWebStatus(value: unknown): ModelCenterWebStatus {
  if (!isRecord(value)) throw new Error('status payload is not an object')
  const provider = cleanIdentifier(value.provider)
  const registeredProviders = Array.isArray(value.registeredProviders)
    ? value.registeredProviders.map(cleanIdentifier).filter((item): item is string => item !== undefined)
    : undefined
  const models = Array.isArray(value.models)
    ? value.models.map(parseModelRecord).filter((item): item is ModelCenterWebModel => item !== undefined)
    : undefined
  if (Array.isArray(value.models) && value.models.length > 0 && models?.length === 0) {
    throw new Error('status payload has no usable model ids')
  }
  const auth = parseAuthSummary(value.auth)
  const output: ModelCenterWebStatus = {
    ...(provider ? { provider } : {}),
    ...(registeredProviders ? { registeredProviders } : {}),
    ...(auth ? { auth } : {}),
    ...(models ? { models } : {}),
  }
  if (Object.keys(output).length === 0) throw new Error('status payload has no supported fields')
  return output
}

function accountState(flags: ModelCenterWebAccountFlags): ModelCenterWebAccountState {
  if (flags.limited) return 'limited'
  if (flags.unverified) return 'unverified'
  if (flags.hasVerificationError) return 'verification-error'
  if (flags.hasCheckError) return 'check-error'
  return flags.isActive ? 'active' : 'ready'
}

function parseAccountRecord(value: unknown, activeAccountId: string | undefined): ModelCenterWebAccount | undefined {
  if (!isRecord(value)) return undefined
  const id = cleanIdentifier(value.id)
  if (!id) return undefined
  const isActive = value.isActive === true || id === activeAccountId
  const unverified = value.unverified === true
  const hasVerificationError = value.lastVerifyError !== undefined && value.lastVerifyError !== null && value.lastVerifyError !== false
  const hasCheckError = value.lastCheckError !== undefined && value.lastCheckError !== null && value.lastCheckError !== false
  const rawLimit = isRecord(value.limit) ? cleanNumber(value.limit.untilMs) : undefined
  const limited = rawLimit !== undefined && rawLimit > Date.now()
  const flags = { isActive, unverified, limited, hasVerificationError, hasCheckError }
  const display = redactIdentifier(value.display) ?? redactIdentifier(value.title)
  const explicitLabel = cleanText(value.label, 160)
  const label = explicitLabel ?? display ?? id
  const groupId = cleanIdentifier(value.groupId)
  const capturedAt = cleanTimestamp(value.capturedAt)
  const lastVerifiedAt = cleanTimestamp(value.lastVerifiedAt)
  return {
    id,
    internalId: id,
    label,
    ...(display ? { display } : {}),
    ...(groupId ? { groupId } : {}),
    isActive,
    flags,
    state: accountState(flags),
    ...(capturedAt ? { capturedAt } : {}),
    ...(lastVerifiedAt ? { lastVerifiedAt } : {}),
    ...(rawLimit !== undefined && rawLimit > 0 ? { limitUntilMs: rawLimit } : {}),
  }
}

/** Whitelist account cards and active selection without reading credentials. */
export function parseModelCenterWebAccounts(value: unknown): ModelCenterWebAccounts {
  if (!isRecord(value) || !Array.isArray(value.accounts)) throw new Error('accounts payload has no accounts array')
  const activeAccountId = cleanIdentifier(value.activeId)
  const accounts = value.accounts
    .map(item => parseAccountRecord(item, activeAccountId))
    .filter((item): item is ModelCenterWebAccount => item !== undefined)
  if (value.accounts.length > 0 && accounts.length === 0) throw new Error('accounts payload has no usable account ids')
  return {
    ...(activeAccountId ? { activeAccountId } : {}),
    accounts,
  }
}

/** Whitelist model ids and explicitly declared capabilities from `/models`. */
export function parseModelCenterWebModels(value: unknown): readonly ModelCenterWebModel[] {
  if (!isRecord(value) || !Array.isArray(value.models)) throw new Error('models payload has no models array')
  const models = value.models
    .map(parseModelRecord)
    .filter((item): item is ModelCenterWebModel => item !== undefined)
  if (value.models.length > 0 && models.length === 0) throw new Error('models payload has no usable model ids')
  return models
}

function mergeModels(...groups: readonly ModelCenterWebModel[][]): readonly ModelCenterWebModel[] {
  const merged = new Map<string, ModelCenterWebModel>()
  for (const group of groups) {
    for (const model of group) {
      const previous = merged.get(model.id)
      if (!previous) {
        merged.set(model.id, model)
        continue
      }
      const capabilities = [...new Set([...previous.capabilities, ...model.capabilities])]
      merged.set(model.id, {
        id: model.id,
        ...(previous.label ?? model.label ? { label: previous.label ?? model.label } : {}),
        ...(previous.description ?? model.description ? { description: previous.description ?? model.description } : {}),
        capabilities,
        ...(previous.contextWindow ?? model.contextWindow ? { contextWindow: previous.contextWindow ?? model.contextWindow } : {}),
      })
    }
  }
  return [...merged.values()]
}

function sourceError(
  source: ModelCenterWebSource,
  kind: ModelCenterWebSourceErrorKind,
  message: string,
  status?: number,
): ModelCenterWebSourceError {
  return {
    source,
    path: MODEL_CENTER_WEB_PATHS[source],
    kind,
    message,
    ...(status !== undefined ? { status } : {}),
  }
}

async function readSource<T>(
  source: ModelCenterWebSource,
  fetcher: ModelCenterWebFetcher,
  parser: (value: unknown) => T,
): Promise<ModelCenterWebSourceResult<T>> {
  const path = MODEL_CENTER_WEB_PATHS[source]
  try {
    const init = source === 'models' ? { method: 'POST', headers: { accept: 'application/json' } } : undefined
    const response = init === undefined ? await fetcher(path) : await fetcher(path, init)
    if (!response || response.ok !== true) {
      const status = typeof response?.status === 'number' && Number.isFinite(response.status) ? response.status : undefined
      return { ok: false, error: sourceError(source, 'http', status === undefined ? 'HTTP request failed' : `HTTP ${status}`, status) }
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, error: sourceError(source, 'json', 'response was not valid JSON') }
    }
    try {
      return { ok: true, value: parser(payload) }
    } catch (error) {
      // Do not expose parser input or arbitrary server error text.
      const message = error instanceof Error && error.message.startsWith('status payload')
        ? error.message
        : error instanceof Error && error.message.startsWith('accounts payload')
          ? error.message
          : error instanceof Error && error.message.startsWith('models payload')
            ? error.message
            : 'response payload was not in the supported shape'
      return { ok: false, error: sourceError(source, 'payload', message) }
    }
  } catch {
    // A thrown network error may contain URLs, headers or credentials. Keep a
    // stable source-level message instead of copying arbitrary error details.
    return { ok: false, error: sourceError(source, 'request', 'request failed') }
  }
}

/**
 * Read the three approved routes only. The result is a redacted snapshot:
 * `null` means that source failed and the corresponding `sources.*.error`
 * explains why; it is not an invented empty account/model list.
 */
export async function readModelCenterWeb(fetcher: ModelCenterWebFetcher = globalThis.fetch): Promise<ModelCenterWebSnapshot> {
  const [statusResult, accountsResult, modelsResult] = await Promise.all([
    readSource('status', fetcher, parseModelCenterWebStatus),
    readSource('accounts', fetcher, parseModelCenterWebAccounts),
    readSource('models', fetcher, parseModelCenterWebModels),
  ])
  const status = statusResult.value ?? null
  const accounts = accountsResult.value?.accounts ?? null
  const models = modelsResult.value
    ? mergeModels(statusResult.value?.models ? [...statusResult.value.models] : [], [...modelsResult.value])
    : statusResult.value?.models ?? null
  const errors = [statusResult.error, accountsResult.error, modelsResult.error].filter(
    (item): item is ModelCenterWebSourceError => item !== undefined,
  )
  return {
    status,
    activeAccountId: accountsResult.value?.activeAccountId ?? null,
    accounts,
    models,
    sources: {
      status: statusResult,
      accounts: accountsResult,
      models: modelsResult,
    },
    errors,
  }
}
