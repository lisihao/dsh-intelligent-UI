import { createElement as h, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@openuidev/react-ui'

import { DilProgramView } from '../../src/dil/view.js'
import { installExperienceStyles } from '../../src/style.js'
import type { CompiledDil } from '../../src/dil/compiler.js'
import fixtureCss from './fixture.css'

type ProgramName = 'initial' | 'updated' | 'invalid' | 'timeout'
type Program = Readonly<{ label: string, source: string, compiled: CompiledDil }>
type PreviewConfig = Readonly<{ frameUrl: string, programs: Record<ProgramName, Program> }>
type Submission = Readonly<{
  action: string
  state: Record<string, unknown>
  fields: Record<string, unknown>
}>

type BrowserEvidence = {
  readonly modelCalls: number
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
const evidence: BrowserEvidence = { modelCalls: 0, submissions: [], stateSnapshots: [] }
window.__dilBrowser = evidence

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
createRoot(root).render(h(BrowserDilFixture))
