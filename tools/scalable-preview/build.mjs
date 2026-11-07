import { dilReferencePlugin } from '../dil-reference.mjs'
import { build } from 'esbuild'
import { mkdir, readFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiCssPlugin } from '../../build-css.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
// Already ignored by the repository: generated browser code never enters tools/ source.
const output = resolve(root, '.acceptance/scalable-preview')
await mkdir(output, { recursive: true })
await build({
  absWorkingDir: root, entryPoints: ['tools/scalable-preview/fixture.ts'], outfile: resolve(output, 'bundle.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"', __IEXP_ELK_WORKER_SOURCE__: JSON.stringify(await readFile(resolve(root, 'node_modules/elkjs/lib/elk-worker.min.js'), 'utf8')) },
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  plugins: [openuiCssPlugin, dilReferencePlugin(), { name: 'scalable-preview-remotes', setup(b) { b.onResolve({ filter: /^\.\/remote\.js$/ }, () => ({ path: resolve(root, 'tools/browser-experience/remote-stub.ts') })) } }],
})
await copyFile(resolve(root, 'tools/scalable-preview/index.html'), resolve(output, 'index.html'))
console.log(`Scalable preview built: ${output}`)
console.log(`Serve locally: python3 -m http.server 8878 --bind 127.0.0.1 --directory ${output}`)
