import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { artifactSchema, initialSettings, saveSettingsSchema, saveWidgetStateSchema, settingsSchema, widgetInputSchema, widgetStateSchema, type ExperienceArtifact, type ExperienceSettings, type PublishInput, type SaveSettingsInput, type SaveWidgetStateInput, type WidgetState } from './contracts.js'
import { builtInThemes, installThemeSchema, removeThemeSchema, resolveTheme, MAX_IMPORTED_THEMES, MAX_THEME_BYTES, type InstallThemeInput, type RemoveThemeInput } from './theme-contracts.js'
import { isLocalImport } from './file-library-contracts.js'

const queues = new Map<string, Promise<unknown>>()

export class ExperienceStoreError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name }
}
export class RevisionConflictError extends ExperienceStoreError {
  constructor(readonly expected: number, readonly actual: number) { super(`Settings revision conflict: expected ${expected}, found ${actual}`) }
}
export class ArtifactTooLargeError extends ExperienceStoreError {
  constructor(readonly actualBytes: number, readonly maxBytes: number) { super(`Artifact is ${actualBytes} bytes; limit is ${maxBytes} bytes`) }
}
export class ArtifactLimitError extends ExperienceStoreError {
  constructor(readonly sessionId: string, readonly maxArtifacts: number) { super(`Session ${sessionId} already has the maximum of ${maxArtifacts} artifacts`) }
}
export class ArtifactNotFoundError extends ExperienceStoreError {
  constructor(readonly sessionId: string, readonly artifactId: string) { super(`Artifact ${artifactId} was not found in session ${sessionId}`) }
}
export class WidgetStateTooLargeError extends ExperienceStoreError {
  constructor(readonly actualBytes: number, readonly maxBytes: number) { super(`Widget state is ${actualBytes} bytes; limit is ${maxBytes} bytes`) }
}
export class WidgetStateRevisionConflictError extends ExperienceStoreError {
  constructor(readonly expected: number, readonly actual: number) { super(`Widget state revision conflict: expected ${expected}, found ${actual}`) }
}
export class StoredDataError extends ExperienceStoreError {}
export class ThemePackageTooLargeError extends ExperienceStoreError {
  constructor(readonly actualBytes: number) { super(`THEME_PACKAGE_TOO_LARGE: Theme package is ${actualBytes} bytes; limit is ${MAX_THEME_BYTES} bytes`) }
}
export class ThemeValidationError extends ExperienceStoreError {
  constructor(detail: string) { super(`THEME_PACKAGE_INVALID: ${detail}`) }
}
export class ThemeIdConflictError extends ExperienceStoreError {
  constructor(readonly id: string) { super(`THEME_ID_CONFLICT: Theme ${id} is already installed or reserved`) }
}
export class ThemeLimitError extends ExperienceStoreError {
  constructor() { super(`THEME_LIMIT_REACHED: At most ${MAX_IMPORTED_THEMES} imported themes may be installed`) }
}
export class ThemeNotFoundError extends ExperienceStoreError {
  constructor(readonly id: string) { super(`THEME_NOT_FOUND: Theme ${id} is not installed`) }
}
export class BuiltInThemeRemovalError extends ExperienceStoreError {
  constructor(readonly id: string) { super(`THEME_BUILTIN_REQUIRED: Built-in theme ${id} cannot be removed`) }
}

function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => undefined)
  return next
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readVersioned<T>(path: string, schema: { safeParse(value: unknown): { success: boolean; data?: T; error?: { message: string } } }): Promise<T | undefined> {
  let text: string
  try { text = await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new StoredDataError(`Malformed stored data: ${path}`) }
  if (typeof parsed === 'object' && parsed !== null && 'formatVersion' in parsed && (parsed as { formatVersion: unknown }).formatVersion !== 1)
    throw new StoredDataError(`Unknown format version in ${path}: ${String((parsed as { formatVersion: unknown }).formatVersion)}`)
  const result = schema.safeParse(parsed)
  if (!result.success) throw new StoredDataError(`Invalid stored data in ${path}: ${result.error?.message ?? 'schema mismatch'}`)
  return result.data
}

export class ExperienceStore {
  private readonly root: string
  private readonly maxArtifactBytes: number
  private readonly listeners = new Set<(settings: ExperienceSettings) => void>()

  constructor(root: string, options: { maxArtifactBytes?: number; maxArtifactsPerSession?: number } = {}) {
    this.root = resolve(root)
    this.maxArtifactBytes = options.maxArtifactBytes ?? 1024 * 1024
    this.maxArtifactsPerSession = options.maxArtifactsPerSession ?? 500
    if (!Number.isSafeInteger(this.maxArtifactBytes) || this.maxArtifactBytes < 1) throw new RangeError('maxArtifactBytes must be a positive safe integer')
    if (!Number.isSafeInteger(this.maxArtifactsPerSession) || this.maxArtifactsPerSession < 1) throw new RangeError('maxArtifactsPerSession must be a positive safe integer')
  }

  private readonly maxArtifactsPerSession: number

  async settings(): Promise<ExperienceSettings> {
    const settings = await readVersioned(join(this.root, 'settings.json'), settingsSchema)
    return settings ?? initialSettings()
  }

  saveSettings(input: SaveSettingsInput): Promise<ExperienceSettings> {
    const parsed = saveSettingsSchema.parse(input)
    return this.changeSettings(parsed.expectedRevision, current => {
      const previousId = current.theme?.activeId ?? 'empryo'
      const theme = parsed.themeId === undefined ? current.theme : { activeId: parsed.themeId, installed: current.theme?.installed ?? [] }
      const target = parsed.themeId === undefined ? undefined : [...builtInThemes, ...theme!.installed].find(item => item.id === parsed.themeId)
      if (parsed.themeId !== undefined && !target) throw new ThemeNotFoundError(parsed.themeId)
      const appearance = parsed.appearance ?? (target && target.id !== previousId ? { ...target.appearance } : current.appearance)
      return { ...current, takeover: parsed.takeover, openui: parsed.openui, mcpApps: parsed.mcpApps, appearance, theme, ...(parsed.themeSource === undefined ? {} : { themeSource: parsed.themeSource }) }
    })
  }

  installTheme(input: InstallThemeInput): Promise<ExperienceSettings> {
    let encoded: string
    try { encoded = JSON.stringify(input.theme) } catch { throw new ThemeValidationError('Theme package must be JSON data') }
    if (encoded === undefined) throw new ThemeValidationError('Theme package is required')
    const bytes = Buffer.byteLength(encoded)
    if (bytes > MAX_THEME_BYTES) throw new ThemePackageTooLargeError(bytes)
    const parsed = installThemeSchema.safeParse(input)
    if (!parsed.success) throw new ThemeValidationError(parsed.error.message)
    return this.changeSettings(parsed.data.expectedRevision, current => {
      const theme = current.theme ?? { activeId: 'empryo', installed: [] }
      if ([...builtInThemes, ...theme.installed].some(item => item.id === parsed.data.theme.id)) throw new ThemeIdConflictError(parsed.data.theme.id)
      if (theme.installed.length >= MAX_IMPORTED_THEMES) throw new ThemeLimitError()
      return { ...current, theme: { activeId: theme.activeId, installed: [...theme.installed, parsed.data.theme] } }
    })
  }

  removeTheme(input: RemoveThemeInput): Promise<ExperienceSettings> {
    const parsed = removeThemeSchema.parse(input)
    return this.changeSettings(parsed.expectedRevision, current => {
      if (builtInThemes.some(item => item.id === parsed.id)) throw new BuiltInThemeRemovalError(parsed.id)
      const theme = current.theme ?? { activeId: 'empryo', installed: [] }
      if (!theme.installed.some(item => item.id === parsed.id)) throw new ThemeNotFoundError(parsed.id)
      const active = theme.activeId === parsed.id
      return { ...current, theme: { activeId: active ? 'empryo' : theme.activeId, installed: theme.installed.filter(item => item.id !== parsed.id) }, ...(active ? { appearance: { ...resolveTheme().appearance } } : {}) }
    })
  }

  private changeSettings(expectedRevision: number, update: (current: ExperienceSettings) => ExperienceSettings): Promise<ExperienceSettings> {
    return serialized(this.root, async () => {
      const current = await this.settings()
      if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision)
      const next = settingsSchema.parse({ ...update(current), formatVersion: 1, revision: current.revision + 1 })
      await atomicJson(join(this.root, 'settings.json'), next)
      for (const listener of [...this.listeners]) listener(next)
      return next
    })
  }

  subscribe(callback: (settings: ExperienceSettings) => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }

  async artifacts(input: { sessionId: string }): Promise<ExperienceArtifact[]> {
    if (!input.sessionId) throw new TypeError('sessionId is required')
    const dir = join(this.root, 'artifacts', encodeURIComponent(input.sessionId))
    let names: string[]
    try { names = await readdir(dir) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const records: ExperienceArtifact[] = []
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
      const artifact = await readVersioned(join(dir, name), artifactSchema)
      if (artifact) records.push(artifact)
    }
    return records
  }

  /** Enumerate plugin-owned local imports on demand without changing their original buckets. */
  async localFiles(): Promise<ExperienceArtifact[]> {
    let entries: Dirent[]
    try { entries = await readdir(join(this.root, 'artifacts'), { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const files: ExperienceArtifact[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      let scope: string
      try { scope = decodeURIComponent(entry.name) } catch { continue }
      if (!scope || encodeURIComponent(scope) !== entry.name) continue
      files.push(...(await this.artifacts({ sessionId: scope })).filter(isLocalImport))
    }
    return files.sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1
      if (left.source.sessionId !== right.source.sessionId) return left.source.sessionId < right.source.sessionId ? -1 : 1
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    })
  }

  private artifactPath(sessionId: string, artifactId: string): string {
    return join(this.root, 'artifacts', encodeURIComponent(sessionId), `${artifactId}.json`)
  }

  private widgetStatePath(sessionId: string, artifactId: string): string {
    return join(this.root, 'artifacts', encodeURIComponent(sessionId), 'widget-state', `${artifactId}.json`)
  }

  private async requireArtifact(sessionId: string, artifactId: string): Promise<ExperienceArtifact> {
    const artifact = await readVersioned(this.artifactPath(sessionId, artifactId), artifactSchema)
    if (!artifact || artifact.id !== artifactId || artifact.source.sessionId !== sessionId) throw new ArtifactNotFoundError(sessionId, artifactId)
    return artifact
  }

  async widgetState(input: { sessionId: string; artifactId: string }): Promise<WidgetState> {
    const parsed = widgetInputSchema.parse(input)
    await this.requireArtifact(parsed.sessionId, parsed.artifactId)
    const saved = await readVersioned(this.widgetStatePath(parsed.sessionId, parsed.artifactId), widgetStateSchema)
    return saved ?? { formatVersion: 1, revision: 0, state: {} }
  }

  saveWidgetState(input: SaveWidgetStateInput): Promise<WidgetState> {
    const parsed = saveWidgetStateSchema.parse(input)
    const candidate = widgetStateSchema.parse({ formatVersion: 1, revision: parsed.expectedRevision + 1, state: parsed.state })
    const bytes = Buffer.byteLength(JSON.stringify(candidate))
    if (bytes > this.maxArtifactBytes) return Promise.reject(new WidgetStateTooLargeError(bytes, this.maxArtifactBytes))
    return serialized(this.root, async () => {
      await this.requireArtifact(parsed.sessionId, parsed.artifactId)
      const path = this.widgetStatePath(parsed.sessionId, parsed.artifactId)
      const current = await readVersioned(path, widgetStateSchema) ?? { formatVersion: 1 as const, revision: 0, state: {} }
      if (current.revision !== parsed.expectedRevision) throw new WidgetStateRevisionConflictError(parsed.expectedRevision, current.revision)
      const next = widgetStateSchema.parse({ formatVersion: 1, revision: current.revision + 1, state: parsed.state })
      await atomicJson(path, next)
      return next
    })
  }

  publish(input: PublishInput): Promise<ExperienceArtifact> {
    const parsed = artifactSchema.omit({ id: true, createdAt: true }).parse({ formatVersion: 1, ...input })
    const bytes = Buffer.byteLength(JSON.stringify(parsed))
    if (bytes > this.maxArtifactBytes) return Promise.reject(new ArtifactTooLargeError(bytes, this.maxArtifactBytes))
    return serialized(this.root, async () => {
      const artifact = artifactSchema.parse({ ...parsed, id: randomUUID(), createdAt: new Date().toISOString() })
      const dir = join(this.root, 'artifacts', encodeURIComponent(artifact.source.sessionId))
      await mkdir(dir, { recursive: true })
      const names = await readdir(dir)
      if (names.filter((name) => name.endsWith('.json')).length >= this.maxArtifactsPerSession)
        throw new ArtifactLimitError(artifact.source.sessionId, this.maxArtifactsPerSession)
      await atomicJson(join(dir, `${artifact.id}.json`), artifact)
      return artifact
    })
  }
}
