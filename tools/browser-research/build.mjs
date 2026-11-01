import { build } from 'esbuild'
import { openuiCssPlugin } from '../../build-css.mjs'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
await build({absWorkingDir:root,entryPoints:['tools/browser-research/fixture.ts'],outfile:'tools/browser-research/fixture.js',bundle:true,format:'esm',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'text','.woff2':'dataurl'},plugins:[openuiCssPlugin]})
await build({absWorkingDir:root,entryPoints:['src/research-store.ts'],outfile:'.acceptance/research-store.mjs',bundle:true,packages:'external',platform:'node',target:'node22',format:'esm'})
