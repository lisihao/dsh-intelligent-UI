import { describe, expect, it } from 'vitest'
import { fenceStandaloneJson } from '../src/user-json-fence.js'

const fenced = (text: string): string[] => [...text.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm)].map(match => match[2]!)

describe('fenceStandaloneJson', () => {
  it('fences an unindented multi-line JSON array that follows prose', () => {
    const json = '[\n[\n"search",\n{\n"query": "K13ORIGINAL"\n}\n],\n[\n"search",\n{\n"query": "K13DELTA"\n}\n]\n]'
    const output = fenceStandaloneJson(`Run these calls in order.\n${json}\nThen report.`)
    const [block] = fenced(output)
    expect(block).toBe('[\n  [\n    "search",\n    {\n      "query": "K13ORIGINAL"\n    }\n  ],\n  [\n    "search",\n    {\n      "query": "K13DELTA"\n    }\n  ]\n]')
    expect(JSON.parse(block!)).toEqual(JSON.parse(json))
    expect(output.startsWith('Run these calls in order.\n```json\n')).toBe(true)
    expect(output.endsWith('\n```\nThen report.')).toBe(true)
  })

  it('copies strings and numbers verbatim', () => {
    const json = '{"big": 12345678901234567890, "exp": 1.0e5, "text": "caf\\u00e9 \\"q\\" [x] {y}", "list": [ ], "obj": {}}'
    const [block] = fenced(fenceStandaloneJson(`Payload:\n${json}`))
    expect(block).toContain('"big": 12345678901234567890')
    expect(block).toContain('"exp": 1.0e5')
    expect(block).toContain('"text": "caf\\u00e9 \\"q\\" [x] {y}"')
    expect(block).toContain('"list": []')
    expect(block).toContain('"obj": {}')
    expect(fenced(fenceStandaloneJson('Odd:\n{"t": "a]b}c"}'))).toEqual(['{\n  "t": "a]b}c"\n}'])
  })

  it('uses a longer fence when the JSON contains backticks', () => {
    const output = fenceStandaloneJson('Snippet:\n{"code": "```js```"}')
    expect(output).toContain('````json\n{\n  "code": "```js```"\n}\n````')
  })

  it('leaves text inside an existing fence alone', () => {
    const text = 'Before\n```\n{"a": 1}\n```\nAfter'
    expect(fenceStandaloneJson(text)).toBe(text)
    const tilde = 'Before\n~~~~\n[1, 2]\n~~~~\n{"b": 2}'
    expect(fenced(fenceStandaloneJson(tilde))).toEqual(['{\n  "b": 2\n}'])
  })

  it('keeps a message that is JSON as a whole unchanged', () => {
    const text = '  {"whole": [1, 2]}  '
    expect(fenceStandaloneJson(text)).toBe(text)
  })

  it('ignores links, invalid JSON, empty containers and trailing text', () => {
    for (const text of [
      'See\n[the docs](https://example.com) for details',
      'Broken\n{"a": 1,}\nend',
      'Empty\n[]\n{}',
      'Trailing\n{"a": 1} is the payload',
      'Indented code\n    {"a": 1}',
      'Unclosed\n[1, 2\nstill prose',
    ]) expect(fenceStandaloneJson(text)).toBe(text)
  })

  it('fences more than one JSON value in a message', () => {
    expect(fenced(fenceStandaloneJson('A\n{"a": 1}\nB\n[2]\n'))).toEqual(['{\n  "a": 1\n}', '[\n  2\n]'])
  })
})
