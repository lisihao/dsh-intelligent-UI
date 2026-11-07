// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownCodeBlock, markdownCodeBlocks } from '../src/markdown-code.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(props: Parameters<typeof MarkdownCodeBlock>[0]): Promise<{ host: HTMLDivElement, root: Root }> {
  const host = document.createElement('div')
  const root = createRoot(host)
  document.body.append(host)
  await act(async () => root.render(h('div', { className: 'dsh-experience' }, h(MarkdownCodeBlock, props))))
  return { host, root }
}

afterEach(async () => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('markdownCodeBlocks', () => {
  it('uses remark GFM code-node values, languages, and complete UTF-16 source ranges without trimming', () => {
    const source = [
      '开头文本。',
      '',
      '~~~js',
      'const π = 1',
      '',
      '  keepIndent(π)',
      '~~~',
      '',
      '    indented source',
    ].join('\n')
    const blocks = markdownCodeBlocks(source)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      start: source.indexOf('~~~js'),
      end: source.indexOf('~~~', source.indexOf('~~~js') + 1) + 3,
      value: 'const π = 1\n\n  keepIndent(π)',
      language: 'js',
    })
    expect(blocks[1]).toEqual({
      start: source.indexOf('    indented source'),
      end: source.length,
      value: 'indented source',
    })
  })
})

describe('MarkdownCodeBlock', () => {
  it('renders common-language refractor spans inside a real pre > code without changing text', async () => {
    const code = 'const answer = 42\nconsole.log(answer)'
    const mounted = await mount({ code, language: 'js', start: 4, end: 4 + code.length })
    try {
      const section = mounted.host.querySelector<HTMLElement>('.iexp-markdown-code')
      const codeElement = mounted.host.querySelector<HTMLElement>('pre > code')
      expect(section?.querySelector('.iexp-markdown-code-language')?.textContent).toBe('语言：js')
      expect(codeElement?.textContent).toBe(code)
      expect(codeElement?.querySelector('span.token.keyword')?.textContent).toBe('const')
      expect(codeElement?.getAttribute('data-iexp-code-start')).toBe('4')
      expect(codeElement?.getAttribute('data-iexp-code-end')).toBe(String(4 + code.length))
    } finally {
      await act(async () => mounted.root.unmount())
    }
  })

  it('keeps unknown-language code readable as escaped plain text and preserves indentation and blank lines', async () => {
    const code = '<script>alert("not executed")</script>\n  keepIndent()\n\n  // blank line above'
    const mounted = await mount({ code, language: 'unregistered-source-language' })
    try {
      const codeElement = mounted.host.querySelector<HTMLElement>('pre > code')!
      expect(codeElement.textContent).toBe(code)
      expect(codeElement.querySelector('script')).toBeNull()
      expect(codeElement.querySelector('.token')).toBeNull()
      expect(mounted.host.querySelector('.iexp-markdown-code-language')?.textContent).toBe('语言：unregistered-source-language')
    } finally {
      await act(async () => mounted.root.unmount())
    }
  })

  it('copies the exact source string and gives a local success status', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const code = '  exact()\n\nend()'
    const mounted = await mount({ code, language: 'js' })
    try {
      const button = mounted.host.querySelector<HTMLButtonElement>('button.iexp-markdown-code-copy')!
      await act(async () => { button.click(); await Promise.resolve() })
      expect(writeText).toHaveBeenCalledWith(code)
      expect(mounted.host.querySelector('[role="status"]')?.textContent).toBe('已复制原始代码。')
    } finally {
      await act(async () => mounted.root.unmount())
    }
  })

  it('reports clipboard rejection locally without changing the source text', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied') })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const code = 'source stays readable()'
    const mounted = await mount({ code })
    try {
      const button = mounted.host.querySelector<HTMLButtonElement>('button.iexp-markdown-code-copy')!
      await act(async () => { button.click(); await Promise.resolve() })
      expect(writeText).toHaveBeenCalledWith(code)
      expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBe('无法复制原始代码；请手动选择并复制。')
      expect(mounted.host.querySelector('pre > code')?.textContent).toBe(code)
    } finally {
      await act(async () => mounted.root.unmount())
    }
  })
})
