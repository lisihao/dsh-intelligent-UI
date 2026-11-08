import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiCssPlugin } from '../../build-css.mjs'
import { dilReferencePlugin } from '../dil-reference.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
await build({absWorkingDir:root,entryPoints:['tools/user-message-spacing/fixture.ts'],outfile:'tools/user-message-spacing/fixture.js',bundle:true,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"',__IEXP_ELK_WORKER_SOURCE__:JSON.stringify(await readFile(resolve(root,'node_modules/elkjs/lib/elk-worker.min.js'),'utf8'))},loader:{'.css':'text','.woff2':'dataurl'},plugins:[openuiCssPlugin,dilReferencePlugin(),{name:'fixture-remote',setup(b){b.onResolve({filter:/^\.\/remote\.js$/},()=>({path:resolve(root,'tools/user-message-spacing/remote-stub.ts')}))}}]})
