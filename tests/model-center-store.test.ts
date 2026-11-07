import {describe,expect,it,vi} from 'vitest'
import {ModelCenterStore,type ModelCenterReaders} from '../src/model-center-store.js'
import type {CenterAccount,CenterModel} from '../src/model-center-view-model.js'
const account=(key:string,provider:string,label:string):CenterAccount=>({key,provider,label,source:'api',status:'路由已注册',fields:[],originalSection:'models'})
const model=(provider:string,id:string):CenterModel=>({key:JSON.stringify([provider,id]),provider,id,name:id,providerLabel:provider,source:'api'})
function readers():ModelCenterReaders{return{models:async()=>({accounts:[],models:[]}),web:async()=>({accounts:[],models:[]}),cost:async()=>({today:[],balances:[],quotas:[]}),subscriptions:async()=>({accounts:[]})}}
describe('model center authoritative source composition',()=>{
 it('bounds an unresponsive source without retrying it or discarding independent reads',async()=>{
  vi.useFakeTimers()
  try{const sources=readers();sources.web=vi.fn(()=>new Promise<{accounts:CenterAccount[],models:CenterModel[]}>(()=>{}));sources.models=async()=>({accounts:[account('live','deepseek','可用连接')],models:[]});const store=new ModelCenterStore(sources);const pending=store.refresh();await vi.advanceTimersByTimeAsync(15001);await pending;expect(store.snapshot().busy).toBe(false);expect(store.snapshot().sources.web.status).toBe('error');expect(store.snapshot().accounts[0]?.key).toBe('live');expect(sources.web).toHaveBeenCalledOnce();store.dispose()}finally{vi.useRealTimers()}
 })
 it('enriches only a matching registered web model, preserving host facts and distinct routes',async()=>{
  const sources=readers();sources.models=async()=>({accounts:[],models:[{...model('deepseek-web','same'),contextWindow:100},model('deepseek','same')]});sources.web=async()=>({accounts:[],models:[{...model('deepseek-web','same'),contextWindow:200,input:['image']},model('deepseek-web','unregistered')]})
  const store=new ModelCenterStore(sources);await store.refresh();expect(store.snapshot().models).toHaveLength(2);expect(store.snapshot().models[0]).toMatchObject({contextWindow:100,input:['image']});expect(store.snapshot().models[1]).not.toHaveProperty('input');store.dispose()
 })
 it('joins one account source without merging distinct saved accounts or same model ids across routes',async()=>{
  const sources=readers();sources.models=async()=>({accounts:[account('route:grok','grok-build','Grok')],models:[model('deepseek','same'),model('deepseek-web','same')]});sources.web=async()=>({accounts:[],models:[model('deepseek-web','same')]});sources.subscriptions=async()=>({accounts:[account('grok:a','grok-build','账号一'),account('grok:b','grok-build','账号二')]})
  const s=new ModelCenterStore(sources);await s.refresh();expect(s.snapshot().accounts.map(a=>a.key)).toEqual(['grok:a','grok:b']);expect(s.snapshot().models).toHaveLength(2);s.dispose()
 })
 it('shows independent errors, keeps other sources and does not invent zero money',async()=>{
  const sources=readers();sources.cost=async()=>{throw Error('secret source body')};sources.models=async()=>({accounts:[account('a','deepseek','DeepSeek')],models:[]});const s=new ModelCenterStore(sources);await s.refresh();expect(s.snapshot().sources.cost.status).toBe('error');expect(s.snapshot().usage).toBeUndefined();expect(s.snapshot().accounts).toHaveLength(1);expect(JSON.stringify(s.snapshot())).not.toContain('secret');s.dispose()
 })
 it('ignores an old refresh and settles no state after disposal',async()=>{
  let finish:(v:{accounts:CenterAccount[],models:CenterModel[]})=>void=()=>{};const sources=readers();sources.models=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>finish=resolve)).mockResolvedValue({accounts:[account('new','x','最新')],models:[]});const s=new ModelCenterStore(sources);const old=s.refresh();await s.refresh();finish({accounts:[account('old','x','旧')],models:[]});await old;expect(s.snapshot().accounts[0]?.key).toBe('new');s.dispose();await s.refresh();expect(s.snapshot().accounts[0]?.key).toBe('new')
 })
})
