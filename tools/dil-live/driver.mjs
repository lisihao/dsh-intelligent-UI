import{spawn}from'node:child_process'
import{readFile,writeFile,mkdir,access}from'node:fs/promises'
import{resolve,join}from'node:path'
import{fileURLToPath}from'node:url'
import{homedir}from'node:os'
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2)
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
const mode=args.includes('--run')?'run':'preflight'
const taskRoot=resolve(option('--task-root')??join(root,'.acceptance/dil-live-five-20261106'))
const requestFile=option('--request-file')&&resolve(option('--request-file'))
const output=resolve(option('--output-dir')??join(taskRoot,'preflight'))
if(mode==='run'&&!requestFile)throw new Error('DIL_LIVE_REQUEST_FILE_REQUIRED')
if(mode==='run'){try{await access(join(output,'dispatch.json'));throw new Error('DIL_LIVE_ALREADY_DISPATCHED: reconcile the original receipt/session; never automatically replay')}catch(error){if(error.code!=='ENOENT')throw error}}
const dshHome=join(taskRoot,'host/dsh-home'),profile='dil-live',profileDir=join(dshHome,'profiles',profile)
const env={...process.env,DSH_HOME:dshHome,DSH_TELEMETRY_DISABLED:'1',DSH_TOOLS_MODE:'native',DIL_LIVE_MODE:mode,DIL_LIVE_OUTPUT:output,...(requestFile?{DIL_LIVE_REQUEST:requestFile}:{})}
await mkdir(output,{recursive:true})
const cli=join(root,'node_modules/.bin/dsh'),driverPackage=join(taskRoot,'host/driver-package')
// This package lives only in the disposable home; it is never installed in the user's profile.
await mkdir(driverPackage,{recursive:true})
await writeFile(join(driverPackage,'index.mjs'),await readFile(new URL('./host-driver.mjs',import.meta.url),'utf8'),{mode:0o600})
await writeFile(join(driverPackage,'package.json'),JSON.stringify({name:'@lisihao/dsh-dil-live-driver',version:'0.0.0-private',private:true,type:'module',main:'index.mjs',exports:{'.':'./index.mjs','./package.json':'./package.json','./cordis.patch.yml':'./cordis.patch.yml'},dsh:{bundle:{patch:'./cordis.patch.yml'}},peerDependencies:{'@deepseek-ai/dsh-agent':'0.2.1-rc.2','@deepseek-ai/dsh-llm':'0.2.1-rc.2','@deepseek-ai/dsh-credentials':'0.2.1-rc.2'}}),{mode:0o600})
await writeFile(join(driverPackage,'cordis.patch.yml'),"- insert:\n    - id: dil-live-driver\n      name: '@lisihao/dsh-dil-live-driver'\n",{mode:0o600})
async function command(commandArgs,logPath){
 const child=spawn(cli,commandArgs,{cwd:root,env,stdio:['ignore','pipe','pipe']})
 let log='';child.stdout.on('data',b=>{log+=b.toString()});child.stderr.on('data',b=>{log+=b.toString()})
 const status=await new Promise((yes,no)=>{child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}))})
 await writeFile(logPath,log,{mode:0o600})
 return status
}
try{await access(join(profileDir,'package.json'))}catch(error){if(error.code!=='ENOENT')throw error;const result=await command(['plugin','--profile',profile,'add',driverPackage],join(output,'install.log'));if(result.code!==0)throw new Error('DIL_LIVE_SCRATCH_PROFILE_SETUP_FAILED; see private install.log')}
const credentialFile=resolve(option('--credential-file')??join(homedir(),'.dsh/.credentials.yaml'))
await writeFile(join(profileDir,'cordis.patch.yml'),`- id: credentials\n  config:\n    path: ${JSON.stringify(credentialFile)}\n    watch: false\n`,{mode:0o600})
const result=await command(['--profile',profile],join(output,'host.log'))
const receiptFile=join(output,mode==='preflight'?'preflight.json':'dispatch.json')
let receipt;try{receipt=JSON.parse(await readFile(receiptFile,'utf8'))}catch{}
console.log(JSON.stringify({mode,exitCode:result.code,signal:result.signal,receipt:receiptFile,status:receipt?.status,provider:receipt?.provider,model:receipt?.model,credentialConfigured:receipt?.credentialConfigured,modelPosts:receipt?.modelPosts}))
if(result.code!==0)process.exitCode=1
