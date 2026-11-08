import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
await build({absWorkingDir:fileURLToPath(new URL('../../',import.meta.url)),entryPoints:['tools/model-center/fixture.ts'],outfile:'tools/model-center/fixture.js',bundle:true,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
