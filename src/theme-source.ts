import { z } from 'zod'
import { themeIdSchema } from './theme-contracts.js'

export const DEFAULT_THEME_SOURCE = 'https://raw.githubusercontent.com/lisihao/dsh-intelligent-UI/main/theme/'
export const DEFAULT_THEME_REPOSITORY = 'https://github.com/lisihao/dsh-intelligent-UI/tree/main/theme'
export const themeSourceSchema = z.string().trim().min(1).max(2048).url().refine(value => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}, '主题来源需要 HTTP(S) 目录地址，不包含登录信息、查询参数或锚点。')
export function themeSourceDirectory(value: string): string {
  const url = new URL(themeSourceSchema.parse(value))
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[2] !== 'tree' || parts.length < 4) throw new Error('请填写 GitHub 的目录链接（包含 tree/分支/目录），或原始文件目录地址。')
    return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}/`
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}
export const catalogEntrySchema = z.strictObject({
  id: themeIdSchema, name: z.string().min(1).max(80), version: z.string().min(1).max(64),
  file: z.string().max(128).regex(/^[a-z0-9][a-z0-9._-]*\.dsh-theme\.json$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export const themeCatalogSchema = z.strictObject({ formatVersion: z.literal(1), themes: z.array(catalogEntrySchema).max(128) }).superRefine((value, ctx) => {
  const ids = new Set<string>()
  for (const entry of value.themes) { if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: '主题目录包含重复标识。' }); ids.add(entry.id) }
})
export const themeCatalogResultSchema = themeCatalogSchema.safeExtend({ source: themeSourceSchema })
export type ThemeCatalog = z.infer<typeof themeCatalogResultSchema>
export const downloadThemeSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative(), source: themeSourceSchema, id: themeIdSchema })
export type DownloadThemeInput = z.infer<typeof downloadThemeSchema>
