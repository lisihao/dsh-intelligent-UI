import { createElement as h, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@openuidev/react-ui'

import { DilProgramView } from '../../src/dil/view.js'
import { installExperienceStyles } from '../../src/style.js'
import type { CompiledDil } from '../../src/dil/compiler.js'
import fixtureCss from './fixture.css'

type ProgramName = 'initial' | 'updated' | 'invalid' | 'timeout' | 'static' | 'ticker'
type Program = Readonly<{ label: string, source: string, compiled: CompiledDil }>
type PreviewConfig = Readonly<{ frameUrl: string, programs: Record<ProgramName, Program> }>
type Submission = Readonly<{
  action: string
  state: Record<string, unknown>
  fields: Record<string, unknown>
}>

type BrowserEvidence = {
  readonly modelCalls: number
  peakFrames: number
  peakPooledFrames: number
  readonly submissions: Submission[]
  readonly stateSnapshots: Record<string, unknown>[]
}

declare global {
  interface Window { __dilBrowser?: BrowserEvidence }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const style = document.createElement('style')
style.dataset.dilBrowserFixture = 'true'
style.textContent = fixtureCss
document.head.append(style)
installExperienceStyles()

const response = await fetch('/api/config', { cache: 'no-store' })
if (!response.ok) throw new Error(`DIL_BROWSER_CONFIG_FAILED:${String(response.status)}`)
const config = await response.json() as PreviewConfig
const evidence: BrowserEvidence = { modelCalls: 0, peakFrames: 0, peakPooledFrames: 0, submissions: [], stateSnapshots: [] }
window.__dilBrowser = evidence
const countFrames = () => {
  evidence.peakFrames = Math.max(evidence.peakFrames, document.querySelectorAll('iframe').length)
  evidence.peakPooledFrames = Math.max(evidence.peakPooledFrames, document.querySelectorAll('[data-dil-runner="pool"] iframe').length)
}
new MutationObserver(countFrames).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dil-runner'] })

/** Many DIL pages on one long page: the shared runner pool bounds live sandboxes. */
function CrowdFixture(): ReactElement {
  const names: ProgramName[] = ['initial', 'static', 'static', 'initial', 'static', 'initial', 'static', 'initial']
  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: 'dark' }, h('main', { className: 'dil-browser-shell', 'data-dil-browser-crowd': names.length },
    ...names.map((name, index) => h('section', { key: index, className: 'dil-browser-surface dsh-experience iexp-content', 'data-crowd-index': index, 'data-crowd-program': name, style: { minHeight: '760px' } },
      h(DilProgramView, {
        source: config.programs[name].source,
        compiled: config.programs[name].compiled,
        enabled: true,
        artifactId: `dil-browser-crowd-${String(index)}`,
        sessionId: 'dil-browser-crowd-session',
        frameUrl: config.frameUrl,
        onStateChange: state => { evidence.stateSnapshots.push(clone({ index, ...state })) },
      })))))
}

function BrowserDilFixture(): ReactElement {
  const [programName, setProgramName] = useState<ProgramName>('initial')
  const [enabled, setEnabled] = useState(true)
  const [submission, setSubmission] = useState<Submission>()
  const program = config.programs[programName]

  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: 'dark' }, h('main', { className: 'dil-browser-shell', 'data-dil-browser-program': programName, 'data-dil-browser-enabled': String(enabled) },
    h('header', { className: 'dil-browser-header' },
      h('div', null,
        h('h1', null, '本地 DIL 交互验收'),
        h('p', null, '固定假设样例：仅验证本地编译、隔离运行与显式提交，不调用模型或外部服务。')),
      h('p', { 'data-dil-program-label': true }, program.label)),
    h('nav', { className: 'dil-browser-tools', 'aria-label': '本地 DIL 验收操作' },
      h('button', { type: 'button', 'data-dil-browser-action': 'update', onClick: () => setProgramName('updated') }, '更新已编译程序'),
      h('button', { type: 'button', 'data-dil-browser-action': 'disable', onClick: () => setEnabled(false) }, '关闭实验'),
      h('button', { type: 'button', 'data-dil-browser-action': 'invalid', onClick: () => setProgramName('invalid') }, '加载错误源'),
      h('button', { type: 'button', 'data-dil-browser-action': 'timeout', onClick: () => setProgramName('timeout') }, '触发 Worker 超时')),
    submission && h('p', { className: 'dil-browser-submit-status', role: 'status', 'data-dil-submit-action': submission.action }, '当前报价条件已提交到本地验收接口。'),
    h('section', { className: 'dil-browser-surface dsh-experience iexp-content' },
      h(DilProgramView, {
        source: program.source,
        compiled: program.compiled,
        enabled,
        artifactId: 'dil-browser-fixture-artifact',
        sessionId: 'dil-browser-fixture-session',
        frameUrl: config.frameUrl,
        onStateChange: state => { evidence.stateSnapshots.push(clone(state)) },
        onSubmit: async (action, input) => {
          const next = { action, state: clone(input.state as Record<string, unknown>), fields: clone(input.fields as Record<string, unknown>) }
          evidence.submissions.push(next)
          setSubmission(next)
        },
      })),
  ))
}

const root = document.querySelector('#root')
if (!root) throw new Error('DIL_BROWSER_ROOT_MISSING')
/** A program that re-renders itself from an effect, with no user event. */
function TickerFixture(): ReactElement {
  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: 'dark' }, h('main', { className: 'dil-browser-shell', 'data-dil-browser-ticker': true },
    h('section', { className: 'dil-browser-surface dsh-experience iexp-content' }, h(DilProgramView, {
      source: config.programs.ticker.source, compiled: config.programs.ticker.compiled, enabled: true,
      artifactId: 'dil-browser-ticker', sessionId: 'dil-browser-ticker-session', frameUrl: config.frameUrl,
    }))))
}

const search = new URLSearchParams(location.search)
createRoot(root).render(h(search.has('crowd') ? CrowdFixture : search.has('ticker') ? TickerFixture : BrowserDilFixture))
// A chat opens at its latest messages: the crowd's last section is the visible one.
if (search.has('bottom')) {
  const toBottom = () => document.documentElement.scrollHeight > window.innerHeight * 2 ? window.scrollTo(0, document.documentElement.scrollHeight) : requestAnimationFrame(toBottom)
  requestAnimationFrame(toBottom)
}
