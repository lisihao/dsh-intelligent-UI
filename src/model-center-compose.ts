import type { ModelCenterCostSnapshot } from './model-center-cost.js'
import type { ModelCenterWebSnapshot } from './model-center-web.js'
import type { CenterAccount, CenterModel, CenterQuota, CenterUsage, ModelCenterSource } from './model-center-view-model.js'
export function modelCenterSource(provider: string): ModelCenterSource {
 if(provider==='deepseek-web')return 'web'
 if(provider==='openai-codex'||provider==='grok-build')return 'subscription'
 return 'other'
}
const vendorLabels:Readonly<Record<string,string>>={go:'OpenCode Go',anthropic:'Claude',claude:'Claude',zai:'智谱',glm:'智谱',minimax:'MiniMax',kimi:'Kimi',openrouter:'OpenRouter',siliconflow:'硅基流动',commandcode:'CommandCode',scnet:'算力互联',volcengine:'火山方舟',qwen:'通义千问',mimo:'小米 MiMo',opendesign:'OpenDesign',factory:'Factory',codex:'Codex'}
const windowLabels:Readonly<Record<string,string>>={rolling:'滚动窗口',weekly:'每周额度',monthly:'每月额度',fiveHour:'5 小时窗口',five_hour:'5 小时窗口',sevenDay:'7 天窗口',main:'主要额度窗口',primary:'主要额度窗口',secondary:'次要额度窗口',credits:'账户额度'}
const periodLabels:Readonly<Record<string,string>>={day:'今日',month:'本月',all:'累计',custom:'指定日期范围'}
export function composeModelCenterUsage(value: ModelCenterCostSnapshot): CenterUsage {
 const quotas:CenterQuota[]=[]
 for(const [id,plan] of [['go',value.goQuota] as const,...Object.entries(value.codingPlans)]){
  if(plan.status==='off')continue
  const label=Object.hasOwn(vendorLabels,id)?vendorLabels[id]!:'其他订阅'
  if(plan.status==='error'){quotas.push({key:id,label,error:'该来源暂未返回可用额度，请前往原始费用设置检查。'});continue}
  const windows=Object.entries(plan.windows)
  if(!windows.length)quotas.push({key:id,label,window:'来源未提供额度窗口'})
  for(const [name,window] of windows){const parsedReset=window.resetsAt?Date.parse(window.resetsAt):NaN;quotas.push({key:JSON.stringify([id,name]),label,window:window.unlimited?'来源标记为不限额':(Object.hasOwn(windowLabels,name)?windowLabels[name]!:'来源提供的额度窗口'),...(window.used!==undefined?{usedPercent:window.used}:{}),...(window.remaining!==undefined?{remainingPercent:window.remaining}:{}),...(Number.isFinite(parsedReset)?{resetAt:parsedReset}:{})})}
 }
 const estimate=value.today.apiEstimate
 return {...(value.balance.status==='error'?{warning:'账户余额暂不可读，已保留可用费用账本。'}:{}),today:estimate?[{value:estimate.amount,currency:estimate.currency,meaning:'按原费用账本估算的 API 费用，不含订阅等效金额'}]:[],balances:value.balance.status==='ok'&&value.balance.total!==undefined&&value.balance.currency?[{key:'official-balance',label:'官方账户余额',money:{value:value.balance.total,currency:value.balance.currency,meaning:'来源返回的账户余额'},...(value.balance.fetchedAt!==undefined?{updatedAt:value.balance.fetchedAt}:{})}]:[],quotas,budget:{enabled:value.budget.enabled,limit:value.budget.amount,currency:value.budget.currency,period:periodLabels[value.budget.period]??'预算期间',...(value.budget.used!==undefined?{used:value.budget.used}:{})}}
}
export function composeModelCenterWeb(value: ModelCenterWebSnapshot): {accounts:CenterAccount[],models:CenterModel[],warning?:string} {
 const provider='deepseek-web'
 const states={active:'当前账号',ready:'已保存账号',limited:'账号受到限制',unverified:'登录状态未验证','verification-error':'账号验证失败','check-error':'账号检查失败'}
 const accounts:CenterAccount[]=(value.accounts??[]).map(row=>({key:JSON.stringify([provider,row.id]),provider,active:row.isActive,label:'DeepSeek 网页',accountLabel:row.label,source:'web',status:states[row.state],fields:[{label:'账号名称',value:row.label},{label:'通道',value:'DeepSeek 网页'},{label:'使用状态',value:row.isActive?'当前请求使用的账号':'备用账号'},...(row.display?[{label:'账号标识',value:row.display}]:[])],originalSection:'deepseek-web-login'}))
 if(!accounts.length&&value.status?.auth)accounts.push({key:'deepseek-web:current',provider,active:true,label:'DeepSeek 网页',...(value.status.auth.display?{accountLabel:value.status.auth.display}:{}),source:'web',status:value.status.auth.loggedIn===true?'已保存网页登录状态':value.status.auth.loggedIn===false?'尚未登录':'登录状态未确认',fields:[{label:'认证方式',value:'网页会话'}],originalSection:'deepseek-web-login'})
 const models:CenterModel[]=(value.models??[]).map(row=>({key:JSON.stringify([provider,row.id]),provider,id:row.id,name:row.label??'DeepSeek 网页模型',providerLabel:'DeepSeek 网页',source:'web',...(row.capabilities.length?{input:row.capabilities.filter(item=>item==='text'||item==='image')}:{ }),...(row.capabilities.includes('thinking')?{reasoningEfforts:['支持思考']}:{ }),...(row.contextWindow!==undefined?{contextWindow:row.contextWindow}:{})}))
 if(value.errors.length===3)throw Error('MODEL_CENTER_WEB_UNAVAILABLE: 网页登录摘要服务不可用。')
 return {accounts,models,...(value.errors.length?{warning:'部分网页登录摘要不可读，已保留其他可用信息。'}:{})}
}
