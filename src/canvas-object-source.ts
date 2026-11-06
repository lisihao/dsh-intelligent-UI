import { isEvidenceVisualLabel } from './visual-semantics.js'

export interface CanvasGlbSource { readonly field: string, readonly reference: string, readonly kind?: undefined }
export interface CanvasImageSource { readonly field: string, readonly reference: string, readonly kind: 'image', readonly mime: 'image/png' | 'image/jpeg' }
export type CanvasObjectSource = CanvasGlbSource | CanvasImageSource

const glbTypes = new Set(['glb', 'model/gltf-binary'])

/**
 * Pure structural recognition only. It neither fetches a URL nor declares the
 * bytes trusted; a browser consumer validates the resolved response separately.
 */
export function glbSource(value: unknown): CanvasObjectSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const field = ['url', 'src', 'uri', 'href'].find(key => typeof record[key] === 'string' && (record[key] as string).trim())
  if (!field) return undefined
  const types = [record.mimeType, record.mediaType, record.format, record.type]
    .filter((item): item is string => typeof item === 'string').map(item => item.trim().toLowerCase())
  if (types.some(type => glbTypes.has(type))) return { field, reference: record[field] as string }
  const role = typeof record.role === 'string' ? record.role.trim().toLowerCase() : ''
  if (!['illustration', 'decorative'].includes(role)) return undefined
  const conflictingRole = [record.type, record.kind, record.category, record.purpose, record.alt, record.caption]
    .some(item => typeof item === 'string' && isEvidenceVisualLabel(item))
  if (conflictingRole) return undefined
  const mime = types.find(type => type === 'image/png' || type === 'image/jpeg') as CanvasImageSource['mime'] | undefined
  return mime ? { field, reference: record[field] as string, kind: 'image', mime } : undefined
}
