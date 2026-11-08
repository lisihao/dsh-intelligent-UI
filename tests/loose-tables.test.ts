import { describe, expect, it } from 'vitest'
import { compactLooseTables } from '../src/loose-tables.js'

const loose = '### 1.1 核心技术判断\n\n| 研究维度 | 当前判断 | 证据状态 |\n\n| --- | --- | --- |\n\n| 甲 | 明确 | 论文 |\n\n| 乙 | 较强 | 消融 |\n\n我的总体判断：继续跟踪。'

describe('compactLooseTables', () => {
  it('removes single blank lines between the rows of a copied pipe table', () => {
    expect(compactLooseTables(loose)).toBe('### 1.1 核心技术判断\n\n| 研究维度 | 当前判断 | 证据状态 |\n| --- | --- | --- |\n| 甲 | 明确 | 论文 |\n| 乙 | 较强 | 消融 |\n\n我的总体判断：继续跟踪。')
  })

  it('keeps alignment markers and escaped pipes', () => {
    expect(compactLooseTables('| a | b \\| c |\n\n| :--- | ---: |\n\n| 1 | 2 |')).toBe('| a | b \\| c |\n| :--- | ---: |\n| 1 | 2 |')
  })

  it('stops at a row with a different cell count, a double blank line, or prose', () => {
    expect(compactLooseTables('| a | b |\n\n| --- | --- |\n\n| 1 | 2 |\n\n| 1 | 2 | 3 |')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| 1 | 2 | 3 |')
    expect(compactLooseTables('| a | b |\n\n| --- | --- |\n\n\n| 1 | 2 |')).toBe('| a | b |\n| --- | --- |\n\n\n| 1 | 2 |')
    expect(compactLooseTables('| a | b |\n\n| --- | --- |\n\nprose\n\n| 1 | 2 |')).toBe('| a | b |\n| --- | --- |\n\nprose\n\n| 1 | 2 |')
    expect(compactLooseTables('| a | b |\n\n| --- | --- |\n\nx | y |')).toBe('| a | b |\n| --- | --- |\n\nx | y |')
  })

  it('leaves tight tables, non-tables and fenced text unchanged', () => {
    for (const text of [
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      '| a | b |\n\n| x | y |\n\n| 1 | 2 |',
      '| a | b |\n\n| --- | --- | --- |',
      '| only |\n\n| --- |',
      '```\n| a | b |\n\n| --- | --- |\n```',
      '~~~~\n| a | b |\n\n| --- | --- |\n~~~~',
      '    | a | b |\n\n    | --- | --- |',
    ]) expect(compactLooseTables(text)).toBe(text)
  })
})
