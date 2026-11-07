/**
 * Shared server/browser CSS rule. Registry metadata is calculated from exactly
 * this string, and the browser checks it before replacing a fixed declaration
 * range. Do not add a second, similar sanitizer in either consumer.
 */
export function sanitizeUiverseCss(css: string): string {
  return css.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    .replaceAll(/@import\s+(?:url\(\s*)?["']?(?:https?:|\/\/)[^;)]*(?:\)[^;]*)?;?/giu, '')
    .replaceAll(/url\(\s*["']?(?:https?:|\/\/)[^)]*\)/giu, 'none')
}
