import type { CenterAccount, CenterModel, CenterUsage, CenterQuota, ModelCenterViewState } from './model-center-view-model.js'
export interface ModelCenterReaders {
  models(signal: AbortSignal): Promise<{ accounts: readonly CenterAccount[], models: readonly CenterModel[], warning?: string }>
  web(signal: AbortSignal): Promise<{ accounts: readonly CenterAccount[], models: readonly CenterModel[], warning?: string }>
  cost(signal: AbortSignal): Promise<CenterUsage>
  subscriptions(signal: AbortSignal): Promise<{ accounts: readonly CenterAccount[], quotas?: readonly CenterQuota[], warning?: string }>
}
const loading = () => ({ status: 'loading' as const })
const initial = (): ModelCenterViewState => ({ accounts: [], models: [], sources: { models: loading(), web: loading(), cost: loading(), subscriptions: loading() }, busy: false })
const publicErrors = { models: '模型目录读取失败，请重试或打开原始模型设置。', web: '网页登录摘要读取失败，请重试或打开原始网页登录设置。', cost: '费用摘要读取失败，请重试或打开原始费用设置。', subscriptions: '订阅账号摘要读取失败，请重试或打开原始订阅设置。' }
// A missing optional source must not leave every independent source loading forever.
// Timeout cancels the read only; it never replays a request or a write.
function boundedRead<T>(read: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> {
 const controller = new AbortController()
 return new Promise<T>((resolve,reject) => {
  const cancel = () => { controller.abort(); clearTimeout(timer);parent.removeEventListener('abort',cancel);reject(Error('cancelled')) }
  parent.addEventListener('abort',cancel,{once:true})
  const timer = setTimeout(() => { controller.abort();finish();reject(Error('source timed out')) },15000)
  const finish = () => { clearTimeout(timer);parent.removeEventListener('abort',cancel) }
  if(parent.aborted){cancel();finish();return}
  Promise.resolve().then(() => read(controller.signal)).then(resolve,reject).finally(finish)
 })
}
/** Owns no durable data; every displayed fact is re-derived from an existing owner. */
export class ModelCenterStore {
 private value = initial()
 private readonly listeners = new Set<() => void>()
 private generation = 0
 private lifetime?: AbortController
 private stopped = false
 constructor(private readonly readers: ModelCenterReaders) {}
 snapshot = () => this.value
 subscribe = (listener: () => void) => { this.listeners.add(listener);return () => {this.listeners.delete(listener)} }
 private publish(value: ModelCenterViewState) { this.value=value;this.listeners.forEach(listener=>listener()) }
 async refresh(): Promise<void> {
  if(this.stopped)return
  const generation=++this.generation
  this.lifetime?.abort();const controller=new AbortController();this.lifetime=controller
  this.publish({...this.value,busy:true,error:undefined,sources:{models:loading(),web:loading(),cost:loading(),subscriptions:loading()}})
  const [models,web,cost,subscriptions]=await Promise.allSettled([boundedRead(signal=>this.readers.models(signal),controller.signal),boundedRead(signal=>this.readers.web(signal),controller.signal),boundedRead(signal=>this.readers.cost(signal),controller.signal),boundedRead(signal=>this.readers.subscriptions(signal),controller.signal)])
  if(this.stopped || generation!==this.generation || controller.signal.aborted)return
  const accounts: CenterAccount[]=[]
  const specific=[...(web.status==='fulfilled'?web.value.accounts:[]),...(subscriptions.status==='fulfilled'?subscriptions.value.accounts:[])]
  const authoritativeProviders=new Set(specific.flatMap(row=>row.provider?[row.provider]:[]))
  if(models.status==='fulfilled')accounts.push(...models.value.accounts.filter(row=>!row.provider || !authoritativeProviders.has(row.provider)))
  accounts.push(...specific)
  const uniqueAccounts=new Map<string,CenterAccount>();for(const row of accounts)if(!uniqueAccounts.has(row.key))uniqueAccounts.set(row.key,row)
  const sourceModels=models.status==='fulfilled'?models.value.models:[]
  // The host catalog owns a route's models; web metadata only fills a route missing from that catalog.
  const hostProviders=new Set(sourceModels.map(row=>row.provider))
  const webModels=web.status==='fulfilled'?web.value.models:[]
  const webByKey=new Map(webModels.map(row=>[row.key,row]))
  const enriched=sourceModels.map(row=>{const extra=webByKey.get(row.key);return row.provider==='deepseek-web'&&extra?{...row,...(row.input===undefined&&extra.input!==undefined?{input:extra.input}:{}),...(row.contextWindow===undefined&&extra.contextWindow!==undefined?{contextWindow:extra.contextWindow}:{}),...(row.reasoningEfforts===undefined&&extra.reasoningEfforts!==undefined?{reasoningEfforts:extra.reasoningEfforts}:{})}:row})
  const combined=[...enriched,...webModels.filter(row=>!hostProviders.has(row.provider))]
  const uniqueModels=new Map<string,CenterModel>();for(const row of combined)if(!uniqueModels.has(row.key)){
   const account=[...uniqueAccounts.values()].find(account=>account.provider===row.provider && account.active===true)
   uniqueModels.set(row.key,{...row,...(account?.accountLabel?{accountLabel:account.accountLabel}:{})})
  }
  const status=(key:keyof typeof publicErrors,result:PromiseSettledResult<unknown>)=>{if(result.status==='rejected')return{status:'error' as const,error:publicErrors[key]};const warning=result.value && typeof result.value==='object' && 'warning' in result.value ? (result.value as {warning?:string}).warning : undefined;return warning?{status:'error' as const,error:warning}:{status:'ready' as const}}
  const subscriptionQuotas=subscriptions.status==='fulfilled'?subscriptions.value.quotas??[]:[]
  const baseUsage=cost.status==='fulfilled'?cost.value:{today:[],balances:[],quotas:[]}
  const quotaMap=new Map(baseUsage.quotas.map(row=>[row.key,row]));subscriptionQuotas.forEach(row=>quotaMap.set(row.key,row))
  this.publish({accounts:[...uniqueAccounts.values()],models:[...uniqueModels.values()],...((cost.status==='fulfilled'||subscriptionQuotas.length)?{usage:{...baseUsage,quotas:[...quotaMap.values()]}}:{}),busy:false,sources:{models:status('models',models),web:status('web',web),cost:status('cost',cost),subscriptions:status('subscriptions',subscriptions)}})
 }
 cancel(){this.generation++;this.lifetime?.abort()}
 reportError(error:string){if(!this.stopped)this.publish({...this.value,error})}
 dispose(){this.stopped=true;this.generation++;this.lifetime?.abort();this.listeners.clear()}
}
