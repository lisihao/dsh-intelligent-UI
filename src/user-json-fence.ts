/**
 * Display-only repair for a user's own message: a standalone JSON object or
 * array pasted without a Markdown fence is shown as an indented `json` code
 * block. Only whitespace between JSON tokens changes; every string, number
 * and literal keeps its exact source text. The Chat row keeps the raw message.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const CANDIDATE = /^ {0,3}[[{]/
/** One scan never reads more than this many characters past its opening bracket. */
const MAX_SCAN = 200_000
/** Failed scans stop being attempted once this many characters were read in total. */
const MAX_TOTAL_SCAN = 2_000_000

export function fenceStandaloneJson(text: string): string {
  // A message that is JSON as a whole stays on the existing structured path.
  if (/^\s*[[{]/.test(text)) { try { JSON.parse(text); return text } catch { /* Mixed Markdown. */ } }
  let out = '', cursor = 0, lineStart = 0, scanned = 0
  let fence: { char: string, length: number } | undefined
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(lineStart, lineEnd)
    const marker = FENCE.exec(line)
    if (fence) {
      if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined
    } else if (marker) {
      fence = { char: marker[1]![0]!, length: marker[1]!.length }
    } else if (CANDIDATE.test(line) && scanned < MAX_TOTAL_SCAN) {
      const open = lineStart + line.search(/[[{]/)
      const close = closingBracket(text, open)
      scanned += (close ?? Math.min(text.length, open + MAX_SCAN)) - open
      if (close !== undefined) {
        const rest = text.indexOf('\n', close)
        const restEnd = rest === -1 ? text.length : rest
        const source = text.slice(open, close + 1)
        if (!text.slice(close + 1, restEnd).trim() && nonEmptyContainer(source)) {
          const formatted = reindent(source)
          const ticks = '`'.repeat(Math.max(3, longestBacktickRun(formatted) + 1))
          out += text.slice(cursor, lineStart) + `${ticks}json\n${formatted}\n${ticks}`
          cursor = restEnd
          lineStart = rest === -1 ? text.length : rest + 1
          continue
        }
      }
    }
    lineStart = newline === -1 ? text.length : newline + 1
  }
  return cursor === 0 ? text : out + text.slice(cursor)
}

/** Index of the bracket that closes `text[open]`, skipping JSON strings. */
function closingBracket(text: string, open: number): number | undefined {
  let depth = 0
  const limit = Math.min(text.length, open + MAX_SCAN)
  for (let i = open; i < limit; i++) {
    const c = text[i]
    if (c === '"') { i = stringEnd(text, i) - 1; continue }
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return i }
  }
  return undefined
}

function stringEnd(text: string, quote: number): number {
  for (let i = quote + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i + 1
  }
  return text.length
}

function nonEmptyContainer(source: string): boolean {
  let value: unknown
  try { value = JSON.parse(source) } catch { return false }
  return Array.isArray(value) ? value.length > 0 : value !== null && typeof value === 'object' && Object.keys(value).length > 0
}

/** Two-space indentation of already validated JSON, copying each token verbatim. */
function reindent(source: string): string {
  let out = '', depth = 0
  const pad = (): string => '\n' + '  '.repeat(depth)
  for (let i = 0; i < source.length;) {
    const c = source[i]!
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; continue }
    if (c === '"') { const end = stringEnd(source, i); out += source.slice(i, end); i = end; continue }
    if (c === '[' || c === '{') {
      let next = i + 1
      while (/\s/.test(source[next] ?? '')) next++
      if (source[next] === (c === '[' ? ']' : '}')) { out += c + source[next]; i = next + 1; continue }
      depth++; out += c + pad(); i++; continue
    }
    if (c === ']' || c === '}') { depth--; out += pad() + c; i++; continue }
    if (c === ',') { out += ',' + pad(); i++; continue }
    if (c === ':') { out += ': '; i++; continue }
    let end = i
    while (end < source.length && !' \n\r\t,:]}'.includes(source[end]!)) end++
    out += source.slice(i, end); i = end
  }
  return out
}

function longestBacktickRun(text: string): number {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return longest
}
