import { describe, expect, it } from 'vitest'
import { classifyCanvasAutoDomain } from '../src/canvas-auto-plan-domain.js'

const technicalReport = `# 模型服务的运行分析

## 商业背景
人工智能应用正在扩张，模型服务的实际运行需要对需求、成本与可持续性分别检验。[来源甲](https://alpha.example/research)

## 算力测量
机器学习推理所需算力具有不同阶段的交付约束，本次记录列出了同口径的测量结果。[来源乙](https://beta.example/measurements)

| 方案 | 延迟（ms） |
| --- | ---: |
| A | 12 |
| B | 15 |

## 限定条件
这些数据只反映所列配置下的测量表现，不能用来推断其他服务环境中的性能和成本。
`
const noTable = technicalReport.replace(/\| 方案 \| 延迟（ms） \|[\s\S]*?(?=\n## 限定条件)/u, '')
const guide = `# 项目研究使用指南

## 1. 安装
安装人工智能开发套件并检查本地依赖版本，然后按照正式文档获取运行环境。[文档甲](https://alpha.example/install)

## 2. 使用
使用机器学习推理服务时选择对应算力配置，并核对已启用的运行参数与端口。[文档乙](https://beta.example/usage)

| 指标 | 延迟（ms） |
| --- | ---: |
| A | 12 |
| B | 15 |

## 3. 配置
配置软件服务的运行入口及监听参数，保存设置后重新打开页面检查修改是否成功。
`

describe('high-confidence source-owned Canvas domain', () => {
  it.each(['technical-insight', 'coding', 'project-management', 'quantitative', 'general'] as const)(
    'honors the explicit own domain %s without inferring from text', domain => {
      const source = Object.freeze({ domain, text: technicalReport })
      expect(classifyCanvasAutoDomain(source)).toEqual({ status: 'identified', domain, basis: 'explicit-domain', evidence: { field: 'domain' } })
    },
  )

  it('rejects invalid declarations, inherited values and arrays without invoking getters', () => {
    expect(classifyCanvasAutoDomain({ domain: 'invented', text: technicalReport })).toEqual({ status: 'unclassified', reason: 'invalid-declared-domain' })
    const inherited = Object.create({ domain: 'technical-insight', text: technicalReport }) as object
    expect(classifyCanvasAutoDomain(inherited)).toEqual({ status: 'unclassified', reason: 'unsupported-source' })
    const getter = Object.defineProperty({}, 'domain', { get() { throw new Error('must not access getters') } })
    expect(classifyCanvasAutoDomain(getter)).toEqual({ status: 'unclassified', reason: 'unsupported-source' })
    expect(classifyCanvasAutoDomain([technicalReport])).toEqual({ status: 'unclassified', reason: 'unsupported-source' })
  })

  it('recognizes multiple anchored sections, citations on different hosts, measurements and technical subjects', () => {
    const result = classifyCanvasAutoDomain(technicalReport)
    expect(result.status).toBe('identified')
    if (result.status !== 'identified' || result.basis !== 'structural-evidence') throw new Error('Expected structural evidence')
    expect(result.domain).toBe('technical-insight')
    expect(result.evidence.sections.count).toBeGreaterThanOrEqual(3)
    expect(result.evidence.citations).toMatchObject({ paragraphs: 2, sections: 2, distinctHosts: 2 })
    expect(result.evidence.technical.sections).toBeGreaterThanOrEqual(2)
    expect(result.evidence.technical.topicGroups).toBeGreaterThanOrEqual(2)
    expect(result.evidence.empirical.tables).toBe(1)
    for (const list of [result.evidence.sections.anchors, result.evidence.citations.anchors, result.evidence.technical.anchors, result.evidence.empirical.anchors]) {
      for (const anchor of list) expect(technicalReport.slice(anchor.start, anchor.end).trim()).not.toBe('')
    }
    expect(classifyCanvasAutoDomain(Object.freeze({ text: technicalReport }))).toEqual(result)
  })

  it('also accepts source-anchored empirical prose without a table', () => {
    const report = noTable.replace('分别检验。[来源甲]', '分别检验，所列服务的延迟为 25 ms。[来源甲]')
      .replace('测量结果。[来源乙]', '测量结果，其中一个样本占比 38%。[来源乙]')
    const result = classifyCanvasAutoDomain(report)
    expect(result).toMatchObject({ status: 'identified', domain: 'technical-insight', basis: 'structural-evidence', evidence: { empirical: { tables: 0, citedParagraphs: 2 } } })
  })

  it('rejects a title keyword and one official link', () => {
    expect(classifyCanvasAutoDomain('# 项目研究使用指南\n\n访问 [官网](https://example.com) 查看安装说明。')).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
  })

  it('rejects a realistic multi-section numbered installation guide even with a metric table and two links', () => {
    expect(classifyCanvasAutoDomain(guide)).toMatchObject({ status: 'unclassified', reason: 'instruction-guide' })
  })

  it('requires distinct cited body paragraphs in at least two sections and two distinct hosts', () => {
    const sameHost = technicalReport.replace('https://beta.example/measurements', 'https://alpha.example/measurements')
    expect(classifyCanvasAutoDomain(sameHost)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence', evidence: { citations: { distinctHosts: 1 } } })
    const wwwAlias = technicalReport.replace('https://beta.example/measurements', 'https://www.alpha.example/measurements')
    expect(classifyCanvasAutoDomain(wwwAlias)).toMatchObject({ status: 'unclassified', evidence: { citations: { distinctHosts: 1 } } })
    const sameSection = technicalReport.replace('## 算力测量', '### 算力测量').replace('## 商业背景', '## 商业背景').replace('### 算力测量\n', '')
    expect(classifyCanvasAutoDomain(sameSection)).toMatchObject({ status: 'unclassified', evidence: { citations: { sections: 1 } } })
  })

  it('does not count unused definitions, navigation, blockquotes or code as factual citations', () => {
    const report = technicalReport
      .replace('[来源甲](https://alpha.example/research)', '')
      .replace('[来源乙](https://beta.example/measurements)', '')
      + '\n## 参考文献\n\n- [甲](https://alpha.example/research)\n- [乙](https://beta.example/measurements)\n\n[unused]: https://gamma.example/x\n\n> 计算机推理和算力成本都有研究报道 [隐藏引用](https://delta.example/x)\n'
    expect(classifyCanvasAutoDomain(report)).toMatchObject({ status: 'unclassified', evidence: { citations: { paragraphs: 0, distinctHosts: 0 } } })
  })

  it('accepts used Markdown reference definitions but not citation text as technical evidence', () => {
    const referenceReport = technicalReport.replace('[来源甲](https://alpha.example/research)', '[来源甲][alpha]')
      .replace('[来源乙](https://beta.example/measurements)', '[来源乙][beta]')
      + '\n[alpha]: https://alpha.example/research\n[beta]: https://beta.example/measurements\n'
    expect(classifyCanvasAutoDomain(referenceReport)).toMatchObject({ status: 'identified', domain: 'technical-insight', evidence: { citations: { distinctHosts: 2 } } })
    const onlyLinks = technicalReport.replace('人工智能应用正在扩张，模型服务的实际运行需要对需求、成本与可持续性分别检验。', '本节保留来源。')
      .replace('[来源甲]', '[人工智能大模型来源甲]')
    expect(classifyCanvasAutoDomain(onlyLinks)).toMatchObject({ status: 'unclassified' })
  })

  it('recognizes links in cited footnotes without counting unused footnotes', () => {
    const footnotes = technicalReport.replace('[来源甲](https://alpha.example/research)', '[^alpha]')
      .replace('[来源乙](https://beta.example/measurements)', '[^beta]')
      + '\n[^alpha]: [数据甲](https://alpha.example/research)\n[^beta]: [数据乙](https://beta.example/measurements)\n[^unused]: [未引用](https://gamma.example/unreferenced)\n'
    expect(classifyCanvasAutoDomain(footnotes)).toMatchObject({ status: 'identified', domain: 'technical-insight', evidence: { citations: { paragraphs: 2, distinctHosts: 2 } } })
  })

  it('recognizes numbered installation and troubleshooting guides', () => {
    const numbered = guide.replace('1. 安装', '1 安装与准备').replace('2. 使用', '2 示例').replace('3. 配置', '3 疑难排查')
    expect(classifyCanvasAutoDomain(numbered)).toMatchObject({ status: 'unclassified', reason: 'instruction-guide' })
  })

  it('requires two measured rows in the same unit-bearing column', () => {
    const unitless = technicalReport.replace('| 方案 | 延迟（ms） |', '| 方案 | 成本 |')
    expect(classifyCanvasAutoDomain(unitless)).toMatchObject({ status: 'unclassified', evidence: { empirical: { tables: 0 } } })
    const datesOnly = technicalReport.replace('| 方案 | 延迟（ms） |\n| --- | ---: |\n| A | 12 |\n| B | 15 |', '| 日期 | 延迟（ms） |\n| --- | ---: |\n| 2025-01-01 | — |\n| 2025-01-02 | — |')
    expect(classifyCanvasAutoDomain(datesOnly)).toMatchObject({ status: 'unclassified', evidence: { empirical: { tables: 0 } } })
  })

  it('does not elevate a report with no measurements or only one technical topic', () => {
    expect(classifyCanvasAutoDomain(noTable)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
    const oneTopic = technicalReport.replace('机器学习推理所需算力具有不同阶段的交付约束', '人工智能大模型具有不同阶段的交付约束')
    expect(classifyCanvasAutoDomain(oneTopic)).toMatchObject({ status: 'unclassified', evidence: { technical: { topicGroups: 1 } } })
  })

  it('preserves explicit and trusted prior domain, and classifies the whole report before a small task or price table', () => {
    const mixed = `${technicalReport}\n\n| task | status |\n|---|---|\n| Fix | open |\n\n\`\`\`js\nconsole.log(1)\n\`\`\`\n`
    expect(classifyCanvasAutoDomain(mixed)).toMatchObject({ status: 'identified', domain: 'technical-insight', basis: 'structural-evidence' })
    const withMarket = `${mixed}\n\n| 日期 | 收盘价 |\n|---|---:|\n|2025-04-09|4.42|\n`
    expect(classifyCanvasAutoDomain(withMarket)).toMatchObject({ status: 'identified', domain: 'technical-insight', basis: 'structural-evidence' })
    const record: { rows: unknown[]; self?: unknown } = { rows: [{ task: 'Fix', status: 'open' }, { date: '2025-04-09', close: 4.42 }] }
    record.self = record
    expect(classifyCanvasAutoDomain(record)).toMatchObject({ status: 'identified', domain: 'quantitative', evidence: { kind: 'structured-record' } })
    expect(classifyCanvasAutoDomain('', { priorDomain: 'coding' })).toMatchObject({ status: 'unclassified', reason: 'unsupported-source' })
    expect(classifyCanvasAutoDomain(technicalReport, { priorDomain: 'coding' })).toMatchObject({ domain: 'coding', evidence: { kind: 'prior-domain' } })
    expect(classifyCanvasAutoDomain({ domain: 'general', text: withMarket }, { priorDomain: 'coding' })).toMatchObject({ domain: 'general', basis: 'explicit-domain' })
  })

  it('does not elevate numeric time-series data alone into a technical research report', () => {
    const source = '# SOFR 日度利率\n\n数据来自 [FRED](https://fred.stlouisfed.org/data/SOFR)，以百分比展示。\n\n| 日期 | SOFR（%） |\n| --- | ---: |\n| 2025-04-07 | 4.33 |\n| 2025-04-08 | 4.40 |\n| 2025-04-09 | 4.42 |\n| 2025-04-10 | 4.37 |\n| 2025-04-11 | 4.33 |'
    expect(classifyCanvasAutoDomain(source)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
  })

  it('preserves the existing coding domain for fenced code and bounds excessive input', () => {
    const input = `${technicalReport}\n\n\`\`\`typescript\n${'const renderer = 1;\n'.repeat(400)}\`\`\`\n`
    const copy = input.slice()
    expect(classifyCanvasAutoDomain(input)).toMatchObject({ status: 'identified', domain: 'coding', basis: 'existing-domain-evidence', evidence: { kind: 'code-fence' } })
    expect(input).toBe(copy)
    expect(classifyCanvasAutoDomain('x'.repeat(1024 * 1024 + 1))).toEqual({ status: 'unclassified', reason: 'too-large' })
    expect(classifyCanvasAutoDomain({ text: 'x'.repeat(1024 * 1024 + 1), rows: [{ date: '2025-04-09', close: 4.42 }] })).toMatchObject({ status: 'identified', domain: 'quantitative', evidence: { kind: 'structured-record' } })
  })

  it('recognizes an evidenced report with a small fenced example while still classifying code-dominant work as coding', () => {
    const mixed = `${technicalReport}\n\n\`\`\`typescript\nconst renderer = 1\n\`\`\`\n`
    expect(classifyCanvasAutoDomain(mixed)).toMatchObject({ status: 'identified', domain: 'technical-insight', basis: 'structural-evidence' })
    const codeDominant = `${technicalReport}\n\n\`\`\`typescript\n${'const renderer = 1;\n'.repeat(400)}\`\`\`\n`
    expect(classifyCanvasAutoDomain(codeDominant)).toMatchObject({ status: 'identified', domain: 'coding', evidence: { kind: 'code-fence' } })
  })

  it('does not classify an otherwise unverified technical overview as coding based on one small code block', () => {
    const overview = '# 技术概览\n\n## 目标\n系统服务于多个团队，需要清晰描述架构与依赖边界，避免对各项结果做没有根据的推断。\n\n## 机制\n方案将模型推理任务拆分到不同的执行资源，并记录每个阶段采用的参数与处理条件。\n\n## 局限\n该概览不包含经核验的数据或来源，因此还无法作为有证据的研究报告来归类。\n\n```python\nprint(1)\n```'
    expect(classifyCanvasAutoDomain(overview)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
    expect(classifyCanvasAutoDomain({ text: overview })).toMatchObject({ status: 'unclassified' })
    const noHeading = `${'这是一段简短说明。\n\n'.repeat(14)}\`\`\`python\nprint(1)\n\`\`\`\n`
    expect(classifyCanvasAutoDomain(noHeading)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
    const preface = `${'这是一段简短说明。\n\n'.repeat(14)}# 记录\n\n\`\`\`python\nprint(1)\n\`\`\`\n`
    expect(classifyCanvasAutoDomain(preface)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
    const list = `${'- 技术说明包含部署条件与推理资源说明。\n'.repeat(20)}\n\`\`\`python\nprint(1)\n\`\`\`\n`
    expect(classifyCanvasAutoDomain(list)).toMatchObject({ status: 'unclassified', reason: 'insufficient-evidence' })
  })
})
