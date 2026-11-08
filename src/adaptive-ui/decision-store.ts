import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { z } from 'zod'
import { compositionResultSchema, type CompositionResult } from './contracts.js'

/**
 * Adopted Jev composition decisions kept across Host restarts, so reopening
 * the same content with the same settings, themes, candidates and Jev
 * connection reuses the earlier choice instead of asking Jev again. Only
 * `selected` results are kept, without operation ids: a restored decision
 * has no operation in this process, so it never sends a receipt.
 *
 * Several Hosts may share the directory; each write goes through its own
 * temporary file and an atomic rename, so the last complete write wins.
 */
export const DECISION_STORE_FORMAT_VERSION = 1
export const DEFAULT_DECISION_ENTRIES = 256
export const DEFAULT_DECISION_BYTES = 4 * 1024 * 1024
export const RESTORED_DECISION_REASON = 'JEV_SELECTION_RESTORED'

type Decision = Omit<CompositionResult, 'requestId'>
const entrySchema = z.strictObject({ key: z.string().regex(/^sha256:[0-9a-f]{64}$/), savedAt: z.string().min(1).max(64), result: compositionResultSchema })
const fileSchema = z.strictObject({ formatVersion: z.literal(DECISION_STORE_FORMAT_VERSION), entries: z.array(z.unknown()) })

export interface DecisionStoreOptions {
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly now?: () => Date
  readonly warn?: (message: string) => void
  /** Delay before a new decision is written; tests pass 0. */
  readonly writeDelayMs?: number
}

export class PersistedDecisionStore {
  private readonly entries = new Map<string, { savedAt: string, result: Decision, bytes: number }>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private disabled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false

  private constructor(private readonly file: string, private readonly options: DecisionStoreOptions) {
    this.maxEntries = options.maxEntries ?? DEFAULT_DECISION_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_DECISION_BYTES
  }

  /** Never throws: an unusable file leaves the store empty or disabled and logs one warning. */
  static open(file: string, options: DecisionStoreOptions = {}): PersistedDecisionStore {
    const store = new PersistedDecisionStore(file, options)
    let text: string
    try { text = readFileSync(file, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { store.disabled = true; store.warn(`COMPOSITION_DECISIONS_UNREADABLE: ${(error as Error).message}`) }
      return store
    }
    let raw: unknown
    try { raw = JSON.parse(text) }
    catch { store.setAside('COMPOSITION_DECISIONS_INVALID_JSON'); return store }
    const version = typeof raw === 'object' && raw !== null ? (raw as { formatVersion?: unknown }).formatVersion : undefined
    if (typeof version === 'number' && version !== DECISION_STORE_FORMAT_VERSION) {
      // A newer plugin wrote it; leave the file alone and keep decisions in memory only.
      store.disabled = true
      store.warn(`COMPOSITION_DECISIONS_FORMAT_UNKNOWN: format ${version} is not supported; decisions are not persisted in this run.`)
      return store
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) { store.setAside('COMPOSITION_DECISIONS_INVALID_FILE'); return store }
    for (const candidate of parsed.data.entries) {
      const entry = entrySchema.safeParse(candidate)
      if (!entry.success || entry.data.result.status !== 'selected' || entry.data.result.operationId !== undefined) continue
      store.entries.set(entry.data.key, { savedAt: entry.data.savedAt, result: entry.data.result, bytes: JSON.stringify(entry.data).length })
    }
    store.trim()
    return store
  }

  get size(): number { return this.entries.size }
  get persisting(): boolean { return !this.disabled }

  /** A read never rewrites the file. */
  get(key: string, sourceVersion: string): Decision | undefined {
    const entry = this.entries.get(key)
    if (!entry || entry.result.sourceVersion !== sourceVersion) return undefined
    return { ...entry.result, reason: RESTORED_DECISION_REASON }
  }

  put(key: string, result: Decision): void {
    if (result.status !== 'selected' || !/^sha256:[0-9a-f]{64}$/.test(key)) return
    const { operationId: _operationId, ...kept } = result
    const stored = compositionResultSchema.parse(kept) as Decision
    const savedAt = (this.options.now?.() ?? new Date()).toISOString()
    this.entries.delete(key)
    this.entries.set(key, { savedAt, result: stored, bytes: JSON.stringify({ key, savedAt, result: stored }).length })
    this.trim()
    this.schedule()
  }

  /** Writes pending decisions now; used at dispose. */
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined
    if (!this.dirty) return
    this.dirty = false
    const body = JSON.stringify({ formatVersion: DECISION_STORE_FORMAT_VERSION, entries: [...this.entries].map(([key, entry]) => ({ key, savedAt: entry.savedAt, result: entry.result })) })
    const temporary = `${this.file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(temporary, body, { mode: 0o600 })
      renameSync(temporary, this.file)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* Nothing was written. */ }
      this.warn(`COMPOSITION_DECISIONS_NOT_SAVED: ${(error as Error).message}`)
    }
  }

  private schedule(): void {
    if (this.disabled) return
    this.dirty = true
    if (this.timer) return
    const delay = this.options.writeDelayMs ?? 1000
    this.timer = setTimeout(() => { this.timer = undefined; this.flush() }, delay)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  /** Oldest decisions go first until both the entry and byte budgets hold. */
  private trim(): void {
    let bytes = 0
    for (const entry of this.entries.values()) bytes += entry.bytes
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break
      this.entries.delete(key); bytes -= entry.bytes
    }
  }

  private setAside(code: string): void {
    const aside = `${this.file}.invalid-${(this.options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')}`
    try { renameSync(this.file, aside); this.warn(`${code}: moved to ${aside}; starting with no saved decisions.`) }
    catch (error) { this.disabled = true; this.warn(`${code}: ${(error as Error).message}`) }
  }

  private warn(message: string): void { this.options.warn?.(message) }
}
