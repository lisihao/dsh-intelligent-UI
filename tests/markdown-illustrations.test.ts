import { describe, expect, it } from 'vitest'
import { markdownIllustrations } from '../src/markdown-illustrations.js'

describe('source-declared Markdown illustrations', () => {
  it('finds only a standalone, explicitly named illustration and preserves its exact source offset', () => {
    const source = '# Note\n\n![技术插画](https://example.test/art.png?size=2)\n\n![Decorative illustration](/art.JPG)'
    expect(markdownIllustrations(source)).toEqual([
      { start: source.indexOf('![技术插画]'), url: 'https://example.test/art.png?size=2', alt: '技术插画', mime: 'image/png' },
      { start: source.indexOf('![Decorative illustration]'), url: '/art.JPG', alt: 'Decorative illustration', mime: 'image/jpeg' },
    ])
  })

  it('leaves ordinary media, evidence, linked images, unsupported types and inline images alone', () => {
    const source = [
      '![model diagram](chart.png)', '![插画中的图表](chart.png)', '![Photo illustration](photo.jpg)',
      '![illustration architecture](system.png)', '![插画版系统架构图](system.png)',
      '![营收趋势图插画](revenue.png)', '![K線圖插畫](market.png)', '![heatmap illustration](heat.png)',
      '[![illustration](art.png)](https://example.test/target)', '![illustration](art.svg)',
      '![illustration](javascript:bad.png)',
      'A sentence with ![illustration](art.png) inside.', '```md\n![illustration](art.png)\n```',
    ].join('\n\n')
    expect(markdownIllustrations(source)).toEqual([])
  })

  it('uses an explicitly declared PNG/JPEG data MIME and leaves unknown data alone', () => {
    const source = '![illustration](data:image/png;base64,AA==)\n\n![插画](data:image/webp;base64,AA==)'
    expect(markdownIllustrations(source)).toEqual([{ start: 0, url: 'data:image/png;base64,AA==', alt: 'illustration', mime: 'image/png' }])
  })
})
