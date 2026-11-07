import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { startDilDocumentReview } from '../tools/dil-document-review/preview.mjs'

const reviewIt = process.env.DIL_DOCUMENT_REVIEW_E2E === '1' ? it : it.skip

function runReview(rootDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/dil-document-review/review.mjs', '--rootDir', rootDir], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`DIL_DOCUMENT_REVIEW_EXIT_${String(code)}\n${output}`)))
  })
}

describe('DIL document review browser entry', () => {
  it('re-reads a manifest after a long-lived preview starts pending', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'dil-document-review-live-'))
    let review: Awaited<ReturnType<typeof startDilDocumentReview>> | undefined
    try {
      review = await startDilDocumentReview({ rootDir, manifest: 'manifest.json' })
      const pending = await (await fetch(`${review.origin}/api/review`)).json()
      expect(pending.state).toBe('pending')
      const manifest = {
        formatVersion: 1,
        session: { id: 'session', model: 'model', provider: 'provider' },
        documents: [{ id: 'document', fileName: 'document.md', title: 'updated title', sha256: 'sha', raw: '', blocks: [] }],
      }
      await writeFile(join(rootDir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
      const ready = await (await fetch(`${review.origin}/api/review`)).json()
      expect(ready.state).toBe('ready')
      expect(ready.manifest.documents[0].title).toBe('updated title')
    } finally {
      await review?.close()
      await rm(rootDir, { recursive: true, force: true })
    }
  }, 90_000)

  reviewIt('shows an honest no-manifest pending view without any model request', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'dil-document-review-'))
    try {
      const output = await runReview(rootDir)
      expect(output).toMatch(/DIL_DOCUMENT_REVIEW_RECEIPT=\{.*"state":"pending".*"blocks":0/s)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  }, 90_000)
})
