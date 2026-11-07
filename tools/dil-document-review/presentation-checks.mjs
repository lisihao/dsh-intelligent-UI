/**
 * Real-browser presentation invariants for one settled review document. The function runs inside
 * the page (it must stay self-contained) and returns named issues instead of throwing.
 *
 * - theme-scope: nested embedded Markdown must inherit the document's typeface token.
 * - body-font: Markdown body text must use that typeface, not a renderer default.
 * - card-inset: a card without its own visible edge or fill must not indent its content.
 */
export function presentationIssues() {
  const surface = document.querySelector('.dil-review-document-surface')
  if (!surface) return [{ type: 'surface-missing', detail: 'document surface not found' }]
  const family = value => value.split(',')[0].trim().replace(/^["']|["']$/gu, '')
  const expected = family(getComputedStyle(surface).getPropertyValue('--iexp-font'))
  const issues = []
  for (const node of surface.querySelectorAll('.iexp-embedded-markdown')) {
    const actual = family(getComputedStyle(node).getPropertyValue('--iexp-font'))
    if (actual !== expected) issues.push({ type: 'theme-scope', detail: `${actual} != ${expected}` })
  }
  for (const node of surface.querySelectorAll('.openui-markdown-renderer :is(p, li)')) {
    if (node.closest('pre, code, .katex') || !node.textContent.trim()) continue
    const actual = family(getComputedStyle(node).fontFamily)
    if (actual !== expected) issues.push({ type: 'body-font', detail: `${actual} != ${expected}` })
  }
  for (const node of surface.querySelectorAll('.iexp-dil-card')) {
    const style = getComputedStyle(node)
    const edge = ['Top', 'Right', 'Bottom', 'Left'].some(side => style[`border${side}Style`] !== 'none' && parseFloat(style[`border${side}Width`]) > 0)
    const fill = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
    const visible = edge || fill || style.boxShadow !== 'none' || style.backgroundImage !== 'none'
    if (!visible && (parseFloat(style.paddingLeft) > 0 || parseFloat(style.paddingRight) > 0)) issues.push({ type: 'card-inset', detail: `${style.paddingLeft}/${style.paddingRight}` })
  }
  return issues
}

/** Groups issues by type with one example each, for a compact assertion message. */
export function summarizeIssues(issues) {
  const groups = new Map()
  for (const issue of issues) {
    const group = groups.get(issue.type) ?? { count: 0, example: issue.detail }
    group.count += 1
    groups.set(issue.type, group)
  }
  return Object.fromEntries(groups)
}
