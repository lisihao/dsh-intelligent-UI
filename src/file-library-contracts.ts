import type { ExperienceArtifact } from './contracts.js'

/** Plugin-owned artifact bucket for new library files; this is not a DSH Session. */
export const LOCAL_FILE_SCOPE = 'library:intelligent-ui:files'
export const LOCAL_IMPORT_PROVIDER = 'local-import'

/**
 * Recognize files written by the library and the previous importer. Legacy
 * records have no dedicated type; their exact provider/label convention gives
 * bounded compatibility, not a general classifier for generated content.
 */
export function isLocalImport(artifact: ExperienceArtifact): boolean {
  return artifact.protocol === 'content' && artifact.source.kind === 'generated' && (
    artifact.providerId === LOCAL_IMPORT_PROVIDER ||
    (artifact.providerId === 'content' && artifact.source.label.startsWith('本地导入：'))
  )
}
