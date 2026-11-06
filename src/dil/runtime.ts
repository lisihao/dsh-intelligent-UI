import { buildRunnerHtml } from '@solar-ui/dil-reference/frame'
import { DilSandbox } from '@solar-ui/dil-reference/sandbox'

import {
  DilProtocolError,
  validateCompiledDil,
  validateDilTree,
  type CompiledDil,
  type DilJson,
  type DilNode,
} from './protocol.js'

export interface DilRunnerOptions {
  readonly container: Node
  /** Trusted packaged runner URL; when present no srcdoc/CSP override is used. */
  readonly frameUrl?: string
  readonly initialState?: Record<string, unknown>
  /** A validated non-null DIL tree; reference transport metadata stays internal. */
  readonly onSnapshot: (tree: DilNode) => void
  readonly onStateChange: (state: Record<string, DilJson>, scope: string, reason?: string) => void
  readonly onFailure: (error: DilRunnerError | DilProtocolError, stage: string) => void
}

export interface DilRunner {
  start(compiled: CompiledDil): Promise<void>
  update(compiled: CompiledDil): void
  trigger(fnId: string, args: unknown[]): void
  /** Read the Worker state after previously posted control events. */
  captureState(): Promise<Record<string, DilJson>>
  dispose(): void
}

export type DilRunnerErrorCode =
  | 'DIL_RUNNER_DISPOSED' | 'DIL_RUNNER_ALREADY_STARTED' | 'DIL_RUNNER_NOT_STARTED'
  | 'DIL_RUNNER_FRAME_URL_INVALID' | 'DIL_RUNNER_COMPILED_INVALID'
  | 'DIL_RUNNER_STATE_INVALID' | 'DIL_RUNNER_ARGS_INVALID' | 'DIL_RUNNER_HANDLER_INVALID'
  | 'DIL_RUNNER_REFERENCE_FAILURE' | 'DIL_RUNNER_STATE_TIMEOUT'

export class DilRunnerError extends Error {
  readonly code: DilRunnerErrorCode
  constructor(code: DilRunnerErrorCode, message: string) { super(message); this.name = 'DilRunnerError'; this.code = code }
}

const encoder = new TextEncoder()
const MAX_BOUNDARY_JSON_BYTES = 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function cloneJson(value: unknown, code: 'DIL_RUNNER_STATE_INVALID' | 'DIL_RUNNER_ARGS_INVALID', ancestors = new WeakSet<object>(), depth = 0): DilJson {
  if (depth > 64) throw new DilRunnerError(code, 'DIL runtime boundary data exceeds the nesting limit.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new DilRunnerError(code, 'DIL runtime boundary contains a non-finite number.'); return value }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new DilRunnerError(code, 'DIL runtime boundary data contains a cycle.')
    ancestors.add(value); try { return value.map(item => cloneJson(item, code, ancestors, depth + 1)) } finally { ancestors.delete(value) }
  }
  if (!isRecord(value)) throw new DilRunnerError(code, 'DIL runtime boundary data is not JSON-compatible.')
  if (ancestors.has(value)) throw new DilRunnerError(code, 'DIL runtime boundary data contains a cycle.')
  ancestors.add(value)
  try {
    const output = Object.create(null) as Record<string, DilJson>
    for (const [key, item] of Object.entries(value)) output[key] = cloneJson(item, code, ancestors, depth + 1)
    return output
  } finally { ancestors.delete(value) }
}
function checkedBytes(value: DilJson, code: 'DIL_RUNNER_STATE_INVALID' | 'DIL_RUNNER_ARGS_INVALID'): void {
  const text = JSON.stringify(value)
  if (encoder.encode(text).byteLength > MAX_BOUNDARY_JSON_BYTES) throw new DilRunnerError(code, `DIL runtime boundary data exceeds ${String(MAX_BOUNDARY_JSON_BYTES)} bytes.`)
}
function state(value: unknown): Record<string, DilJson> {
  const cloned = cloneJson(value, 'DIL_RUNNER_STATE_INVALID')
  if (!isRecord(cloned)) throw new DilRunnerError('DIL_RUNNER_STATE_INVALID', 'DIL state must be an object.')
  checkedBytes(cloned, 'DIL_RUNNER_STATE_INVALID')
  return cloned as Record<string, DilJson>
}
function args(value: readonly unknown[]): unknown[] {
  const cloned = cloneJson(value, 'DIL_RUNNER_ARGS_INVALID')
  if (!Array.isArray(cloned)) throw new DilRunnerError('DIL_RUNNER_ARGS_INVALID', 'DIL handler args must be an array.')
  checkedBytes(cloned, 'DIL_RUNNER_ARGS_INVALID')
  return [...cloned]
}
function id(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `dil-${random}`
}
function handlerId(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value) }

/**
 * Use the reference's intact frame/Worker envelope. This adapter deliberately
 * provides no host-page eval, custom CSP, worker-source, or renderer override.
 */
export function createDilRunner(options: DilRunnerOptions): DilRunner {
  let sandbox: DilSandbox | undefined
  let started = false
  let disposed = false
  let quarantined = false
  let stateCapture: Promise<Record<string, DilJson>> | undefined
  let rejectCapture: ((error: Error) => void) | undefined

  const report = (error: DilRunnerError | DilProtocolError, stage: string): void => {
    rejectCapture?.(error)
    try { options.onFailure(error, stage) } catch { /* Observer faults must not revive the runner. */ }
  }
  const quarantine = (error: DilRunnerError | DilProtocolError, stage: string): void => {
    if (quarantined) return
    quarantined = true
    sandbox?.dispose()
    report(error, stage)
  }
  const active = (): DilSandbox => {
    if (disposed) throw new DilRunnerError('DIL_RUNNER_DISPOSED', 'DIL runner is disposed.')
    if (quarantined) throw new DilRunnerError('DIL_RUNNER_DISPOSED', 'DIL runner was quarantined after a boundary failure.')
    if (!started || !sandbox) throw new DilRunnerError('DIL_RUNNER_NOT_STARTED', 'DIL runner has not started.')
    return sandbox
  }
  const payload = (compiled: CompiledDil, initialState?: Record<string, DilJson>) => ({
    compiledDil: compiled.code,
    constants: compiled.constants,
    appData: compiled.appData,
    ...(initialState === undefined ? {} : { initialState }),
  })
  const checkedCompiled = (value: CompiledDil): CompiledDil => {
    try { return validateCompiledDil(value) }
    catch (error) {
      if (error instanceof DilProtocolError) throw error
      throw new DilRunnerError('DIL_RUNNER_COMPILED_INVALID', `DIL compiled payload is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    async start(compiled: CompiledDil): Promise<void> {
      if (disposed) throw new DilRunnerError('DIL_RUNNER_DISPOSED', 'DIL runner is disposed.')
      if (started) throw new DilRunnerError('DIL_RUNNER_ALREADY_STARTED', 'DIL runner already started.')
      const safeCompiled = checkedCompiled(compiled)
      const initialState = options.initialState === undefined ? undefined : state(options.initialState)
      const frameUrl = options.frameUrl
      if (frameUrl !== undefined && !frameUrl.trim()) throw new DilRunnerError('DIL_RUNNER_FRAME_URL_INVALID', 'DIL frameUrl must be a nonempty trusted runner URL.')
      sandbox = new DilSandbox({
        container: options.container,
        ...(frameUrl === undefined ? { srcdoc: buildRunnerHtml() } : { frameUrl }),
        onSnapshot: (snapshot) => {
          if (snapshot.error) { report(new DilRunnerError('DIL_RUNNER_REFERENCE_FAILURE', snapshot.error.message), 'snapshot'); return }
          if (snapshot.tree === null) return
          try {
            options.onSnapshot(validateDilTree(snapshot.tree))
          } catch (error) {
            quarantine(error instanceof DilProtocolError ? error : new DilRunnerError('DIL_RUNNER_REFERENCE_FAILURE', `DIL snapshot validation failed: ${error instanceof Error ? error.message : String(error)}`), 'protocol')
          }
        },
        onStateChange: (next, scope, reason) => {
          try { options.onStateChange(state(next), scope, reason) }
          catch (error) {
            quarantine(error instanceof DilRunnerError ? error : new DilRunnerError('DIL_RUNNER_STATE_INVALID', `DIL state validation failed: ${error instanceof Error ? error.message : String(error)}`), 'state')
          }
        },
        onFailure: (error, stage) => report(new DilRunnerError('DIL_RUNNER_REFERENCE_FAILURE', error.message), stage),
      })
      try {
        await sandbox.connect()
        if (disposed) { sandbox.dispose(); return }
        sandbox.createRunner(id(), payload(safeCompiled, initialState))
        started = true
      } catch (error) {
        sandbox.dispose()
        sandbox = undefined
        const failure = error instanceof DilRunnerError || error instanceof DilProtocolError
          ? error : new DilRunnerError('DIL_RUNNER_REFERENCE_FAILURE', `DIL sandbox could not start: ${error instanceof Error ? error.message : String(error)}`)
        report(failure, 'connect')
        throw failure
      }
    },
    update(compiled: CompiledDil): void {
      active().setCompiledDil(payload(checkedCompiled(compiled)))
    },
    trigger(fnId: string, values: unknown[]): void {
      if (!handlerId(fnId)) throw new DilRunnerError('DIL_RUNNER_HANDLER_INVALID', 'DIL handler id is invalid.')
      active().trigger(fnId, args(values))
    },
    captureState(): Promise<Record<string, DilJson>> {
      if (stateCapture) return stateCapture
      const instance = active()
      const host = options.container as Node & ParentNode
      const frame = host.querySelector?.('iframe')
      const view = options.container.ownerDocument?.defaultView
      if (!view || !frame?.contentWindow) throw new DilRunnerError('DIL_RUNNER_NOT_STARTED', 'DIL state capture requires its owned frame.')
      const target = frame.contentWindow
      // The reference exposes requestState but not a stateSnapshot callback.
      // Observe only this owned opaque frame's versioned response; no reference
      // source or protocol is patched. FIFO commands put this read after controls.
      const capture = new Promise<Record<string, DilJson>>((resolve, reject) => {
        let complete = false
        const finish = (error?: Error, next?: Record<string, DilJson>): void => {
          if (complete) return
          complete = true
          clearTimeout(timer)
          view.removeEventListener('message', receive)
          rejectCapture = undefined
          if (error) reject(error)
          else resolve(next!)
        }
        const receive = (event: MessageEvent): void => {
          if (event.source !== target || event.origin !== 'null') return
          const data: unknown = event.data
          if (!isRecord(data) || data.__dilFrame !== true || data.protocolVersion !== 1 || data.kind !== 'stateSnapshot') return
          try { finish(undefined, state(data.state)) }
          catch (error) { finish(error instanceof Error ? error : new DilRunnerError('DIL_RUNNER_STATE_INVALID', String(error))) }
        }
        const timer = setTimeout(() => finish(new DilRunnerError('DIL_RUNNER_STATE_TIMEOUT', 'DIL state capture did not complete; nothing was submitted.')), 2000)
        rejectCapture = error => finish(error)
        view.addEventListener('message', receive)
        try { instance.requestState() } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
      })
      stateCapture = capture.finally(() => { stateCapture = undefined })
      return stateCapture
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      rejectCapture?.(new DilRunnerError('DIL_RUNNER_DISPOSED', 'DIL runner was disposed before state capture completed.'))
      sandbox?.dispose()
      sandbox = undefined
    },
  }
}
