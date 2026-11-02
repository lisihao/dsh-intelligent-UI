import { describe, expect, it } from 'vitest'
import { CANVAS_UI_COMPONENTS } from '../src/canvas-catalog.js'
import { planCanvasEffect, type EffectPlannerInput, type EffectProvider } from '../src/effect-planner.js'

const objectProvider = (component: string, overrides: Partial<EffectProvider> = {}): EffectProvider => ({
  id: `registered:${component}`, component, renderer: 'webgl', inputs: ['glb', 'gltf', 'svg', 'image'], ...overrides,
})
const htmlProvider = (component: string, overrides: Partial<EffectProvider> = {}): EffectProvider => ({
  id: `registered:${component}`, component, renderer: 'webgl', inputs: ['html'], ...overrides,
})
const reference = 'https://example.test/chip.svg'
const asset = { kind: 'svg', sourceRef: reference, resolved: true } as const
const report = `# 芯片研究\n来源：[供应商](https://example.test/source)\n![芯片架构](${reference})`
const visualInput = (provider: EffectProvider): EffectPlannerInput => ({
  source: '真实正文。第二个真实画面。',
  target: { kind: 'html', scope: 'visual', sourceText: '真实正文。', alternateText: '第二个真实画面。', scrollable: true },
  assets: [], providers: [provider], capabilities: { webgl2: true, 'html-in-canvas': true },
})

describe('effect planner', () => {
  it('uses an actual report asset, provider and browser capability without changing the source', () => {
    const input: EffectPlannerInput = Object.freeze({
      source: report, target: Object.freeze({ kind: 'asset' as const }), assets: Object.freeze([Object.freeze(asset)]),
      providers: Object.freeze([Object.freeze(objectProvider('ink-object'))]), capabilities: Object.freeze({ webgl2: true }),
    })
    expect(planCanvasEffect(input)).toMatchObject({
      status: 'selected', providerId: 'registered:ink-object', component: 'ink-object', input: 'svg', sourceRef: reference,
      domain: 'technical-insight', domainBasis: 'source:report', readableFallbackRequired: false,
    })
    expect(input.source).toBe(report)
  })

  it('never turns a prose URL, absent URL or unresolved model into an asset', () => {
    const base: EffectPlannerInput = {
      source: `这是参考地址 ${reference}，并不是图片。`, target: { kind: 'asset' },
      assets: [asset], providers: [objectProvider('ink-object')], capabilities: { webgl2: true },
    }
    expect(planCanvasEffect(base)).toMatchObject({ status: 'fallback', code: 'asset-not-in-source' })
    expect(planCanvasEffect({ ...base, source: 'No media here.' })).toMatchObject({ status: 'fallback', code: 'asset-not-in-source' })
    expect(planCanvasEffect({ ...base, source: report, assets: [{ ...asset, resolved: false }] })).toMatchObject({ status: 'fallback', code: 'no-compatible-asset' })
  })

  it('binds structured assets to own source fields and exact paths', () => {
    const source = { chart: { src: reference }, positions: [{ date: '2026-10-30', close: 101.2 }] }
    const base: EffectPlannerInput = {
      source, target: { kind: 'asset' }, assets: [{ ...asset, sourcePath: ['chart', 'src'] }],
      providers: [objectProvider('dithered-object')], capabilities: { webgl2: true },
    }
    expect(planCanvasEffect(base)).toMatchObject({ status: 'selected', domain: 'quantitative', domainBasis: 'source:market-series' })
    expect(planCanvasEffect({ ...base, assets: [{ ...asset, sourcePath: ['chart', 'missing'] }] })).toMatchObject({ status: 'fallback', code: 'asset-not-in-source' })
    const inherited = Object.create({ src: reference }) as object
    expect(planCanvasEffect({ ...base, source: inherited, assets: [{ ...asset, sourcePath: ['src'] }] })).toMatchObject({ status: 'fallback', code: 'asset-not-in-source' })
  })

  it('infers a task domain from actual task/status fields, not an arbitrary numeric table', () => {
    const base: EffectPlannerInput = {
      source: { records: [{ task: '复核', status: '进行中' }], image: { src: reference } },
      target: { kind: 'asset' }, assets: [asset], providers: [objectProvider('glass-object')], capabilities: { webgl2: true },
    }
    expect(planCanvasEffect(base)).toMatchObject({ status: 'selected', domain: 'project-management', domainBasis: 'source:tasks' })
    expect(planCanvasEffect({ ...base, source: { rows: [{ date: '2026-10-30', amount: 15 }], image: { src: reference } } })).toMatchObject({ domain: 'general' })
  })

  it('recognizes real Markdown task and market tables without treating prose or unrelated totals as market prices', () => {
    const base = visualInput(htmlProvider('glass'))
    const tasks = '| 任务 | 状态 |\n| --- | --- |\n| 对账 | 进行中 |'
    const prices = '| 日期 | 收盘价 |\n| --- | --- |\n| 2026-10-30 | 101.2 |'
    const arbitrary = '| 日期 | 金额 |\n| --- | --- |\n| 2026-10-30 | 101.2 |'
    expect(planCanvasEffect({ ...base, source: tasks, target: { kind: 'html', scope: 'visual', sourceText: tasks } })).toMatchObject({ domain: 'project-management', domainBasis: 'source:tasks' })
    expect(planCanvasEffect({ ...base, source: prices, target: { kind: 'html', scope: 'visual', sourceText: prices } })).toMatchObject({ domain: 'quantitative', domainBasis: 'source:market-series' })
    expect(planCanvasEffect({ ...base, source: arbitrary, target: { kind: 'html', scope: 'visual', sourceText: arbitrary } })).toMatchObject({ domain: 'general' })
  })

  it('selects registered ASCII for real code using an explicit theme, not invented images', () => {
    const input: EffectPlannerInput = {
      source: `\`\`\`ts\nconst x = 1\n\`\`\`\n![graph](${reference})`, target: { kind: 'asset' }, assets: [asset],
      providers: [objectProvider('ink-object'), objectProvider('ascii-object')], capabilities: { webgl2: true }, theme: { id: 'code', style: 'ascii' },
    }
    expect(planCanvasEffect(input)).toMatchObject({ status: 'selected', component: 'ascii-object', domain: 'coding', domainBasis: 'source:code' })
  })

  it('never treats catalog metadata as a registered provider or mismatched inputs as supported', () => {
    const base: EffectPlannerInput = { source: report, target: { kind: 'asset' }, assets: [asset], providers: [], capabilities: { webgl2: true } }
    expect(planCanvasEffect(base)).toMatchObject({ status: 'fallback', code: 'no-registered-provider' })
    expect(planCanvasEffect({ ...base, providers: [objectProvider('ink-object', { inputs: ['glb'] })] })).toMatchObject({
      status: 'fallback', attempts: [{ component: 'ink-object', code: 'input-unsupported' }],
    })
    expect(planCanvasEffect({ ...base, providers: [objectProvider('fake-component')] })).toMatchObject({ status: 'fallback', attempts: [{ code: 'invalid-provider' }] })
  })

  it.each(CANVAS_UI_COMPONENTS.filter(item => item.kind === 'object').map(item => item.slug))('can plan registered object component %s with a real compatible asset', component => {
    const plan = planCanvasEffect({ source: report, target: { kind: 'asset' }, assets: [asset], providers: [objectProvider(component)], capabilities: { webgl2: true } })
    expect(plan).toMatchObject({ status: 'selected', component, sourceRef: reference })
  })

  it.each(CANVAS_UI_COMPONENTS.filter(item => item.kind === 'html').map(item => item.slug))('can plan registered HTML component %s with real input and native support', component => {
    expect(planCanvasEffect(visualInput(htmlProvider(component)))).toMatchObject({ status: 'selected', component, htmlRendering: { mode: 'native' } })
  })

  it('selects ASCII on a reading surface only when the provider advertises an accessible original', () => {
    const provider = htmlProvider('asciify', { safeScopes: ['reading'], readableFallback: true })
    const base: EffectPlannerInput = {
      source: '代码评审：接口处理完成。', target: { kind: 'html', scope: 'reading', sourceText: '接口处理完成。' },
      assets: [], providers: [provider], capabilities: { webgl2: true, 'html-in-canvas': true }, domain: 'coding', theme: { id: 'terminal', style: 'ascii' },
    }
    expect(planCanvasEffect(base)).toMatchObject({ status: 'selected', component: 'asciify', readableFallbackRequired: true })
    expect(planCanvasEffect({ ...base, providers: [htmlProvider('asciify')] })).toMatchObject({ status: 'fallback', attempts: [{ code: 'scope-unverified' }] })
    expect(planCanvasEffect({ ...base, providers: [{ ...provider, readableFallback: false }] })).toMatchObject({ status: 'fallback', attempts: [{ code: 'readable-fallback-unverified' }] })
    expect(planCanvasEffect({ ...base, target: { ...base.target, kind: 'html', scope: 'reading', sourceText: '接口处理完成。', sensitive: true } })).toMatchObject({ status: 'fallback', code: 'sensitive-surface' })
  })

  it('distinguishes native HTML rendering and verified snapshot fidelity', () => {
    const base = visualInput(htmlProvider('asciify'))
    const unsupported = { ...base, capabilities: { webgl2: true, 'html-in-canvas': false } }
    expect(planCanvasEffect(unsupported)).toMatchObject({ status: 'fallback', attempts: [{ code: 'missing-capability', missingCapabilities: ['html-in-canvas'] }] })
    const snapshot = htmlProvider('asciify', { htmlRendering: { mode: 'snapshot', verified: true, fidelity: 'readable' }, safeScopes: ['reading'], readableFallback: true })
    expect(planCanvasEffect({ ...unsupported, providers: [snapshot], target: { kind: 'html', scope: 'reading', sourceText: '真实正文。' } })).toMatchObject({
      status: 'selected', htmlRendering: { mode: 'snapshot', fidelity: 'readable' }, readableFallbackRequired: true,
    })
    expect(planCanvasEffect({ ...unsupported, providers: [{ ...snapshot, htmlRendering: { mode: 'snapshot', verified: false, fidelity: 'readable' } }] })).toMatchObject({ status: 'fallback', attempts: [{ code: 'snapshot-unverified' }] })
    expect(planCanvasEffect({ ...unsupported, target: { kind: 'html', scope: 'reading', sourceText: '真实正文。' }, providers: [{ ...snapshot, htmlRendering: { mode: 'snapshot', verified: true, fidelity: 'visual-only' } }] })).toMatchObject({ status: 'fallback', attempts: [{ code: 'snapshot-fidelity-insufficient' }] })
  })

  it('keeps data geometry and interaction unless the adapter has verified both safety and fallback', () => {
    const provider = htmlProvider('magnify', { safeScopes: ['data', 'interactive'], readableFallback: true })
    const base = visualInput(provider)
    const data = { ...base, target: { kind: 'html', scope: 'data', sourceText: '真实正文。' } } as const
    const interactive = { ...base, target: { kind: 'html', scope: 'interactive', sourceText: '真实正文。' } } as const
    expect(planCanvasEffect(data)).toMatchObject({ status: 'fallback', attempts: [{ code: 'data-geometry-unverified' }] })
    expect(planCanvasEffect(interactive)).toMatchObject({ status: 'fallback', attempts: [{ code: 'interaction-unverified' }] })
    expect(planCanvasEffect({ ...data, providers: [{ ...provider, preservesDataGeometry: true }] })).toMatchObject({ status: 'selected', component: 'magnify' })
    expect(planCanvasEffect({ ...interactive, providers: [{ ...provider, preservesInteraction: true }] })).toMatchObject({ status: 'selected', component: 'magnify' })
  })

  it('requires real alternate content and a scrollable target for effects that use them', () => {
    const sweep = visualInput(htmlProvider('ascii-sweep'))
    expect(planCanvasEffect({ ...sweep, target: { kind: 'html', scope: 'visual', sourceText: '真实正文。', alternateText: '不存在的内容' } })).toMatchObject({
      status: 'fallback', attempts: [{ code: 'alternate-source-required' }],
    })
    const scroll = visualInput(htmlProvider('particle-scroll'))
    expect(planCanvasEffect({ ...scroll, target: { kind: 'html', scope: 'visual', sourceText: '真实正文。' } })).toMatchObject({
      status: 'fallback', attempts: [{ code: 'scrollable-source-required' }],
    })
  })

  it('checks the backend and source boundary and retains original content during streaming', () => {
    const base = visualInput(htmlProvider('asciify', { renderer: 'webgpu' }))
    expect(planCanvasEffect({ ...base, capabilities: { webgl2: true, 'html-in-canvas': true } })).toMatchObject({ status: 'fallback', attempts: [{ code: 'missing-capability', missingCapabilities: ['webgpu'] }] })
    expect(planCanvasEffect({ ...base, target: { kind: 'html', scope: 'visual', sourceText: '虚构文字' } })).toMatchObject({ status: 'fallback', code: 'unanchored-target' })
    expect(planCanvasEffect({ ...base, streaming: true })).toMatchObject({ status: 'fallback', code: 'streaming' })
    expect(planCanvasEffect({ ...base, reducedMotion: true })).toMatchObject({ status: 'fallback', code: 'reduced-motion' })
    expect(planCanvasEffect({ ...base, theme: { id: 'plain', style: 'none' } })).toMatchObject({ status: 'fallback', code: 'theme-disabled' })
  })
})
