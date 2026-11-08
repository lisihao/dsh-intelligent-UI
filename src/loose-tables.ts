/**
 * Display-only repair for Markdown copied from a rendered page: a pipe table
 * whose rows are separated by single blank lines is not a GFM table, so it
 * renders as separate lines. When a header row, a delimiter row and every
 * following row have the same cell count and are each separated by exactly
 * one blank line, those blank lines are removed. Nothing else changes.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const ROW = /^ {0,3}\|.*\|\s*$/
const DELIMITER_CELL = /^\s*:?-{3,}:?\s*$/

export function compactLooseTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fence: { char: string, length: number } | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const marker = FENCE.exec(line)
    if (fence) {
      if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined
      out.push(line); continue
    }
    if (marker) { fence = { char: marker[1]![0]!, length: marker[1]!.length }; out.push(line); continue }
    const width = ROW.test(line) ? cells(line).length : 0
    const delimiter = lines[i + 2]
    if (width < 2 || !blank(lines[i + 1]) || delimiter === undefined || !isDelimiter(delimiter, width)) { out.push(line); continue }
    out.push(line, delimiter)
    let next = i + 2
    while (blank(lines[next + 1]) && lines[next + 2] !== undefined && ROW.test(lines[next + 2]!) && cells(lines[next + 2]!).length === width) {
      out.push(lines[next + 2]!)
      next += 2
    }
    i = next
  }
  return out.join('\n')
}

function blank(line: string | undefined): boolean {
  return line !== undefined && !line.trim()
}

function isDelimiter(line: string, width: number): boolean {
  if (!ROW.test(line)) return false
  const parts = cells(line)
  return parts.length === width && parts.every(cell => DELIMITER_CELL.test(cell))
}

/** Cells of one pipe row; an escaped `\|` does not split a cell. */
function cells(line: string): string[] {
  const body = line.trim().slice(1, -1)
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') { current += '\\|'; i++; continue }
    if (body[i] === '|') { parts.push(current); current = ''; continue }
    current += body[i]
  }
  parts.push(current)
  return parts
}
