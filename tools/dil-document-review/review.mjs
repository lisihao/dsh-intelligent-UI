import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { startDilDocumentReview } from './preview.mjs'
import { presentationIssues, summarizeIssues } from './presentation-checks.mjs'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const defaultEvidenceDirectory = resolve(projectRoot, '.acceptance/dil-document-review')
const cdpModule = process.env.DIL_DOCUMENT_REVIEW_CDP || join(homedir(), '.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs')
const defaultViewports = [1440, 768, 390]

function parseWidths(value) {
  const tokens = String(value).split(',').map(item => item.trim())
  const widths = tokens.map(item => Number(item))
  if (!tokens.length || tokens.some(item => !/^\d+$/u.test(item)) || widths.some(width => !Number.isInteger(width) || width < 1 || width > 10_000) || new Set(widths).size !== widths.length) {
    throw new Error(`DIL_DOCUMENT_REVIEW_WIDTHS_INVALID:${String(value)}`)
  }
  return widths
}

function normalizeWidths(value) {
  if (value === undefined) return [...defaultViewports]
  if (Array.isArray(value)) return parseWidths(value.join(','))
  return parseWidths(value)
}

function parseArgs(argv) {
  const values = { rootDir: process.cwd(), manifest: process.env.DIL_DOCUMENT_REVIEW_MANIFEST, output: defaultEvidenceDirectory, documentId: undefined, widths: defaultViewports }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index], value = argv[index + 1]
    if (key === '--rootDir' && value) { values.rootDir = value; index += 1; continue }
    if (key === '--manifest' && value) { values.manifest = value; index += 1; continue }
    if (key === '--output' && value) { values.output = value; index += 1; continue }
    if (key === '--documentId' && value) { values.documentId = value; index += 1; continue }
    if (key === '--widths' && value) { values.widths = parseWidths(value); index += 1; continue }
    if (key === '--help') {
      process.stdout.write('Usage: node tools/dil-document-review/review.mjs [--rootDir <directory>] [--manifest <relative-json>] [--documentId <manifest-document-id>] [--widths <comma-separated-px>] [--output <ignored-directory>]\n')
      process.exit(0)
    }
    throw new Error(`DIL_DOCUMENT_REVIEW_ARGUMENT_INVALID:${String(key)}`)
  }
  return { rootDir: resolve(values.rootDir), manifest: values.manifest, output: resolve(values.output), documentId: values.documentId, widths: values.widths }
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

async function installIframePeakObserver(page) {
  await page.eval(() => {
    const state = { peak: 0 }
    const measure = () => { state.peak = Math.max(state.peak, document.querySelectorAll('iframe[data-dil-sandbox="true"]').length) }
    const observer = new MutationObserver(measure)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    window.__dilDocumentReviewIframeWatch = state
    measure()
  })
}

async function snapshot(page) {
  return page.eval(() => {
    const root = document.querySelector('[data-review-state]')
    const readerBlocks = [...(root?.querySelectorAll('[data-review-reader-block]') ?? [])]
    const active = readerBlocks.find(node => node.hasAttribute('data-review-active-block')) ?? root?.querySelector('[data-review-active-block]')
    const picker = [...(root?.querySelectorAll('[data-review-document-picker-index]') ?? [])].find(node => node.getAttribute('aria-pressed') === 'true')
    const documentSelect = root?.querySelector('[data-review-document-select]')
    const inspector = root?.querySelector('[data-review-inspector]')
    const iframeCount = root?.querySelectorAll('iframe[data-dil-sandbox="true"]').length ?? 0
    const visible = node => {
      if (!(node instanceof HTMLElement)) return false
      const closedDetails = node.closest('details:not([open])')
      if (closedDetails && !node.closest('summary')) return false
      const style = getComputedStyle(node), rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const fitsViewport = node => {
      if (!(node instanceof HTMLElement)) return false
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1
    }
    const first = readerBlocks.slice().sort((left, right) => Number(left.getAttribute('data-review-reader-block')) - Number(right.getAttribute('data-review-reader-block')))[0]
    const firstRect = first?.getBoundingClientRect()
    const loadingSemantic = [...(root?.querySelectorAll('[data-review-progress], [role="status"], [aria-busy="true"]') ?? [])]
      .some(node => visible(node) && /准备|加载|等待|running|queued/iu.test(node.textContent ?? ''))
    const firstScreen = {
      native: Boolean(first && firstRect && firstRect.top < innerHeight && firstRect.bottom > 0 && visible(first.querySelector('[data-dil-native-tree]'))),
      loading: Boolean(first && firstRect && firstRect.top < innerHeight && firstRect.bottom > 0 && loadingSemantic),
    }
    const header = root?.querySelector('.dil-review-app-header, header')
    const title = header?.querySelector('h1')
    const titleStyle = title instanceof HTMLElement ? getComputedStyle(title) : undefined
    const activeRect = active?.getBoundingClientRect()
    const rawPreVisible = [...(root?.querySelectorAll('.dil-review-raw pre') ?? [])].some(visible)
    const sourcePreVisible = [...(root?.querySelectorAll('pre[data-review-source-start]') ?? [])].some(visible)
    const emptyPlaceholderVisible = [...(root?.querySelectorAll('.dil-review-empty, [data-review-empty]') ?? [])].some(visible)
    const shellNodes = [
      root?.querySelector('.dil-review-app-grid'),
      root?.querySelector('.dil-review-workspace'),
      root?.querySelector('.dil-review-document-surface'),
    ].filter(Boolean)
    return {
      state: root?.getAttribute('data-review-state') ?? null,
      rootTagName: root?.tagName ?? null,
      urlDocumentId: new URL(location.href).searchParams.get('document'),
      documentIndex: picker?.getAttribute('data-review-document-picker-index') ?? (documentSelect instanceof HTMLSelectElement ? documentSelect.value : null) ?? root?.querySelector('[data-review-document-index]')?.getAttribute('data-review-document-index') ?? null,
      activeIndex: active?.getAttribute('data-review-active-block-index') ?? null,
      activeStatus: active?.getAttribute('data-review-status') ?? null,
      activeRenderState: active?.getAttribute('data-review-render-state') ?? null,
      sourceCodeRecovery: active?.getAttribute('data-review-recovery') === 'source-code',
      sourceCodeText: active?.querySelector('[data-review-source-preview] pre code')?.textContent ?? '',
      activeMarker: Boolean(active?.hasAttribute('data-review-active-block')),
      activeInViewport: Boolean(activeRect && activeRect.bottom > 0 && activeRect.top < innerHeight),
      activeBounds: activeRect ? { top: activeRect.top, bottom: activeRect.bottom, height: activeRect.height, scrollY } : null,
      nativeTree: Boolean(active?.querySelector('[data-dil-native-tree]')),
      fallback: Boolean(active?.querySelector('[data-dil-fallback]')),
      fallbackText: active?.querySelector('[data-dil-fallback]')?.textContent ?? '',
      iframeCount,
      iframePeak: window.__dilDocumentReviewIframeWatch?.peak ?? iframeCount,
      readerBlockCount: readerBlocks.length,
      readerBlockIndexes: readerBlocks.map(node => node.getAttribute('data-review-reader-block')),
      visibleReaderBlocks: readerBlocks.filter(visible).length,
      renderStates: readerBlocks.map(node => node.getAttribute('data-review-render-state')),
      cacheReadyCount: readerBlocks.filter(node => node.getAttribute('data-review-render-state') === 'ready').length,
      mountedCount: window.__dilDocumentReview?.mounted ?? null,
      inspectorFound: Boolean(inspector),
      inspectorHidden: inspector?.hasAttribute('hidden') ?? null,
      rawDetailsOpen: [...(root?.querySelectorAll('.dil-review-raw') ?? [])].some(node => node.matches('details[open]')),
      rawPreVisible,
      sourcePreVisible,
      emptyPlaceholderVisible,
      firstScreen,
      headerHeight: header instanceof HTMLElement ? header.getBoundingClientRect().height : null,
      headerTitle: title?.textContent ?? '',
      headerTitleFontSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : null,
      shellCount: shellNodes.length,
      shellFits: shellNodes.every(fitsViewport),
      tags: [...(active?.querySelectorAll('[data-dil-tag]') ?? [])].map(node => node.getAttribute('data-dil-tag')).filter(Boolean),
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      text: root?.textContent ?? '',
    }
  })
}

async function inspectorState(page) {
  return page.eval(() => {
    const inspector = document.querySelector('[data-review-inspector]')
    return { found: Boolean(inspector), hidden: inspector?.hasAttribute('hidden') ?? null }
  })
}

async function ensureInspectorOpen(page, sleep) {
  const before = await inspectorState(page)
  assert.equal(before.found, true, 'DIL_DOCUMENT_REVIEW_INSPECTOR_MISSING')
  if (before.hidden) {
    await click(page, '[data-review-inspect-toggle]')
    await waitFor('inspector opens before row click', async () => {
      const current = await inspectorState(page)
      return current.found && current.hidden === false ? current : undefined
    }, sleep)
  }
}

async function waitForDefaultReading(page, document, width, sleep) {
  return waitFor(`default reading ${String(width)}px`, async () => {
    const current = await snapshot(page)
    const expectedIndexes = document.blocks.map((_, index) => String(index))
    const statesValid = current.renderStates.every(state => ['queued', 'running', 'ready', 'failed'].includes(state))
    const firstScreenReady = current.firstScreen.native || current.firstScreen.loading
    const shellFits = current.shellCount === 3 && current.shellFits && current.pageScrollWidth <= current.pageClientWidth
    return current.rootTagName === 'MAIN'
      && current.readerBlockCount === document.blocks.length
      && current.visibleReaderBlocks === document.blocks.length
      && JSON.stringify(current.readerBlockIndexes) === JSON.stringify(expectedIndexes)
      && statesValid
      && firstScreenReady
      && !current.rawDetailsOpen
      && !current.rawPreVisible
      && !current.sourcePreVisible
      && !current.emptyPlaceholderVisible
      && current.inspectorFound
      && current.inspectorHidden === true
      && (current.headerHeight === null || current.headerHeight <= 160)
      && (current.headerTitleFontSize === null || current.headerTitleFontSize <= 32)
      && shellFits
      ? current
      : undefined
  }, sleep)
}

function addTags(counts, tags) {
  for (const tag of tags) counts[tag] = (counts[tag] ?? 0) + 1
}

async function selectDocument(page, documentIndex, documentId, sleep) {
  const controls = await page.eval(index => {
    const button = document.querySelector(`[data-review-document-picker-index="${String(index)}"]`)
    const select = document.querySelector('[data-review-document-select]')
    const visible = node => {
      if (!(node instanceof HTMLElement)) return false
      const style = getComputedStyle(node), rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    return { buttonVisible: visible(button), selectFound: select instanceof HTMLSelectElement, selectVisible: visible(select) }
  }, documentIndex)
  if (controls.buttonVisible) {
    await click(page, `[data-review-document-picker-index="${String(documentIndex)}"]`)
  } else {
    assert.equal(controls.selectFound, true, `DIL_DOCUMENT_REVIEW_DOCUMENT_SELECT_MISSING:${String(documentIndex)}`)
    assert.equal(controls.selectVisible, true, `DIL_DOCUMENT_REVIEW_DOCUMENT_SELECT_HIDDEN:${String(documentIndex)}`)
    const selected = await page.eval(index => {
      const select = document.querySelector('[data-review-document-select]')
      if (!(select instanceof HTMLSelectElement)) return { value: null, options: [] }
      const value = String(index)
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      if (!setter) return { value: select.value, options: [...select.options].map(option => option.value), setter: false }
      setter.call(select, value)
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return { value: select.value, options: [...select.options].map(option => option.value), setter: true }
    }, documentIndex)
    assert.equal(selected.setter, true, `DIL_DOCUMENT_REVIEW_DOCUMENT_SELECT_SETTER_MISSING:${String(documentIndex)}`)
    assert.equal(selected.value, String(documentIndex), `DIL_DOCUMENT_REVIEW_DOCUMENT_SELECT_VALUE_MISMATCH:${String(documentIndex)}`)
  }
  await waitFor(`document ${String(documentIndex)} selected`, async () => {
    const current = await snapshot(page)
    return current.documentIndex === String(documentIndex) && current.urlDocumentId === documentId ? current : undefined
  }, sleep)
}

async function reviewReadyViewport(browser, origin, manifest, width, outputDirectory, sleep, documentId) {
  const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width <= 390 })
  const tagCounts = Object.create(null)
  const failures = []
  const statusCounts = { ready: 0, failed: 0, pending: 0 }
  let actualMounts = 0
  let sourceCodeRecoveries = 0
  let readyBlocks = 0
  try {
    await page.goto(origin)
    await installIframePeakObserver(page)
    await waitFor(`review root ${String(width)}px`, async () => (await snapshot(page)).state === 'ready', sleep)
    const documentIndexes = manifest.documents.flatMap((document, index) => !documentId || document.id === documentId ? [index] : [])
    if (!documentIndexes.length) throw new Error(`DIL_DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND:${documentId}`)
    for (const documentIndex of documentIndexes) {
      const document = manifest.documents[documentIndex]
      if (!document) continue
      await selectDocument(page, documentIndex, document.id, sleep)
      const defaultReading = await waitForDefaultReading(page, document, width, sleep)
      assert.equal(defaultReading.readerBlockCount, document.blocks.length, `reader block count mismatch for document ${String(documentIndex)} at ${String(width)}px`)
      assert.equal(defaultReading.visibleReaderBlocks, document.blocks.length, `reader block visibility mismatch for document ${String(documentIndex)} at ${String(width)}px`)
      assert.equal(defaultReading.shellFits, true, `reader shell/document does not fit at ${String(width)}px`)
      // Inspect a settled document so later snapshots cannot move a selected block.
      await waitFor(`document ${document.id} snapshots settle`, async () => {
        const current = await snapshot(page)
        return current.renderStates.every(state => state === 'ready' || state === 'failed') ? current : undefined
      }, sleep, 60_000)
      const presentation = await page.eval(presentationIssues)
      assert.equal(presentation.length, 0, `presentation issues in document ${String(documentIndex)} at ${String(width)}px: ${JSON.stringify(summarizeIssues(presentation))}`)
      const listShape = await page.eval(() => {
        const rows = [...document.querySelectorAll('[data-review-inspector] [data-review-block-index]')]
        return {
          count: rows.length,
          directButtons: rows.filter(row => row.children.length === 1 && row.children[0] instanceof HTMLButtonElement).length,
        }
      })
      assert.equal(listShape.count, document.blocks.length, `block list mismatch for document ${String(documentIndex)} at ${String(width)}px`)
      assert.equal(listShape.directButtons, document.blocks.length, `inspector rows must each have one direct button for document ${String(documentIndex)} at ${String(width)}px`)
      for (let blockIndex = 0; blockIndex < document.blocks.length; blockIndex += 1) {
        const block = document.blocks[blockIndex]
        if (!block) continue
        statusCounts[block.status] += 1
        if (document.raw.slice(block.start, block.end) !== block.source) {
          failures.push({ documentIndex, blockIndex, type: 'source-range-mismatch', message: `declared ${String(block.start)}-${String(block.end)} does not match source text` })
        }
        await ensureInspectorOpen(page, sleep)
        await click(page, `[data-review-inspector] [data-review-block-index="${String(blockIndex)}"] > button`)
        const active = await waitFor(`block ${String(documentIndex)}:${String(blockIndex)} opens`, async () => {
          const current = await snapshot(page)
          return current.activeIndex === String(blockIndex) && current.activeMarker ? current : undefined
        }, sleep)
        let lastScroll
        let scrolled
        try {
          scrolled = await waitFor(`block ${String(documentIndex)}:${String(blockIndex)} scrolls into view`, async () => {
            const current = await snapshot(page)
            lastScroll = current
            return current.activeIndex === String(blockIndex) && current.activeMarker && current.activeInViewport ? current : undefined
          }, sleep)
        } catch (error) {
          const diagnostic = lastScroll ? {
            activeIndex: lastScroll.activeIndex,
            activeMarker: lastScroll.activeMarker,
            activeInViewport: lastScroll.activeInViewport,
            inspectorHidden: lastScroll.inspectorHidden,
            activeBounds: lastScroll.activeBounds,
            pageScrollWidth: lastScroll.pageScrollWidth,
            pageClientWidth: lastScroll.pageClientWidth,
          } : null
          await page.screenshot({ path: join(outputDirectory, `failure-${String(width)}-${String(documentIndex)}-${String(blockIndex)}.png`), format: 'png' })
          throw new Error(`${error instanceof Error ? error.message : String(error)}:${JSON.stringify(diagnostic)}`, { cause: error })
        }
        assert.equal(active.activeIndex, String(blockIndex))
        assert.equal(scrolled.activeMarker, true, `selected reader block marker missing for ${String(documentIndex)}:${String(blockIndex)}`)
        assert.ok(scrolled.iframeCount <= 1, `more than one Worker iframe after block ${String(documentIndex)}:${String(blockIndex)}`)
        assert.ok(scrolled.iframePeak <= 1, `more than one Worker iframe observed at ${String(width)}px after block ${String(documentIndex)}:${String(blockIndex)}`)
        assert.ok(scrolled.pageScrollWidth <= scrolled.pageClientWidth, `page overflow at ${String(width)}px and block ${String(documentIndex)}:${String(blockIndex)}: ${String(scrolled.pageScrollWidth)}/${String(scrolled.pageClientWidth)}`)
        assert.equal(scrolled.shellFits, true, `reader shell/document does not fit at ${String(width)}px after block ${String(documentIndex)}:${String(blockIndex)}`)
        if (width <= 1100) assert.equal(scrolled.inspectorHidden, true, `inspector should close after row selection at ${String(width)}px`)
        else assert.equal(scrolled.inspectorHidden, false, `inspector unexpectedly closed after desktop row selection at ${String(width)}px`)
        if (block.status === 'ready' && block.compiled) {
          readyBlocks += 1
          const rendered = await waitFor(`ready block ${String(documentIndex)}:${String(blockIndex)} mounts`, async () => {
            const current = await snapshot(page)
            const cacheSettled = current.mountedCount !== null && current.mountedCount === current.cacheReadyCount
            return (current.nativeTree || current.fallback || current.activeRenderState === 'failed') && cacheSettled ? current : undefined
          }, sleep)
          if (rendered.sourceCodeRecovery) {
            const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/u.exec(block.source)
            assert.ok(fenced, `source code recovery has no original fence: ${block.id}`)
            assert.equal(rendered.sourceCodeText, fenced[2], `source code recovery differs from original: ${block.id}`)
            sourceCodeRecoveries += 1
            continue
          }
          actualMounts += 1
          addTags(tagCounts, rendered.tags)
          assert.equal(rendered.activeRenderState, 'ready', `ready block did not reach validated snapshot state at ${String(documentIndex)}:${String(blockIndex)}`)
          assert.equal(rendered.nativeTree, true, `native tree did not mount for ${String(documentIndex)}:${String(blockIndex)}`)
          assert.equal(rendered.fallback, false, `runtime fallback mounted for ${String(documentIndex)}:${String(blockIndex)}: ${rendered.fallbackText.slice(0, 300)}`)
          assert.equal(rendered.mountedCount, rendered.cacheReadyCount, `snapshot cache counter mismatch for ${String(documentIndex)}:${String(blockIndex)}`)
        } else if (block.status === 'failed') {
          failures.push({ documentIndex, blockIndex, type: block.status, message: active.fallbackText.slice(0, 300) })
        } else if (block.status === 'ready') {
          failures.push({ documentIndex, blockIndex, type: 'compiled-missing', message: active.fallbackText.slice(0, 300) })
        }
      }
    }
    await page.screenshot({ path: join(outputDirectory, `review-${String(width)}.png`), format: 'png', fullPage: true })
    const final = await snapshot(page)
    assert.ok(final.iframePeak <= 1, `more than one Worker iframe observed at ${String(width)}px by end of review`)
    assert.ok(final.pageScrollWidth <= final.pageClientWidth, `page overflow at end of ${String(width)}px review: ${String(final.pageScrollWidth)}/${String(final.pageClientWidth)}`)
    return { width, actualMounts, sourceCodeRecoveries, readyBlocks, statusCounts, tagCounts, failures, reviewedDocuments: documentIndexes.length, iframePeak: final.iframePeak }
  } finally { await page.close() }
}

async function reviewPendingViewport(browser, origin, width, outputDirectory, sleep) {
  const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width <= 390 })
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
  const widths = normalizeWidths(options.widths)
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
    for (const width of widths) {
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
      widths,
      viewports,
      screenshots: widths.map(width => `review-${String(width)}.png`),
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
