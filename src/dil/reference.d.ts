/**
 * Build-time aliases into the fixed yunyv Git dependency. These declarations
 * intentionally describe only the three imported seams, so TypeScript does
 * not traverse the reference package's Host-only compiler source.
 */
declare module '@solar-ui/dil-reference/compiler' {
  export interface ReferenceCompiledDil {
    readonly ok: unknown
    readonly protocolVersion: unknown
    readonly source: unknown
    readonly sourceLength: unknown
    readonly code: unknown
    readonly codeLength: unknown
    readonly constants: unknown
    readonly constantCount: unknown
    readonly requiredComponents: unknown
    readonly appData: unknown
    readonly genuiComponents: unknown
    readonly stateKeys: unknown
    readonly fallbackMarkdown: unknown
    readonly diagnostics: unknown
    readonly diagnosticSummary: unknown
    readonly durationMs: unknown
    readonly compiledAt: unknown
  }
  export function compileDil(source: string, options?: unknown): ReferenceCompiledDil
  export const PROTOCOL_VERSION: number
}

declare module '@solar-ui/dil-reference/frame' {
  /** No override is exposed: callers always use the reference default CSP. */
  export function buildRunnerHtml(): string
  export const DIL_FRAME_CSP: string
}

declare module '@solar-ui/dil-reference/sandbox' {
  export interface ReferenceDilError { readonly name?: string; readonly message: string; readonly stack?: string }
  export interface ReferenceDilSandboxSnapshot {
    readonly tree: unknown | null
    readonly version: number
    readonly reason?: string | null
    readonly error?: ReferenceDilError | null
    readonly stats?: unknown | null
  }
  export interface ReferenceDilRunnerPayload {
    readonly compiledDil: string
    readonly constants?: Readonly<Record<string, unknown>>
    readonly appData?: unknown
    readonly initialState?: Record<string, unknown> | null
  }
  export interface DilSandboxOptions {
    readonly frameUrl?: string
    readonly container?: Node | null
    readonly srcdoc?: string
    readonly onSnapshot?: (message: ReferenceDilSandboxSnapshot) => void
    readonly onStateChange?: (state: Record<string, unknown>, scope: string, reason?: string) => void
    readonly onFailure?: (error: ReferenceDilError, stage: string) => void
  }
  export class DilSandbox {
    constructor(options?: DilSandboxOptions)
    readonly connected: boolean
    connect(): Promise<DilSandbox>
    createRunner(runnerId: string, payload: ReferenceDilRunnerPayload): void
    setCompiledDil(payload: Omit<ReferenceDilRunnerPayload, 'initialState'>): void
    trigger(fnId: string, args?: readonly unknown[]): void
    requestState(): void
    dispose(): void
  }
}
