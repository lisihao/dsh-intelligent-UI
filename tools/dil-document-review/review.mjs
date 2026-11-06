import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { startDilDocumentReview } from './preview.mjs'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const defaultEvidenceDirectory = resolve(projectRoot, '.acceptance/dil-document-review')
const cdpModule = process.env.DIL_DOCUMENT_REVIEW_CDP || join(homedir(), '.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs')

function parseArgs(argv) {
  const values = { rootDir: process.cwd(), manifest: process.env.DIL_DOCUMENT_REVIEW_MANIFEST, output: defaultEvidenceDirectory, documentId: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index], value = argv[index + 1]
    if (key === '--rootDir' && value) { values.rootDir = value; index += 1; continue }
    if (key === '--manifest' && value) { values.manifest = value; index += 1; continue }
    if (key === '--output' && value) { values.output = value; index += 1; continue }
    if (key === '--documentId' && value) { values.documentId = value; index += 1; continue }
    if (key === '--help') {
      process.stdout.write('Usage: node tools/dil-document-review/review.mjs [--rootDir <directory>] [--manifest <relative-json>] [--documentId <manifest-document-id>] [--output <ignored-directory>]\n')
      process.exit(0)
    }
    throw new Error(`DIL_DOCUMENT_REVIEW_ARGUMENT_INVALID:${String(key)}`)
  }
  return { rootDir: resolve(values.rootDir), manifest: values.manifest, output: resolve(values.output), documentId: values.documentId }
}

async function waitFor(label, action, sleep, timeoutMs = 15_000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await action()
    if (last) return last
    await sleep(80)
  }
  throw new Error(`DIL_DOCUMENT_REVIEW_TIMEOUT:${label}:${JSON.stringify(last ?? null)}`)
}

async function pointFor(page, selector) {
  return page.eval(selectorValue => {
    const element = document.querySelector(selectorValue)
    if (!(element instanceof HTMLElement)) return undefined
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
  }, selector)
}

async function click(page, selector) {
  const point = await pointFor(page, selector)
  assert.ok(point, `DIL_DOCUMENT_REVIEW_CONTROL_MISSING:${selector}`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

async function snapshot(page) {
  return page.eval(() => {
    const root = document.querySelector('[data-review-state]')
    const active = root?.querySelector('[data-review-active-block]')
    const iframeCount = root?.querySelectorAll('iframe[data-dil-sandbox="true"]').length ?? 0
    return {
      state: root?.getAttribute('data-review-state') ?? null,
      documentIndex: root?.querySelector('[data-review-document-index]')?.getAttribute('data-review-document-index') ?? null,
      activeIndex: active?.getAttribute('data-review-active-block-index') ?? null,
      activeStatus: active?.getAttribute('data-review-status') ?? null,
      nativeTree: Boolean(active?.querySelector('[data-dil-native-tree]')),
      fallback: Boolean(active?.querySelector('[data-dil-fallback]')),
      fallbackText: active?.querySelector('[data-dil-fallback]')?.textContent ?? '',
      iframeCount,
      tags: [...(active?.querySelectorAll('[data-dil-tag]') ?? [])].map(node => node.getAttribute('data-dil-tag')).filter(Boolean),
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      text: root?.textContent ?? '',
    }
  })
}

function addTags(counts, tags) {
  for (const tag of tags) counts[tag] = (counts[tag] ?? 0) + 1
}

async function selectDocument(page, documentIndex, sleep) {
  await click(page, `[data-review-document-picker-index="${String(documentIndex)}"]`)
  await waitFor(`document ${String(documentIndex)} selected`, async () => {
    const current = await snapshot(page)
    return current.documentIndex === String(documentIndex) ? current : undefined
  }, sleep)
}

async function reviewReadyViewport(browser, origin, manifest, width, outputDirectory, sleep, documentId) {
  const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width === 390 })
  const tagCounts = Object.create(null)
  const failures = []
  const statusCounts = { ready: 0, failed: 0, pending: 0 }
  let actualMounts = 0
  let readyBlocks = 0
  try {
    await page.goto(origin)
    await waitFor(`review root ${String(width)}px`, async () => (await snapshot(page)).state === 'ready', sleep)
    const documentIndexes = manifest.documents.flatMap((document, index) => !documentId || document.id === documentId ? [index] : [])
    if (!documentIndexes.length) throw new Error(`DIL_DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND:${documentId}`)
    for (const documentIndex of documentIndexes) {
      const document = manifest.documents[documentIndex]
      if (!document) continue
      await selectDocument(page, documentIndex, sleep)
      const listCount = await page.eval(() => document.querySelectorAll('[data-review-block-index]').length)
      assert.equal(listCount, document.blocks.length, `block list mismatch for document ${String(documentIndex)} at ${String(width)}px`)
      for (let blockIndex = 0; blockIndex < document.blocks.length; blockIndex += 1) {
        const block = document.blocks[blockIndex]
        if (!block) continue
        statusCounts[block.status] += 1
        if (document.raw.slice(block.start, block.end) !== block.source) {
          failures.push({ documentIndex, blockIndex, type: 'source-range-mismatch', message: `declared ${String(block.start)}-${String(block.end)} does not match source text` })
        }
        await click(page, `[data-review-document-index="${String(documentIndex)}"] [data-review-block-index="${String(blockIndex)}"] > button`)
        const active = await waitFor(`block ${String(documentIndex)}:${String(blockIndex)} opens`, async () => {
          const current = await snapshot(page)
          return current.activeIndex === String(blockIndex) ? current : undefined
        }, sleep)
        assert.ok(active.iframeCount <= 1, `more than one Worker iframe after block ${String(documentIndex)}:${String(blockIndex)}`)
        if (width === 390) assert.ok(active.pageScrollWidth <= active.pageClientWidth, `narrow overflow at block ${String(documentIndex)}:${String(blockIndex)}: ${String(active.pageScrollWidth)}/${String(active.pageClientWidth)}`)
        if (block.status === 'ready' && block.compiled) {
          readyBlocks += 1
          const rendered = await waitFor(`ready block ${String(documentIndex)}:${String(blockIndex)} mounts`, async () => {
            const current = await snapshot(page)
            return current.nativeTree || current.fallback ? current : undefined
          }, sleep)
          actualMounts += 1
          addTags(tagCounts, rendered.tags)
          if (rendered.fallback) failures.push({ documentIndex, blockIndex, type: 'runtime-fallback', message: rendered.fallbackText.slice(0, 300) })
        } else if (block.status === 'failed') {
          failures.push({ documentIndex, blockIndex, type: block.status, message: active.fallbackText.slice(0, 300) })
        } else if (block.status === 'ready') {
          failures.push({ documentIndex, blockIndex, type: 'compiled-missing', message: active.fallbackText.slice(0, 300) })
        }
      }
    }
    await page.screenshot({ path: join(outputDirectory, `review-${String(width)}.png`), format: 'png', fullPage: true })
    return { width, actualMounts, readyBlocks, statusCounts, tagCounts, failures, reviewedDocuments: documentIndexes.length }
  } finally { await page.close() }
}

async function reviewPendingViewport(browser, origin, width, outputDirectory, sleep) {
  const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width === 390 })
  try {
    await page.goto(origin)
    const pending = await waitFor(`pending root ${String(width)}px`, async () => {
      const current = await snapshot(page)
      return current.state === 'pending' ? current : undefined
    }, sleep)
    assert.equal(pending.iframeCount, 0)
    assert.match(pending.text, /未调用模型|没有调用模型|等待本地 manifest|等待生成结果/)
    assert.ok(pending.pageScrollWidth <= pending.pageClientWidth)
    await page.screenshot({ path: join(outputDirectory, `review-${String(width)}.png`), format: 'png', fullPage: true })
    return { width, pending: true }
  } finally { await page.close() }
}

/** Browser-review one real local manifest; it never generates, recompiles, or submits content. */
export async function runDilDocumentReview(options = {}) {
  if (!existsSync(cdpModule)) throw new Error(`DIL_DOCUMENT_REVIEW_CDP_MISSING: set DIL_DOCUMENT_REVIEW_CDP (checked ${cdpModule}).`)
  const { Browser, sleep } = await import(pathToFileURL(cdpModule).href)
  const outputDirectory = resolve(options.output ?? defaultEvidenceDirectory)
  const review = await startDilDocumentReview({ rootDir: options.rootDir, manifest: options.manifest })
  let browser
  try {
    const parent = await fetch(review.origin)
    const parentCsp = parent.headers.get('content-security-policy') ?? ''
    assert.equal(parent.status, 200)
    assert.ok(!/unsafe-eval/iu.test(parentCsp), `review parent CSP permits eval: ${parentCsp}`)
    const config = await (await fetch(`${review.origin}/api/review`)).json()
    await mkdir(outputDirectory, { recursive: true })
    browser = await Browser.launch({ width: 1440, height: 900 })
    const viewports = []
    const selectedDocuments = config.state === 'ready'
      ? config.manifest.documents.filter(document => !options.documentId || document.id === options.documentId)
      : []
    for (const width of [1440, 390]) {
      viewports.push(config.state === 'ready'
        ? await reviewReadyViewport(browser, review.origin, config.manifest, width, outputDirectory, sleep, options.documentId)
        : await reviewPendingViewport(browser, review.origin, width, outputDirectory, sleep))
    }
    const serverEvidence = await (await fetch(`${review.origin}/api/evidence`)).json()
    assert.equal(serverEvidence.modelCalls, 0)
    const receipt = {
      formatVersion: 1,
      kind: 'dil-document-review',
      generatedAt: new Date().toISOString(),
      state: config.state,
      modelCalls: 0,
      parentCsp,
      manifestDocuments: config.state === 'ready' ? config.manifest.documents.length : 0,
      manifestBlocks: config.state === 'ready' ? config.manifest.documents.reduce((sum, document) => sum + document.blocks.length, 0) : 0,
      documents: selectedDocuments.length,
      blocks: selectedDocuments.reduce((sum, document) => sum + document.blocks.length, 0),
      viewports,
      screenshots: ['review-1440.png', 'review-390.png'],
      limitations: ['Review reads one local manifest. It is not evidence of a model call or installed Desktop runtime.'],
    }
    await writeFile(join(outputDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8')
    return receipt
  } finally {
    await browser?.close()
    await review.close()
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2))
  const receipt = await runDilDocumentReview(options)
  process.stdout.write(`DIL_DOCUMENT_REVIEW_RECEIPT=${JSON.stringify({ state: receipt.state, documents: receipt.documents, blocks: receipt.blocks })}\n`)
}
