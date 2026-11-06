export const DIL_DOCUMENT_REVIEW_FORMAT_VERSION = 1

function fail(code) { throw new Error(`DIL_DOCUMENT_REVIEW_MANIFEST_${code}`) }
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function string(value, code) { if (typeof value !== 'string') fail(code); return value }
function integer(value, code) { if (!Number.isSafeInteger(value) || value < 0) fail(code); return value }
function stringArray(value, code) { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(code); return [...value] }

function block(value, documentIndex, blockIndex) {
  if (!record(value)) fail(`BLOCK_${documentIndex}_${blockIndex}_OBJECT`)
  const start = integer(value.start, `BLOCK_${documentIndex}_${blockIndex}_START`)
  const end = integer(value.end, `BLOCK_${documentIndex}_${blockIndex}_END`)
  if (end < start) fail(`BLOCK_${documentIndex}_${blockIndex}_RANGE`)
  const status = string(value.status, `BLOCK_${documentIndex}_${blockIndex}_STATUS`)
  if (!['ready', 'failed', 'pending'].includes(status)) fail(`BLOCK_${documentIndex}_${blockIndex}_STATUS_VALUE`)
  const choice = record(value.choice)
    ? {
      components: stringArray(value.choice.components, `BLOCK_${documentIndex}_${blockIndex}_COMPONENTS`),
      reason: string(value.choice.reason, `BLOCK_${documentIndex}_${blockIndex}_REASON`),
      dilSource: string(value.choice.dilSource, `BLOCK_${documentIndex}_${blockIndex}_DIL_SOURCE`),
    }
    : { components: [], reason: '', dilSource: '' }
  return {
    id: string(value.id, `BLOCK_${documentIndex}_${blockIndex}_ID`),
    start,
    end,
    kind: string(value.kind, `BLOCK_${documentIndex}_${blockIndex}_KIND`),
    source: string(value.source, `BLOCK_${documentIndex}_${blockIndex}_SOURCE`),
    choice,
    ...(value.compiled === undefined ? {} : { compiled: value.compiled }),
    ...(value.bindings === undefined ? {} : { bindings: value.bindings }),
    ...(value.sourceSha256 === undefined ? {} : { sourceSha256: value.sourceSha256 }),
    status,
    ...(value.diagnostics === undefined ? {} : { diagnostics: stringArray(value.diagnostics, `BLOCK_${documentIndex}_${blockIndex}_DIAGNOSTICS`) }),
  }
}

/** Parse the generated local manifest without inventing a document, model choice, or status. */
export function parseDilDocumentReviewManifest(value) {
  if (!record(value) || value.formatVersion !== DIL_DOCUMENT_REVIEW_FORMAT_VERSION) fail('FORMAT')
  if (!record(value.session)) fail('SESSION')
  if (!Array.isArray(value.documents)) fail('DOCUMENTS')
  return {
    formatVersion: DIL_DOCUMENT_REVIEW_FORMAT_VERSION,
    session: {
      id: string(value.session.id, 'SESSION_ID'),
      model: string(value.session.model, 'SESSION_MODEL'),
      provider: string(value.session.provider, 'SESSION_PROVIDER'),
    },
    documents: value.documents.map((item, documentIndex) => {
      if (!record(item)) fail(`DOCUMENT_${documentIndex}_OBJECT`)
      if (!Array.isArray(item.blocks)) fail(`DOCUMENT_${documentIndex}_BLOCKS`)
      return {
        id: string(item.id, `DOCUMENT_${documentIndex}_ID`),
        fileName: string(item.fileName, `DOCUMENT_${documentIndex}_FILE_NAME`),
        title: string(item.title, `DOCUMENT_${documentIndex}_TITLE`),
        sha256: string(item.sha256, `DOCUMENT_${documentIndex}_SHA256`),
        raw: string(item.raw, `DOCUMENT_${documentIndex}_RAW`),
        ...(item.themeId === undefined ? {} : { themeId: string(item.themeId, `DOCUMENT_${documentIndex}_THEME`) }),
        blocks: item.blocks.map((candidate, blockIndex) => block(candidate, documentIndex, blockIndex)),
      }
    }),
    ...(value.settings === undefined ? {} : { settings: value.settings }),
  }
}
