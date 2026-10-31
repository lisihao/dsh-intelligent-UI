import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { builtInThemes, MAX_THEME_BYTES, themePackageSchema, type ThemePackage } from './theme-contracts.js'
import { themeCatalogSchema, themeSourceDirectory, type ThemeCatalog, type DownloadThemeInput, downloadThemeSchema, DEFAULT_THEME_SOURCE } from './theme-source.js'
import { ExperienceStore, RevisionConflictError } from './store.js'

async function readJson(url: string, limit: number, fetcher: typeof fetch): Promise<{ value: unknown; bytes: Buffer }> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`主题下载失败（HTTP ${response.status}），请检查来源地址和仓库访问权限。`)
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('主题下载内容超过大小限制。') }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('主题来源返回了空内容。')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); throw new Error('主题下载内容超过大小限制。') }; chunks.push(value) }
  } finally { reader.releaseLock() }
  const bytes = Buffer.concat(chunks)
  try { return { value: JSON.parse(bytes.toString('utf8')), bytes } } catch { throw new Error('主题来源未返回有效 JSON，请检查目录地址及访问权限。') }
}
async function catalogFrom(source: string, fetcher: typeof fetch): Promise<ThemeCatalog> {
  const result = await readJson(new URL('index.json', themeSourceDirectory(source)).href, 64 * 1024, fetcher)
  const parsed = themeCatalogSchema.safeParse(result.value)
  if (!parsed.success) throw new Error('主题目录格式无效；需要 formatVersion: 1 的 index.json。')
  return { ...parsed.data, source }
}
export async function listSourceThemes(store: ExperienceStore, fetcher: typeof fetch = fetch): Promise<ThemeCatalog> {
  const settings = await store.settings()
  return catalogFrom(settings.themeSource ?? DEFAULT_THEME_SOURCE, fetcher)
}
export async function downloadSourceTheme(store: ExperienceStore, input: DownloadThemeInput, fetcher: typeof fetch = fetch) {
  const parsed = downloadThemeSchema.parse(input), current = await store.settings()
  if (current.revision !== parsed.expectedRevision) throw new RevisionConflictError(parsed.expectedRevision, current.revision)
  const source = current.themeSource ?? DEFAULT_THEME_SOURCE
  if (source !== parsed.source) throw new Error('主题来源已变化，请重新浏览主题。')
  const catalog = await catalogFrom(source, fetcher)
  const entry = catalog.themes.find(theme => theme.id === parsed.id)
  if (!entry) throw new Error('主题已不在当前目录中，请刷新主题列表。')
  const { value, bytes } = await readJson(new URL(entry.file, themeSourceDirectory(source)).href, MAX_THEME_BYTES, fetcher)
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('主题文件与目录校验值不一致，请刷新目录后重试。')
  const theme = themePackageSchema.parse(value)
  if (theme.id !== entry.id || theme.name !== entry.name || theme.version !== entry.version) throw new Error('主题文件与目录中的名称、版本或标识不一致。')
  const existing = [...builtInThemes, ...(current.theme?.installed ?? [])].find(item => item.id === theme.id)
  if (existing) {
    if (!isDeepStrictEqual(existing, theme)) throw new Error('已有同名但内容不同的主题，请先移除旧主题或使用不同标识。')
    // Re-read after the download; never acknowledge stale settings or a changed source.
    const latest = await store.settings()
    if (latest.revision !== parsed.expectedRevision) throw new RevisionConflictError(parsed.expectedRevision, latest.revision)
    return latest
  }
  return store.installTheme({ expectedRevision: parsed.expectedRevision, theme: theme as ThemePackage })
}
