import { describe, expect, it } from 'vitest'
import { analyzeTableCharts, analyzeTable, parseMarkdownTables, rowsFromRecords, selectIcon } from '../src/content-analysis.js'

describe('automatic content analysis', () => {
  it('selects a trend from ordinary chronological output without OpenUI input', () => {
    const source = `## 本周调用趋势\n\n| 日期 | 调用量（次） |\n| --- | ---: |\n| 2026-10-27 | 1,082 |\n| 2026-10-28 | 1,447 |\n| 2026-10-29 | 1,273 |\n\n来源：服务日志。`
    const tables = parseMarkdownTables(source)
    expect(tables).toHaveLength(1)
    expect(source.slice(tables[0]!.start, tables[0]!.end)).toMatch(/^\| 日期/)
    expect(tables[0]!.plan).toMatchObject({ kind: 'line', labels: ['2026-10-27', '2026-10-28', '2026-10-29'], series: [{ name: '调用量（次）', values: [1082, 1447, 1273], unit: '次' }] })
  })
  it('compares real-shaped test durations without equating them to product performance', () => {
    const data = rowsFromRecords([{ file: 'client.test.ts', duration_ms: 28.801025390625 }, { file: 'presentation.test.ts', duration_ms: 471.93701171875 }, { file: 'registry.test.ts', duration_ms: 7.158447265625 }, { file: 'store.test.ts', duration_ms: 26.45849609375 }])!
    const plan = analyzeTable(data.headers, data.rows)
    expect(plan?.kind).toBe('bar')
    expect(plan?.series[0]?.values).toEqual([28.801025390625, 471.93701171875, 7.158447265625, 26.45849609375])
    expect(plan?.series[0]?.unit).toBe('ms')
    expect(plan?.labels).toEqual(['client.test.ts', 'presentation.test.ts', 'registry.test.ts', 'store.test.ts'])
  })
  it('uses the maintained GFM parser for formatting and escaped pipes, ignoring code fences', () => {
    const source = '```md\n| Not a table | Value |\n| --- | --- |\n| x | 3 |\n| y | 5 |\n```\n\n| **Endpoint** | Duration (ms) |\n| --- | ---: |\n| A\\|B | 1.25 |\n| [C](https://example.org) | 2.75 |'
    const [table] = parseMarkdownTables(source)
    expect(parseMarkdownTables(source)).toHaveLength(1)
    expect(table?.headers).toEqual(['Endpoint', 'Duration (ms)'])
    expect(table?.plan?.labels).toEqual(['A|B', 'C'])
    expect(table?.plan?.series[0]?.unit).toBe('ms')
  })
  it('does not turn a real research table with TTM and quarterly periods into a misleading comparison', () => {
    const plan = analyzeTable(['公司与期间', '经营现金流', '资本支出', '自由现金流'], [
      ['Alphabet，2026 Q3', '422.90', '513.55', '−90.65'],
      ['Meta，2026 Q3', '327.86', '349.06', '−21.20'],
      ['Amazon，截至2026-09-30的TTM', '1,683.00', '2,106.57', '−423.57'],
    ], '单位：亿美元')
    expect(plan?.labels).toEqual(['Alphabet，2026 Q3', 'Meta，2026 Q3'])
    expect(plan?.basis).toContain('2026 Q3')
    expect(plan?.notes?.join(' ')).toContain('Amazon')
    expect(analyzeTable(['公司', '收入'], [['A', '10'], ['B', '20']], '需要注意口径差异，不能直接横向加总。')?.notes?.join(' ')).toContain('不能直接横向加总')
  })
  it.each([
    [[['A', '3–5'], ['B', '6']]],
    [[['A', '—'], ['B', '6']]],
    [[['A', '10ms'], ['B', '2s']]],
    [[['A', '$10'], ['B', '10元']]],
    [[['A', '10%'], ['B', '20']]],
    [[['A', 'true'], ['B', 'false']]],
    [[['A', '3'], ['A', '6']]],
    [[['A', '9007199254740992'], ['B', '6']]],
  ])('preserves ambiguous, incomplete or incomparable input as a table: %j', rows => {
    expect(analyzeTable(['名称', '数值'], rows)).toBeUndefined()
  })
  it('keeps incompatible metrics and identifier columns out of a common quantitative axis', () => {
    expect(analyzeTableCharts(['类别', '成本（元）', '成功率（%）'], [['A', '10', '80'], ['B', '20', '90']]).map(plan => plan.series[0]?.unit)).toEqual(['CNY', '%'])
    expect(analyzeTable(['类别', 'user_id'], [['A', '10'], ['B', '20']])).toBeUndefined()
    expect(analyzeTable(['类别', '版本'], [['A', '1'], ['B', '2']])).toBeUndefined()
    expect(analyzeTable(['类别', '日期'], [['A', '2026'], ['B', '2027']])).toBeUndefined()
    expect(analyzeTable(['uuid', '数量'], [['f7f48ec8', '10'], ['fff12345', '20']])).toBeUndefined()
  })
  it('does not connect unsorted dates, invalid dates, or different time resolutions', () => {
    expect(analyzeTable(['日期', '数量'], [['2026-10-29', '1'], ['2026-10-28', '2']])).toBeUndefined()
    expect(analyzeTable(['日期', '数量'], [['2026-02-30', '1'], ['2026-03-01', '2']])).toBeUndefined()
    expect(analyzeTable(['日期', '数量'], [['2026', '1'], ['2027-01', '2']])).toBeUndefined()
  })
  it('retains percentages and negative numbers exactly without unit rescaling', () => {
    expect(analyzeTable(['日期', '变化（%）'], [['2026-10', '−12.5%'], ['2026-11', '+4.2%']])?.series[0]).toEqual({ name: '变化（%）', values: [-12.5, 4.2], unit: '%', originals: ['−12.5%', '+4.2%'] })
  })
  it('retains an explicit shared source unit and declines unknown bases', () => {
    expect(analyzeTable(['公司', '收入'], [['A', '10'], ['B', '20']], '单位：亿美元')?.series[0]?.unit).toBe('亿美元')
    expect(analyzeTable(['公司', '收入 (USD millions)'], [['A', '10'], ['B', '20']])).toBeUndefined()
    expect(analyzeTable(['公司', '收入'], [['A', '10'], ['B', '20']], '单位：当地货币')).toBeUndefined()
    expect(analyzeTable(['公司', '金额（元）'], [['A', '10'], ['B', '20']], '单位：美元')).toBeUndefined()
    expect(analyzeTable(['公司', '金额'], [['A', '10'], ['B', '20']], '单位：美元；单位：元')).toBeUndefined()
  })
  it('does not borrow a nearby table unit or an adjacent section qualification', () => {
    const source = '## 金额\n\n单位：美元\n\n| 类别 | 金额 |\n|---|---|\n|A|10|\n|B|20|\n\n## 耗时\n\n单位：毫秒\n\n| 类别 | 耗时 |\n|---|---|\n|C|30|\n|D|40|'
    expect(parseMarkdownTables(source).map(table => table.plan?.series[0]?.unit)).toEqual(['USD', 'ms'])
    const sameSection = source.replace('## 耗时\n\n', '')
    expect(parseMarkdownTables(sameSection).map(table => table.plan?.series[0]?.unit)).toEqual(['USD', 'ms'])
  })
  it('respects source disclaimers both before and after a table', () => {
    const table = '| 公司 | 收入 |\n|---|---|\n|A|10|\n|B|20|'
    expect(parseMarkdownTables(`不能直接比较。\n\n${table}`)[0]?.plan).toBeUndefined()
    expect(parseMarkdownTables(`${table}\n\n以上数据不可比。`)[0]?.plan).toBeUndefined()
    expect(parseMarkdownTables(`${table}\n\n## 其他数据\n\n以上数据不可比。`)[0]?.plan).toBeDefined()
  })
  it('does not revive struck-through or qualified numbers as active chart values', () => {
    const table = (cell: string) => `| 类别 | 数量 |\n|---|---|\n|A|${cell}|\n|B|20|`
    expect(parseMarkdownTables(table('~~10~~'))[0]?.plan).toBeUndefined()
    expect(parseMarkdownTables(table('10[^note]') + '\n\n[^note]: 含估计值')[0]?.plan).toBeUndefined()
    expect(parseMarkdownTables(table('**10**'))[0]?.plan?.series[0]?.values).toEqual([10, 20])
  })
  it('does not compare explicit annual, half-year, monthly and YTD bases', () => {
    for (const period of ['半年', '月度', 'YTD', '2026 Q1']) {
      expect(analyzeTable(['公司与期间', '收入（元）'], [['A 全年', '100'], [`B ${period}`, '70']])).toBeUndefined()
    }
    expect(analyzeTable(['时间', '数量'], [['2026-02-30', '1'], ['2026-04-31', '2']])).toBeUndefined()
  })
  it('keeps valid tables beyond the old row threshold and does not flatten nested/incomplete records', () => {
    const rows = Array.from({ length: 201 }, (_, index) => [`c${index}`, String(index)])
    const plan = analyzeTable(['类别', '数值'], rows)!
    expect(plan.labels).toEqual(rows.map(row => row[0]))
    expect(plan.sourceRows).toEqual(rows.map((_row, index) => index))
    expect(rowsFromRecords([{ a: 'one', b: 1 }, { a: 'two' }])).toBeUndefined()
    expect(rowsFromRecords([{ a: 'one', b: { value: 1 } }])).toBeUndefined()
  })
  it('selects meaningful real-library icons from unseen headings', () => {
    expect(selectIcon('未通过验证')).toBe('triangle-alert')
    expect(selectIcon('unverified result')).toBe('triangle-alert')
    expect(selectIcon('潜在风险与未解决问题')).toBe('triangle-alert')
    expect(selectIcon('服务调用趋势')).toBe('trending-up')
    expect(selectIcon('各文件耗时')).toBe('gauge')
    expect(selectIcon('任务验证通过')).toBe('circle-check-big')
    expect(selectIcon('预算与现金流')).toBe('wallet')
    expect(selectIcon('普通说明')).toBe('file-text')
  })
  it('charts a source-local expense breakdown despite older periods discussed above it', () => {
    const markdown = '## 2025全年与2026上半年毛利率差异\n\n2025全年为39.5%，2026上半年为85.4%。\n\n2026年上半年的功能费用明细如下：\n\n| 项目 | 金额 |\n|---|---|\n|收入成本|23.80亿美元|\n|研发费用|97.41亿美元|\n|销售与营销|38.08亿美元|\n|一般及行政|10.50亿美元|\n|合计|169.79亿美元|\n\n不能与另一分类重复相加。'
    const table = parseMarkdownTables(markdown)[0]!
    expect(table.plans).toHaveLength(1)
    expect(table.plan?.basis).toBe('2026 H1；单位：亿美元')
    expect(table.plan?.labels).toEqual(['收入成本', '研发费用', '销售与营销', '一般及行政'])
    expect(table.plan?.series[0]).toMatchObject({ values: [23.8, 97.41, 38.08, 10.5], originals: ['23.80亿美元', '97.41亿美元', '38.08亿美元', '10.50亿美元'] })
    expect(table.plan?.sourceRows).toEqual([0, 1, 2, 3]); expect(table.plan?.sourceColumns).toEqual([1])
    expect(table.plan?.notes?.join(' ')).toContain('合计行未参与')
    expect(table.rows[4]).toEqual(['合计', '169.79亿美元'])
  })
  it('extracts numeric columns and explicitly names ignored text/identifier columns', () => {
    const plans = analyzeTableCharts(['地区', '金额（元）', '说明', 'record_id', '成功率（%）'], [['东区', '10', '正常', '187', '82'], ['西区', '20', '待复核', '206', '91']])
    expect(plans).toHaveLength(2)
    expect(plans.map(plan => plan.sourceColumns)).toEqual([[1], [4]])
    expect(plans[0]?.notes?.join(' ')).toContain('说明'); expect(plans[0]?.notes?.join(' ')).toContain('record_id')
  })
  it('separates transposed annual, half-year and quarterly columns without annualizing', () => {
    const markdown = '## 财务指标\n\n以下表格单位均为亿美元。2026年上半年度与季度数据未经审计。\n\n| 指标 | 2025全年 | 2026上半年 | 2026 Q2 |\n|---|---|---|---|\n|收入|45.85|162.86|115.55|\n|费用|73.26|89.45|55.58|\n|现金流|−26.37|39.29|未单列|'
    const table = parseMarkdownTables(markdown)[0]!
    expect(table.plans).toHaveLength(3)
    expect(table.plans.map(plan => plan.kind)).toEqual(['bar', 'bar', 'bar'])
    expect(table.plans.map(plan => plan.basis)).toEqual(['2025 全年；单位：亿美元', '2026 H1；单位：亿美元', '2026 Q2；单位：亿美元'])
    expect(table.plans[2]?.series[0]?.values).toEqual([115.55, 55.58])
    expect(table.plans[2]?.notes?.join(' ')).toContain('现金流（未单列）')
    expect(table.rows[2]?.[3]).toBe('未单列')
  })
  it('retains exact approximations and source row/column indices when drawing partial data', () => {
    const plan = analyzeTable(['目标', '所需年度收入', '背景'], [['保持运转', '约3,080亿美元', '基础情景'], ['ROIC 10%', '约4,170亿美元', '假设'], ['ROIC 20%', '约5,260亿美元', '假设'], ['未知', '3,000—6,000亿美元', '范围']], '按参数假设测算，不代表实际实现值。')!
    expect(plan.basis).toBe('年度；单位：亿美元')
    expect(plan.title).toContain('含近似值')
    expect(plan.series[0]?.originals).toEqual(['约3,080亿美元', '约4,170亿美元', '约5,260亿美元'])
    expect(plan.series[0]?.values).toEqual([3080, 4170, 5260])
    expect(plan.sourceRows).toEqual([0, 1, 2]); expect(plan.sourceColumns).toEqual([1])
    expect(plan.notes?.join(' ')).toContain('不是精确值'); expect(plan.notes?.join(' ')).toContain('未知（3,000—6,000亿美元）')
  })
  it('groups explicitly equivalent calendar quarters and keeps TTM and differing Capex definitions out', () => {
    const plans = analyzeTableCharts(['公司与期间', '经营现金流', '资本支出', '自由现金流'], [['Alpha，2026 Q3', '422.90', '513.55（现金PP&E）', '−90.65'], ['Beta，2026 Q3', '327.86', '349.06（含融资租赁本金）', '−21.20'], ['Gamma，FY2027 Q1（即2026 Q3）', '约580', '约394（现金PP&E）', '约+186'], ['Delta，TTM', '1,683.00', '2,106.57（扣除出售收入及激励）', '−423.57']], '各公司的自由现金流按各自定义计算；不能直接横向加总。', '单位：亿美元')
    expect(plans).toHaveLength(1)
    expect(plans[0]?.sourceColumns).toEqual([1, 3])
    expect(plans[0]?.labels).toHaveLength(3)
    expect(plans[0]?.basis).toContain('2026 Q3')
    expect(plans[0]?.notes?.join(' ')).toContain('Delta，TTM')
    expect(plans[0]?.notes?.join(' ')).toContain('各自定义')
    expect(plans[0]?.series[1]?.originals).toEqual(['−90.65', '−21.20', '约+186'])
  })
  it('does not revive an invalid AST cell or discard the rest of its valid column', () => {
    const markdown = '| 类别 | 数量 |\n|---|---|\n|A|~~10~~|\n|B|**20**|\n|C|30|'
    const table = parseMarkdownTables(markdown)[0]!
    expect(table.plan?.labels).toEqual(['B', 'C'])
    expect(table.plan?.series[0]?.originals).toEqual(['**20**', '30'])
    expect(table.plan?.notes?.join(' ')).toContain('A')
    expect(table.rows).toHaveLength(3)
  })
  it('extracts a compatible unit subgroup without converting other scales or hiding omissions', () => {
    const plans = analyzeTableCharts(['任务', '耗时'], [['A', '20ms'], ['B', '30ms'], ['C', '2s'], ['D', '4s'], ['E', '未知']])
    expect(plans).toHaveLength(2)
    expect(plans.map(plan => plan.series[0]?.values)).toEqual([[20, 30], [2, 4]])
    expect(plans.map(plan => plan.series[0]?.unit)).toEqual(['ms', 's'])
    expect(plans.every(plan => plan.notes?.join(' ').includes('E（未知）'))).toBe(true)
  })
  it('does not collapse columns beyond the per-chart series limit or invent compound dimensions', () => {
    const plans = analyzeTableCharts(['类别', 'm1', 'm2', 'm3', 'm4', 'm5'], [['A', '1', '2', '3', '4', '5'], ['B', '6', '7', '8', '9', '10']])
    expect(plans.map(plan => plan.sourceColumns)).toEqual([[1, 2, 3, 4], [5]])
    expect(analyzeTableCharts(['初始估值', '倍数', '所需收入'], [['A', '30倍', '约10美元'], ['A', '40倍', '约20美元']])).toEqual([])
  })

  it('retains every value in ten thousand categorical records across forty compatible numeric columns', () => {
    const records = Array.from({ length: 10_000 }, (_, row) => Object.fromEntries([
      ['类别', `原始类别 ${row}`], ...Array.from({ length: 40 }, (_, column) => [`metric_${column}`, row * 40 + column]),
    ]))
    const table = rowsFromRecords(records)!
    expect(table.rows).toHaveLength(10_000); expect(table.headers).toHaveLength(41)
    const plans = analyzeTableCharts(table.headers, table.rows)
    expect(plans).toHaveLength(10)
    expect(plans.flatMap(plan => plan.sourceColumns!)).toEqual(Array.from({ length: 40 }, (_, column) => column + 1))
    for (const plan of plans) {
      expect(plan.labels).toEqual(records.map(record => record['类别']))
      expect(plan.sourceRows).toEqual(Array.from({ length: 10_000 }, (_, row) => row))
      expect(plan.sourceRowCount).toBe(10_000); expect(plan.sourceColumnCount).toBe(41)
      expect(plan.omittedRowRanges).toEqual([])
      for (let series = 0; series < plan.series.length; series++) {
        const sourceColumn = plan.sourceColumns![series]!
        expect(plan.series[series]!.values).toEqual(records.map(record => Number(record[table.headers[sourceColumn]!])))
        expect(plan.series[series]!.originals).toEqual(table.rows.map(row => row[sourceColumn]))
      }
      expect(plan.notes?.join('\n').length).toBeLessThan(1000)
    }
  })

  it('preserves the existing complete small-note phrasing at the six-item boundary', () => {
    const rows = [['甲', '约1ms', '保留说明'], ['乙', '约2ms', '保留说明'], ...Array.from({ length: 6 }, (_, index) => [`缺失${index}`, '未提供', '保留说明'])]
    const plan = analyzeTable(['地区', '耗时', '说明'], rows)!
    expect(plan.notes).toContain(`本图未纳入：${Array.from({ length: 6 }, (_, index) => `缺失${index}（未提供）`).join('、')}。原因：缺失、非数值、单位、期间或数据定义不同；完整数据见原表。`)
    expect(plan.notes).toContain('本图未使用列：说明；仍保留在原表。')
    expect(plan.notes).toContain('含原文近似值（不是精确值）：甲 / 耗时：约1ms；乙 / 耗时：约2ms。')
    const larger = analyzeTable(['地区', '耗时', '说明'], [...rows, ['再缺失', '未知', '保留说明']])!
    expect(larger.notes?.find(note => note.startsWith('本图未纳入'))).toContain('本图未纳入 7 行：')
    expect(larger.notes?.find(note => note.startsWith('本图未纳入'))).toContain('另有 1 项')
    expect(larger.omittedRowRanges).toEqual([[2, 9]])
  })

  it('retains a ten-thousand-day time series without sampling, sorting or changing decimal source strings', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [new Date(Date.UTC(1990, 0, 1) + index * 86_400_000).toISOString().slice(0, 10), (index / 8).toFixed(3)])
    const plan = analyzeTable(['日期', '耗时（ms）'], rows)!
    expect(plan.kind).toBe('line'); expect(plan.labels).toEqual(rows.map(row => row[0]))
    expect(plan.series[0]!.values).toEqual(rows.map(row => Number(row[1])))
    expect(plan.series[0]!.originals).toEqual(rows.map(row => row[1]))
    expect(plan.series[0]!.unit).toBe('ms'); expect(plan.sourceRows?.at(-1)).toBe(9999)
    expect(plan.omittedRowRanges).toEqual([])
    const invalidOrder = rows.map(row => [...row]); invalidOrder[9999]![0] = invalidOrder[9998]![0]!
    expect(analyzeTable(['日期', '耗时（ms）'], invalidOrder)).toBeUndefined()
  })

  it('keeps compact exact provenance for many small compatible groups instead of duplicating all omitted rows', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [`测点 ${index}`, `${index}（定义-${Math.floor(index / 2)}）`])
    const plans = analyzeTableCharts(['测点', '读数'], rows)
    expect(plans).toHaveLength(5000)
    expect(plans.flatMap(plan => plan.sourceRows!)).toEqual(Array.from({ length: 10_000 }, (_, index) => index))
    for (const plan of plans) {
      expect(plan.labels).toHaveLength(2)
      expect(plan.omittedRowRanges!.reduce((count, [start, end]) => count + end - start, 0)).toBe(9998)
      expect(plan.omittedRowRanges!.length).toBeLessThanOrEqual(2)
      expect(plan.notes!.join('\n')).toContain('未纳入 9998 行')
      expect(plan.notes!.join('\n').length).toBeLessThan(1500)
      for (const [start, end] of plan.omittedRowRanges!) {
        expect(plan.sourceRows!.every(row => row < start || row >= end)).toBe(true)
      }
    }
  })

  it('summarizes large approximation notes while preserving all originals and source selection', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [`任务 ${index}`, `约${(index / 8).toFixed(3)}ms`])
    const plan = analyzeTable(['任务', '耗时'], rows)!
    expect(plan.series[0]!.originals).toEqual(rows.map(row => row[1]))
    expect(plan.sourceRows).toHaveLength(10_000); expect(plan.omittedRowRanges).toEqual([])
    expect(plan.notes!.join('\n')).toContain('不是精确值，共 10000 项')
    expect(plan.notes!.join('\n').length).toBeLessThan(1500)
  })

  it('retains invalid-unit and identifier exclusions at large scale with exact source ranges', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [`任务 ${index}`, `${index}ms`, String(index + 100_000)])
    rows[9998]![1] = '3s'; rows[9999]![1] = '99fortnights'
    const plan = analyzeTable(['任务', '耗时（ms）', 'record_id'], rows)!
    expect(plan.series).toHaveLength(1); expect(plan.series[0]!.unit).toBe('ms')
    expect(plan.sourceColumns).toEqual([1]); expect(plan.omittedColumnRanges).toEqual([[2, 3]])
    expect(plan.sourceRows).toHaveLength(9998); expect(plan.omittedRowRanges).toEqual([[9998, 10_000]])
    expect(plan.notes!.join('\n')).toContain('3s'); expect(plan.notes!.join('\n')).toContain('99fortnights')
    expect(plan.series[0]!.originals?.at(-1)).toBe('9997ms')
    expect(rows[9999]![1]).toBe('99fortnights')
    expect(analyzeTable(['uuid', '耗时（ms）'], rows.map(row => [row[0]!, row[1]!]))).toBeUndefined()
  })

  it('keeps distinct periods separate for large record sets without changing raw values', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [`公司 ${index}，${index < 5000 ? '2026 Q3' : 'TTM'}`, index % 2 ? '10.20美元' : '约+12.00美元'])
    const plans = analyzeTableCharts(['公司与期间', '收入'], rows)
    expect(plans).toHaveLength(2)
    expect(plans.map(plan => plan.basis)).toEqual(['2026 Q3；单位：USD', 'TTM；单位：USD'])
    expect(plans.map(plan => plan.sourceRows!.length)).toEqual([5000, 5000])
    expect(plans.map(plan => plan.omittedRowRanges)).toEqual([[[5000, 10_000]], [[0, 5000]]])
    expect(plans[1]!.series[0]!.originals![0]).toBe('约+12.00美元')
    expect(plans[1]!.series[0]!.values[0]).toBe(12)
  })

})
