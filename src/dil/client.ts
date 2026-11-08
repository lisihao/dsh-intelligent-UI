import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'

import { artifactSchema } from '../contracts.js'
import type { DILPayload, DilApi, ExperienceArtifact } from '../contracts.js'

/** The browser receives compiled data only; compiling remains a Host operation. */
export type DilPreviewApi = DilApi

export type SolarPresentProtocol = 'content' | 'openui' | 'dil'

export interface SolarPresentArguments {
  protocol?: SolarPresentProtocol
  label?: string
  /** Only a string payload can be previewed before the Host has a result. */
  payload?: string
  /** `false` means the JSON string is still open, not that characters were made up. */
  payloadComplete?: boolean
}

export interface SolarPresentPreview extends Required<Pick<SolarPresentArguments, 'protocol' | 'payload'>> {
  protocol: 'openui' | 'dil'
  label?: string
  payloadComplete: boolean
}

/** Prevent an unbounded browser scan if a malformed tool stream never settles. */
export const MAX_SOLAR_PRESENT_ARGUMENT_CHARS = 256 * 1024
export const DIL_PREVIEW_DEBOUNCE_MS = 120

type JsonString = { value: string, next: number, complete: boolean }
type FieldValue = JsonString

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t'
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start
  while (isWhitespace(source[cursor])) cursor++
  return cursor
}

/**
 * Decode only a JSON string prefix. An unfinished escape is omitted rather than
 * guessed; a later tool update will provide the missing source characters.
 */
function readJsonString(source: string, start: number): JsonString | undefined {
  if (source[start] !== '"') return undefined
  let cursor = start + 1
  let value = ''
  while (cursor < source.length) {
    const current = source[cursor]!
    if (current === '"') return { value, next: cursor + 1, complete: true }
    if (current === '\\') {
      const escaped = source[cursor + 1]
      if (escaped === undefined) return { value, next: source.length, complete: false }
      const mapped: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
      if (escaped in mapped) {
        value += mapped[escaped]!
        cursor += 2
        continue
      }
      if (escaped !== 'u') return undefined
      const digits = source.slice(cursor + 2, cursor + 6)
      if (digits.length < 4) return { value, next: source.length, complete: false }
      if (!/^[0-9a-f]{4}$/i.test(digits)) return undefined
      value += String.fromCharCode(Number.parseInt(digits, 16))
      cursor += 6
      continue
    }
    if (current < ' ') return undefined
    value += current
    cursor++
  }
  return { value, next: source.length, complete: false }
}

/** Skip an unknown complete/prefix JSON value without evaluating or parsing it. */
function skipJsonValue(source: string, start: number): number | undefined {
  let cursor = skipWhitespace(source, start)
  const first = source[cursor]
  if (first === undefined) return cursor
  if (first === '"') return readJsonString(source, cursor)?.next
  if (first === '{' || first === '[') {
    const stack: Array<'}' | ']'> = [first === '{' ? '}' : ']']
    cursor++
    while (cursor < source.length) {
      const current = source[cursor]!
      if (current === '"') {
        const string = readJsonString(source, cursor)
        if (!string) return undefined
        cursor = string.next
        if (!string.complete) return cursor
        continue
      }
      if (current === '{') stack.push('}')
      else if (current === '[') stack.push(']')
      else if (current === '}' || current === ']') {
        if (stack.pop() !== current) return undefined
        if (stack.length === 0) return cursor + 1
      }
      cursor++
    }
    return cursor
  }
  const tokenStart = cursor
  while (cursor < source.length && !isWhitespace(source[cursor]) && source[cursor] !== ',' && source[cursor] !== '}' && source[cursor] !== ']') cursor++
  return cursor === tokenStart ? undefined : cursor
}

/**
 * Reads exactly the top-level `protocol`, `label`, and string `payload` fields
 * from an unfinished `solar_present` JSON argument document. It intentionally
 * does not evaluate expressions or manufacture an incomplete escape sequence.
 */
export function extractSolarPresentArguments(argsRaw: unknown): SolarPresentArguments | undefined {
  if (typeof argsRaw !== 'string' || argsRaw.length > MAX_SOLAR_PRESENT_ARGUMENT_CHARS) return undefined
  let cursor = skipWhitespace(argsRaw, 0)
  if (argsRaw[cursor] !== '{') return undefined
  cursor++
  const fields: Partial<Record<'protocol' | 'label' | 'payload', FieldValue>> = {}
  while (cursor < argsRaw.length) {
    cursor = skipWhitespace(argsRaw, cursor)
    if (argsRaw[cursor] === '}') break
    const key = readJsonString(argsRaw, cursor)
    if (!key || !key.complete) break
    cursor = skipWhitespace(argsRaw, key.next)
    if (argsRaw[cursor] !== ':') break
    cursor = skipWhitespace(argsRaw, cursor + 1)
    const known = key.value === 'protocol' || key.value === 'label' || key.value === 'payload' ? key.value : undefined
    if (known && argsRaw[cursor] === '"') {
      const value = readJsonString(argsRaw, cursor)
      if (!value) break
      fields[known] = value
      cursor = value.next
      if (!value.complete) break
    } else {
      const next = skipJsonValue(argsRaw, cursor)
      if (next === undefined) break
      cursor = next
    }
    cursor = skipWhitespace(argsRaw, cursor)
    if (argsRaw[cursor] === ',') { cursor++; continue }
    if (argsRaw[cursor] === '}') break
    break
  }
  const protocol = fields.protocol?.value
  const validProtocol: SolarPresentProtocol | undefined = protocol === 'content' || protocol === 'openui' || protocol === 'dil' ? protocol : undefined
  return {
    ...(validProtocol ? { protocol: validProtocol } : {}),
    ...(fields.label ? { label: fields.label.value } : {}),
    ...(fields.payload ? { payload: fields.payload.value, payloadComplete: fields.payload.complete } : {}),
  }
}

/** Active calls only: result metadata is authoritative and failed calls render their normal error. */
export function activeSolarPresentPreview(tool: { name?: unknown, kind?: unknown, isError?: unknown, argsRaw?: unknown }): SolarPresentPreview | undefined {
  if (tool.name !== 'solar_present' || tool.kind === 'tool-result' || tool.isError || typeof tool.argsRaw !== 'string') return undefined
  const args = extractSolarPresentArguments(tool.argsRaw)
  if (!args || (args.protocol !== 'openui' && args.protocol !== 'dil') || typeof args.payload !== 'string') return undefined
  return { protocol: args.protocol, payload: args.payload, payloadComplete: args.payloadComplete === true, ...(args.label ? { label: args.label } : {}) }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Build only a Host-created, durable presentation artifact from result metadata. */
export function artifactFromPresentationMeta(input: { meta?: unknown, name?: unknown, isError?: unknown, sessionId: string, callId: string }): ExperienceArtifact | undefined {
  if (input.isError) return undefined
  const meta = record(input.meta)
  const protocol = meta?.protocol
  if (meta?.type !== 'solar-experience' || (protocol !== 'content' && protocol !== 'openui' && protocol !== 'dil') || typeof meta.label !== 'string' || typeof meta.artifactId !== 'string') return undefined
  // DIL metadata carries runner input, so only our explicit solar_present tool
  // is allowed to turn it into an executable artifact.
  if (protocol === 'dil' && input.name !== 'solar_present') return undefined
  const payload = meta.payload
  const dilPayload = protocol === 'dil' ? record(payload) : undefined
  const parsed = artifactSchema.safeParse({
    formatVersion: 1,
    id: meta.artifactId,
    createdAt: '',
    source: { sessionId: input.sessionId, callId: input.callId, kind: 'tool', label: meta.label },
    protocol,
    // Result metadata has no separate raw field. DIL keeps its readable source here.
    raw: protocol === 'dil' && typeof dilPayload?.source === 'string' ? dilPayload.source : payload,
    payload,
    providerId: 'solar-present',
  })
  return parsed.success ? parsed.data : undefined
}

export interface ResolvedSolarPresent {
  artifact?: ExperienceArtifact
  preview?: SolarPresentPreview
}

/** Durable result metadata wins over an active source preview. */
export function resolveSolarPresent(input: { meta?: unknown, name?: unknown, kind?: unknown, isError?: unknown, argsRaw?: unknown, sessionId: string, callId: string }): ResolvedSolarPresent {
  const artifact = artifactFromPresentationMeta(input)
  return artifact ? { artifact } : { ...(input.isError ? {} : { preview: activeSolarPresentPreview(input) }) }
}

export function temporaryDilArtifact(input: { sessionId: string, callId: string, label: string, source: string, payload: DILPayload }): ExperienceArtifact {
  return {
    formatVersion: 1,
    // This is an in-memory identity only; it is never sent to artifact/state storage.
    id: `stream:${input.callId}`,
    createdAt: '',
    source: { sessionId: input.sessionId, callId: input.callId, kind: 'tool', label: input.label },
    protocol: 'dil',
    raw: input.source,
    payload: input.payload,
    providerId: 'solar-present-preview',
  }
}

export interface DilStreamingPreviewProps {
  enabled: boolean
  api?: DilPreviewApi
  /** A settled Host artifact replaces the temporary preview without changing call identity. */
  artifact?: ExperienceArtifact
  sessionId: string
  callId: string
  label: string
  source: string
  renderArtifact(artifact: ExperienceArtifact, durable: boolean): ReactElement
}

/**
 * Compiles a temporary DIL tool source through the Host after a short debounce.
 * A newer source, session, API, disable action, or unmount logically cancels an
 * older request because the declared RPC has no browser AbortSignal parameter.
 */
export function DilStreamingPreview({ enabled, api, artifact, sessionId, callId, label, source, renderArtifact }: DilStreamingPreviewProps): ReactElement | null {
  const identity = sessionId + '\u0000' + callId
  const [payload, setPayload] = useState<DILPayload>()
  const [failure, setFailure] = useState('')
  const [pendingSource, setPendingSource] = useState<string>()
  const generation = useRef(0)
  const payloadIdentity = useRef(identity)
  useEffect(() => {
    const request = ++generation.current
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const identityChanged = payloadIdentity.current !== identity
    if (identityChanged || !enabled) {
      payloadIdentity.current = identity
      setPayload(undefined)
    }
    setFailure('')
    if (artifact || !enabled || !api || source === '') {
      setPendingSource(undefined)
      return () => { active = false }
    }
    setPendingSource(source)
    timer = setTimeout(() => {
      void api.dilCompilePreview({ sessionId, source }).then(result => {
        if (!active || generation.current !== request) return
        if (result.payload.source !== source) {
          setFailure('DIL 预览返回的源文本与当前工具调用不一致。')
          setPendingSource(undefined)
          return
        }
        setPayload(result.payload)
        setPendingSource(undefined)
      }, error => {
        if (active && generation.current === request) {
          setFailure(`DIL 预览编译失败：${error instanceof Error ? error.message : String(error)}`)
          setPendingSource(undefined)
        }
      })
    }, DIL_PREVIEW_DEBOUNCE_MS)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [identity, api, enabled, sessionId, source, artifact?.id])
  const shell = (...children: ReactElement[]) => h('div', { 'data-dil-streaming-preview': 'true' }, ...children)
  if (artifact) return shell(renderArtifact(artifact, true))
  // Keep the old compiled source paired with its own program until the newest
  // Host compile succeeds. The keyed ArtifactView therefore stays mounted.
  const retained = payloadIdentity.current === identity && payload && temporaryDilArtifact({ sessionId, callId, label, source: payload.source, payload })
  if (!enabled) {
    return retained
      ? shell(renderArtifact(retained, false), h('p', { role: 'status' }, '内容块智能布局实验已关闭，已停止临时界面程序。'))
      : shell(h('p', { role: 'status' }, '内容块智能布局实验已关闭，未编译临时 DIL 源。'), h('pre', null, source))
  }
  if (!api) return retained ? shell(renderArtifact(retained, false), h('p', { role: 'status' }, 'DIL 预览服务不可用，仍显示上一版界面。')) : shell(h('p', { role: 'status' }, 'DIL 预览服务不可用。'))
  if (source === '') return retained ? shell(renderArtifact(retained, false), h('p', { role: 'status' }, '正在等待新的 DIL 源文本，仍显示上一版界面。')) : shell(h('p', { role: 'status' }, '正在等待 DIL 源文本…'))
  if (retained) return shell(
    renderArtifact(retained, false),
    ...(pendingSource ? [h('details', { key: 'pending' }, h('summary', null, '正在更新 DIL 预览，仍显示上一版界面。'), h('pre', null, source))] : []),
    ...(failure ? [h('details', { key: 'failure', open: true }, h('summary', { role: 'alert' }, failure + ' 仍显示上一版界面。'), h('pre', null, source))] : []),
  )
  if (failure) return shell(h('p', { role: 'alert' }, failure), h('pre', null, source))
  return shell(h('p', { role: 'status' }, '正在编译 DIL 预览…'))
}
