import type { Context } from '@deepseek-ai/cordis'
import { compileDilSource, MAX_DIL_SOURCE_BYTES } from './compiler.js'
import { startDilFrameServer } from './frame-server.js'
import {
  DIL_PAYLOAD_FORMAT_VERSION,
  DIL_PROTOCOL,
  DIL_REFERENCE_COMMIT,
  DIL_RUNTIME_PROTOCOL_VERSION,
  dilArtifactPayloadSchema,
  dilRuntimeInfoSchema,
  dilSourceSchema,
  type DILPayload,
  type DilRuntimeInfo,
  type ExperienceSettings,
  type ExperienceArtifact,
} from '../contracts.js'
import type { ExperienceStore } from '../store.js'

export interface DilFrameServer {
  frameUrl: string
  close(): Promise<void>
}

export type StartDilFrameServer = () => Promise<DilFrameServer>

export class DilDisabledError extends Error {
  readonly code = 'DIL_DISABLED'
  constructor() {
    super('DIL_DISABLED: DIL requires adaptive.blockLayout to be enabled.')
    this.name = 'DilDisabledError'
  }
}

export class DilSourceTooLargeError extends Error {
  readonly code = 'DIL_SOURCE_TOO_LARGE'
  constructor(readonly actualBytes: number, readonly maxBytes: number) {
    super(`DIL_SOURCE_TOO_LARGE: DIL source is ${String(actualBytes)} bytes; the limit is ${String(maxBytes)} bytes.`)
    this.name = 'DilSourceTooLargeError'
  }
}

export class DilPayloadTooLargeError extends Error {
  readonly code = 'DIL_PAYLOAD_TOO_LARGE'
  constructor(readonly actualBytes: number, readonly maxBytes: number) {
    super(`DIL_PAYLOAD_TOO_LARGE: compiled DIL payload is ${String(actualBytes)} bytes; the limit is ${String(maxBytes)} bytes.`)
    this.name = 'DilPayloadTooLargeError'
  }
}

export class DilRuntimeUnavailableError extends Error {
  readonly code = 'DIL_RUNTIME_UNAVAILABLE'
  constructor(message = 'DIL_RUNTIME_UNAVAILABLE: the local DIL frame server is not available.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'DilRuntimeUnavailableError'
  }
}

export type DilHostOptions = Readonly<{
  store: ExperienceStore
  maxArtifactBytes: number
  settings: () => Promise<ExperienceSettings>
}>

export type DilHostDependencies = Readonly<{
  compile: (source: string) => unknown
  startFrameServer: StartDilFrameServer
}>

type SystemPromptPort = {
  section(input: { name: string; order: number; text: () => string }): () => void
}

function jsonByteLength(value: unknown): number {
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('DIL_PAYLOAD_INVALID: compiled DIL payload must be JSON data.')
  return Buffer.byteLength(text)
}

/**
 * Node-only DIL boundary. It validates and persists inert compiler output but
 * never evaluates generated program text; evaluation belongs to the opaque
 * frame served by the separate frame-server module.
 */
export class DilHost {
  private frameServer: Promise<DilFrameServer> | undefined
  private runtimeActive = false
  private readonly compile: (source: string) => unknown
  private readonly startFrameServer: StartDilFrameServer

  constructor(private readonly options: DilHostOptions, dependencies: Partial<DilHostDependencies> = {}) {
    if (!Number.isSafeInteger(options.maxArtifactBytes) || options.maxArtifactBytes < 1)
      throw new RangeError('maxArtifactBytes must be a positive safe integer')
    this.compile = dependencies.compile ?? compileDilSource
    this.startFrameServer = dependencies.startFrameServer ?? startDilFrameServer
  }

  /** Attach disposal to the plugin lifecycle; the loopback server starts on first runtime request. */
  start(): () => void {
    if (this.runtimeActive) return () => undefined
    this.runtimeActive = true
    return () => {
      this.runtimeActive = false
      const started = this.frameServer
      this.frameServer = undefined
      if (started) void started.then(server => server.close()).catch(() => undefined)
    }
  }

  private ensureFrameServer(): Promise<DilFrameServer> {
    if (!this.runtimeActive) throw new DilRuntimeUnavailableError()
    if (!this.frameServer) {
      const started = this.startFrameServer()
      this.frameServer = started
      // runtimeInfo reports startup failure to its caller; this observer only
      // prevents an unobserved rejected lifecycle promise.
      void started.catch(() => undefined)
    }
    return this.frameServer
  }

  private async assertEnabled(): Promise<void> {
    const settings = await this.options.settings()
    if (settings.adaptive?.blockLayout !== true) throw new DilDisabledError()
  }

  private compilePayload(source: string): DILPayload {
    const text = dilSourceSchema.parse(source)
    const maxSourceBytes = Math.min(this.options.maxArtifactBytes, MAX_DIL_SOURCE_BYTES)
    const sourceBytes = Buffer.byteLength(text)
    if (sourceBytes > maxSourceBytes) throw new DilSourceTooLargeError(sourceBytes, maxSourceBytes)
    const payload = dilArtifactPayloadSchema.parse({
      formatVersion: DIL_PAYLOAD_FORMAT_VERSION,
      source: text,
      compiled: this.compile(text),
      referenceCommit: DIL_REFERENCE_COMMIT,
    })
    const bytes = jsonByteLength(payload)
    if (bytes > this.options.maxArtifactBytes) throw new DilPayloadTooLargeError(bytes, this.options.maxArtifactBytes)
    return payload
  }

  /** Compile-only path for streamed tool arguments; it never writes an artifact. */
  async compilePreview(source: string): Promise<DILPayload> {
    await this.assertEnabled()
    return this.compilePayload(source)
  }

  /** Compile source then persist it with its compiler output as one durable artifact. */
  async publish(input: { source: ExperienceArtifact['source']; sourceText: string }): Promise<ExperienceArtifact> {
    const payload = await this.compilePreview(input.sourceText)
    return this.options.store.publishDil({
      source: input.source,
      protocol: DIL_PROTOCOL,
      raw: input.sourceText,
      payload,
      providerId: DIL_PROTOCOL,
    })
  }

  async runtimeInfo(): Promise<DilRuntimeInfo> {
    await this.assertEnabled()
    const running = this.ensureFrameServer()
    try {
      const server = await running
      return dilRuntimeInfoSchema.parse({ protocolVersion: DIL_RUNTIME_PROTOCOL_VERSION, frameUrl: server.frameUrl })
    } catch (error) {
      if (error instanceof DilRuntimeUnavailableError) throw error
      throw new DilRuntimeUnavailableError(undefined, { cause: error })
    }
  }
}

export function installDilHost(ctx: Context, options: DilHostOptions, dependencies?: Partial<DilHostDependencies>): DilHost {
  const host = new DilHost(options, dependencies)
  ctx.effect(() => host.start(), 'intelligent-experience: DIL frame server')
  return host
}

export function dilAuthoringPrompt(settings: ExperienceSettings): string {
  const guidance: string[] = []
  if (settings.takeover && settings.openui) guidance.push('OpenUI Lang remains available for suitable interactive responses; use the existing OpenUI path when it fits the requested UI.')
  if (settings.adaptive?.blockLayout === true) guidance.push('The opt-in DIL lane is available. Read `solar_ui_catalog` with `{ "format": "dil" }` before authoring. Call `solar_present` with `protocol: "dil"` and only the DIL source string in `payload`; never provide compiled JavaScript or HTML.')
  return guidance.join('\n')
}

/** Optional published service: it must never make plugin loading depend on prompt availability. */
export function installDilAuthoringPrompt(ctx: Context, getSettings: () => ExperienceSettings): void {
  ctx.inject(['systemPrompt' as never], child => child.effect(() => {
    const prompt = child.get('systemPrompt' as never) as unknown as SystemPromptPort
    return prompt.section({ name: 'solar-intelligent-experience-dil', order: 3100, text: () => dilAuthoringPrompt(getSettings()) })
  }, 'intelligent-experience: DIL authoring prompt'))
}
