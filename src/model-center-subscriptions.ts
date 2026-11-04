import { z } from 'zod'
import type { CenterAccount, CenterSourceState, CenterQuota } from './model-center-view-model.js'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

const text = z.string().min(1).max(512)
const accountSchema = z.object({ id: text, label: text, active: z.boolean(), expiresAt: z.number().finite().optional(), email: text.optional() })
const codexSchema = z.object({ authenticated: z.boolean(), provider: text, type: z.string().optional(), expiresAt: z.number().finite().optional(), accounts: z.array(accountSchema).optional() })
const grokSchema = z.object({ account: z.object({ signedIn: z.boolean(), maskedAccount: text.optional(), authMode: text.optional(), expiresAt: z.number().finite().optional(), source: text.optional() }) })
export interface ModelCenterSubscriptionsSnapshot {
  accounts: readonly CenterAccount[]
  quotas: readonly CenterQuota[]
  states: { codex: CenterSourceState, grok: CenterSourceState }
}
export function normalizeCodexAccountStatus(raw: unknown): CenterAccount[] {
  const parsed = codexSchema.safeParse(raw)
  if (!parsed.success) throw new Error('MODEL_CENTER_CODEX_FORMAT_INVALID: Codex 账号摘要格式与已验证版本不同。')
  const value = parsed.data
  const rows = value.accounts ?? []
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('MODEL_CENTER_CODEX_FORMAT_INVALID: Codex 账号摘要存在重复标识。')
  if (rows.length) return rows.map(row => ({ key: `codex:${row.id}`, provider: 'openai-codex', active: row.active, label: 'Codex', accountLabel: row.label, source: 'subscription' as const, status: row.active ? (value.authenticated ? '当前账号，已授权' : '当前账号，未授权') : '已保存账号', configured: row.active ? value.authenticated : undefined, fields: [{ label: '账号名称', value: row.label }, { label: '账号用途', value: row.active ? '当前请求使用的账号' : '备用账号' }, ...(row.email ? [{ label: '账号标识', value: row.email }] : [])], originalSection: 'model-subscriptions' }))
  return [{ key: 'codex:current', provider: 'openai-codex', active: true, label: 'Codex', source: 'subscription', status: value.authenticated ? '已保存授权' : '尚未登录', configured: value.authenticated, fields: [{ label: '认证方式', value: '订阅授权' }], originalSection: 'model-subscriptions' }]
}
export function normalizeGrokAccountStatus(raw: unknown): CenterAccount[] {
  const parsed = grokSchema.safeParse(raw)
  if (!parsed.success) throw new Error('MODEL_CENTER_GROK_FORMAT_INVALID: Grok 账号摘要格式与已验证版本不同。')
  const value = parsed.data.account
  return [{ key: 'grok:current', provider: 'grok-build', active: true, label: 'Grok', ...(value.maskedAccount ? { accountLabel: value.maskedAccount } : {}), source: 'subscription', status: value.signedIn ? '已保存授权' : '尚未登录', configured: value.signedIn, fields: [{ label: '认证方式', value: '订阅授权' }, ...(value.maskedAccount ? [{ label: '账号标识', value: value.maskedAccount }] : [])], originalSection: 'model-subscriptions' }]
}
export async function readModelCenterSubscriptions(rpc: Pick<ClientConnectionRpc, 'call'>, signal?: AbortSignal): Promise<ModelCenterSubscriptionsSnapshot> {
  const read = async (provider: 'codex' | 'grok') => {
    const result = await rpc.call('/api', `${provider}-subscription/status`, {}, signal)
    if (!result.ok) throw new Error('订阅状态服务不可用。')
    const accounts = provider === 'codex' ? normalizeCodexAccountStatus(result.value) : normalizeGrokAccountStatus(result.value)
    const quotas: CenterQuota[] = []
    if (provider === 'codex' && accounts.some(account => account.active && account.configured)) {
      try {
        // The owner applies its own cache/TTL; never force refresh or call a model.
        const usage = await rpc.call('/api', 'codex-subscription/usage', { force: false }, signal)
        if (!usage.ok) throw new Error('unavailable')
        quotas.push(...normalizeCodexUsage(usage.value))
      } catch { quotas.push({key:'codex:unavailable',label:'Codex',error:'订阅额度暂不可读，请重试或前往原始订阅设置。'}) }
    }
    if (provider === 'grok') quotas.push(...normalizeGrokUsage(result.value))
    return { accounts, quotas }
  }
  const [codex, grok] = await Promise.allSettled([read('codex'), read('grok')])
  const state = (result: PromiseSettledResult<{accounts:CenterAccount[],quotas:CenterQuota[]}>, label: string): CenterSourceState => result.status === 'fulfilled' ? { status: 'ready' } : { status: 'error', error: `${label} 账号摘要读取失败，请重试或前往原始设置检查。` }
  return { accounts: [...(codex.status === 'fulfilled' ? codex.value.accounts : []), ...(grok.status === 'fulfilled' ? grok.value.accounts : [])], quotas: [...(codex.status === 'fulfilled' ? codex.value.quotas : []), ...(grok.status === 'fulfilled' ? grok.value.quotas : [])], states: { codex: state(codex, 'Codex'), grok: state(grok, 'Grok') } }
}

const percent=z.number().finite()
const codexUsageSchema=z.object({rateLimits:z.array(z.object({id:text,name:text.optional(),windows:z.array(z.object({usedPercent:percent,remainingPercent:percent.optional(),windowSeconds:z.number().int().positive(),resetsAt:z.number().finite().optional()}))}))})
export function normalizeCodexUsage(raw:unknown):CenterQuota[]{
 const parsed=codexUsageSchema.safeParse(raw);if(!parsed.success)throw Error('MODEL_CENTER_CODEX_USAGE_INVALID: Codex 额度摘要格式不受支持。')
 return parsed.data.rateLimits.flatMap(limit=>limit.windows.map((window,index)=>({key:JSON.stringify(['codex',limit.id,index]),label:limit.name??'Codex',window:window.windowSeconds%86400===0?`${window.windowSeconds/86400} 天窗口`:window.windowSeconds%3600===0?`${window.windowSeconds/3600} 小时窗口`:`${Math.round(window.windowSeconds/60)} 分钟窗口`,usedPercent:window.usedPercent,...(window.remainingPercent!==undefined?{remainingPercent:window.remainingPercent}:{remainingPercent:100-window.usedPercent}),...(window.resetsAt!==undefined?{resetAt:window.resetsAt*1000}:{})})))
}
const grokUsageSchema=z.object({usage:z.object({status:text,usedPercent:percent.optional(),remainingPercent:percent.optional(),periodEnd:z.union([z.string(),z.number().finite()]).optional()}).optional()})
export function normalizeGrokUsage(raw:unknown):CenterQuota[]{
 const parsed=grokUsageSchema.safeParse(raw);if(!parsed.success)throw Error('MODEL_CENTER_GROK_USAGE_INVALID: Grok 额度摘要格式不受支持。')
 const usage=parsed.data.usage;if(!usage||usage.status!=='ok')return[{key:'grok:unavailable',label:'Grok',window:'来源尚未提供可用额度'}]
 const reset=typeof usage.periodEnd==='string'?Date.parse(usage.periodEnd):usage.periodEnd
 return[{key:'grok:usage',label:'Grok',window:'来源提供的额度期间',...(usage.usedPercent!==undefined?{usedPercent:usage.usedPercent}:{}),...(usage.remainingPercent!==undefined?{remainingPercent:usage.remainingPercent}:{}),...(reset!==undefined&&Number.isFinite(reset)?{resetAt:reset}:{})}]
}
