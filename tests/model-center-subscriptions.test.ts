import { describe, expect, it, vi } from 'vitest'
import { normalizeCodexAccountStatus, normalizeGrokAccountStatus, normalizeCodexUsage, normalizeGrokUsage, readModelCenterSubscriptions } from '../src/model-center-subscriptions.js'

describe('model center subscription summaries', () => {
 it('accepts Grok owner ISO expiry metadata while projecting only the fields used by the center',()=>{
  expect(normalizeGrokAccountStatus({account:{signedIn:true,maskedAccount:'a***@example.invalid',expiresAt:'2030-01-01T00:00:00Z',authMode:'oidc',source:'grok-cli'}})[0]).toMatchObject({configured:true,status:'已保存授权'})
 })
 it('keeps zero and over-quota values and converts owner reset seconds exactly', () => {
  const rows=normalizeCodexUsage({rateLimits:[{id:'codex',windows:[{usedPercent:100,remainingPercent:0,windowSeconds:18000,resetsAt:1890000000},{usedPercent:125,windowSeconds:604800}]}]})
  expect(rows[0]).toMatchObject({remainingPercent:0,resetAt:1890000000000,window:'5 小时窗口'})
  expect(rows[1]).toMatchObject({usedPercent:125,remainingPercent:-25,window:'7 天窗口'})
  expect(normalizeGrokUsage({usage:{status:'ok'}})[0]).not.toHaveProperty('remainingPercent')
  expect(normalizeGrokUsage({usage:{status:'ok',remainingPercent:0,periodEnd:'2030-01-01T00:00:00Z'}})[0]).toMatchObject({remainingPercent:0,resetAt:Date.parse('2030-01-01T00:00:00Z')})
 })
 it('requests only owner-cached usage for an authorized Codex account and retains it on usage failure', async () => {
  const calls:Array<[string,unknown]>=[]
  const call=vi.fn(async (_channel:string,endpoint:string,args:unknown)=>{calls.push([endpoint,args]);return endpoint==='codex-subscription/status'?{ok:true as const,value:{authenticated:true,provider:'openai-codex'}}:endpoint==='grok-subscription/status'?{ok:true as const,value:{account:{signedIn:false}}}:{ok:false as const,error:{code:'internal' as const,message:'private source detail',details:{}}}})
  const result=await readModelCenterSubscriptions({call})
  expect(calls).toContainEqual(['codex-subscription/usage',{force:false}]);expect(result.accounts.find(account=>account.provider==='openai-codex')?.configured).toBe(true)
  expect(result.quotas[0]?.error).toContain('暂不可读');expect(JSON.stringify(result)).not.toContain('private source detail')
 })
 it('retains separate saved accounts and strips credential material', () => {
  const rows = normalizeCodexAccountStatus({ authenticated: true, provider: 'openai-codex', token: 'private-token', accounts: [{ id: 'a', label: '主账号', active: true, credential: { refresh: 'private-refresh' } }, { id: 'b', label: '备用', active: false }] })
  expect(rows).toHaveLength(2);expect(rows[0]?.configured).toBe(true);expect(rows[1]?.configured).toBeUndefined();expect(JSON.stringify(rows)).not.toMatch(/private-|credential|refresh/)
 })
 it('does not infer authentication from a route, quota or model count', () => {
  expect(normalizeGrokAccountStatus({ account: { signedIn: false }, catalog: { models: ['a'] }, usage: { remaining: 100 } })[0]?.configured).toBe(false)
  expect(() => normalizeGrokAccountStatus({ catalog: {} })).toThrow(/MODEL_CENTER_GROK_FORMAT_INVALID/)
 })
 it('rejects duplicate account identity without changing data', () => {
  expect(() => normalizeCodexAccountStatus({ authenticated:true,provider:'openai-codex',accounts:[{id:'a',label:'a',active:true},{id:'a',label:'b',active:false}] })).toThrow(/FORMAT_INVALID/)
 })
 it('uses only normal status endpoints, preserves partial results and never asks for usage refresh or login', async () => {
  const call = vi.fn(async (_channel:string,endpoint:string) => endpoint.startsWith('codex') ? {ok:true as const,value:{authenticated:false,provider:'openai-codex'}} : {ok:false as const,error:{code:'internal' as const,message:'secret upstream payload',details:{}}})
  const value=await readModelCenterSubscriptions({call});expect(call.mock.calls.map(row=>row[1])).toEqual(['codex-subscription/status','grok-subscription/status']);expect(value.accounts).toHaveLength(1);expect(value.states.grok.status).toBe('error');expect(JSON.stringify(value)).not.toContain('secret')
 })
})
