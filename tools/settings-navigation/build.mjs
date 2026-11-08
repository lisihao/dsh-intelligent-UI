import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
await build({absWorkingDir:root,entryPoints:['tools/settings-navigation/fixture.ts'],outfile:'tools/settings-navigation/fixture.js',bundle:true,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
