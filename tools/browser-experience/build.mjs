import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { reportToMarkdown } from '../fixtures/intelligent-experience-real-output/index.mjs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiCssPlugin } from '../../build-css.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const bytes = process.env.EXPERIENCE_REAL_REPORT ? await readFile(process.env.EXPERIENCE_REAL_REPORT) : null
const markdown = process.env.EXPERIENCE_MARKDOWN_REPORT ? await readFile(process.env.EXPERIENCE_MARKDOWN_REPORT, 'utf8') : bytes ? reportToMarkdown(JSON.parse(bytes), { sha256: createHash('sha256').update(bytes).digest('hex') }).markdown : null
const actualLayouts = process.env.EXPERIENCE_LAYOUT_OUTPUTS ? Object.fromEntries(await Promise.all(
  ['graph', 'tasks', 'records'].map(async name => {
    const raw = await readFile(resolve(process.env.EXPERIENCE_LAYOUT_OUTPUTS, `${name}.json`), 'utf8')
    return [name, JSON.parse(raw)]
  }),
)) : null
if (actualLayouts) actualLayouts.commands = await readFile(resolve(process.env.EXPERIENCE_LAYOUT_OUTPUTS, 'commands.md'), 'utf8')
await build({ absWorkingDir: root, entryPoints: ['tools/browser-experience/fixture.ts'], bundle: true, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"', __IEXP_ELK_WORKER_SOURCE__: JSON.stringify(await readFile(resolve(root, 'node_modules/elkjs/lib/elk-worker.min.js'), 'utf8')), REAL_REPORT_MARKDOWN: JSON.stringify(markdown), ACTUAL_LAYOUT_OUTPUTS: JSON.stringify(actualLayouts), REPORT_KIND: JSON.stringify(process.env.EXPERIENCE_MARKDOWN_REPORT ? 'research' : bytes ? 'test' : 'synthetic') }, outfile: 'tools/browser-experience/fixture.js', loader: { '.css': 'text', '.woff2': 'dataurl' }, plugins: [openuiCssPlugin, { name: 'fixture-remote', setup(b) { b.onResolve({ filter: /^\.\/remote\.js$/ }, () => ({ path: resolve(root, 'tools/browser-experience/remote-stub.ts') })) } }] })
