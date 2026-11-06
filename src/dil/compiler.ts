import { compileDil as referenceCompileDil } from '@solar-ui/dil-reference/compiler'

import {
  DIL_PROTOCOL_VERSION,
  DilProtocolError,
  validateCompiledDil,
  type CompiledDil,
  type DilJson,
} from './protocol.js'

export { DIL_PROTOCOL_VERSION, type CompiledDil } from './protocol.js'

export const MAX_DIL_SOURCE_BYTES = 128 * 1024

export type DilCompileErrorCode =
  | 'DIL_SOURCE_INVALID'
  | 'DIL_SOURCE_TOO_LARGE'
  | 'DIL_REFERENCE_COMPILE_FAILED'
  | 'DIL_REFERENCE_PROTOCOL_UNSUPPORTED'
  | 'DIL_COMPILED_OUTPUT_INVALID'

export class DilCompileError extends Error {
  readonly code: DilCompileErrorCode

  constructor(code: DilCompileErrorCode, message: string) {
    super(message)
    this.name = 'DilCompileError'
    this.code = code
  }
}

const encoder = new TextEncoder()

/**
 * Compile an explicitly supplied DIL source in the Host RPC path. The result
 * remains inert data; this module never evaluates the generated JavaScript.
 */
export function compileDilSource(source: string, modelDataBindings?: Readonly<Record<string, DilJson>>): CompiledDil {
  if (typeof source !== 'string') throw new DilCompileError('DIL_SOURCE_INVALID', 'DIL source must be a string.')
  const bytes = encoder.encode(source).byteLength
  if (bytes > MAX_DIL_SOURCE_BYTES) {
    throw new DilCompileError('DIL_SOURCE_TOO_LARGE', `DIL source is ${String(bytes)} bytes; the limit is ${String(MAX_DIL_SOURCE_BYTES)} bytes.`)
  }
  try {
    const compiled = validateCompiledDil(referenceCompileDil(source, { modelDataBindings }))
    if (compiled.source !== source) {
      throw new DilCompileError('DIL_COMPILED_OUTPUT_INVALID', 'DIL compiler result source does not match the submitted source.')
    }
    return compiled
  } catch (error) {
    if (error instanceof DilCompileError) throw error
    if (error instanceof DilProtocolError) {
      if (error.code === 'DIL_COMPILED_VERSION_UNSUPPORTED') {
        throw new DilCompileError('DIL_REFERENCE_PROTOCOL_UNSUPPORTED', error.message)
      }
      throw new DilCompileError('DIL_COMPILED_OUTPUT_INVALID', error.message)
    }
    throw new DilCompileError('DIL_REFERENCE_COMPILE_FAILED', `DIL reference compiler failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
