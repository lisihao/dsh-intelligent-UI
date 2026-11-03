import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openuiCssPlugin } from '../../build-css.mjs'

// All built modules, including an optional private report, stay outside Git.
process.umask(0o077)
const root = fileURLToPath(new URL('../../', import.meta.url))
const sourceRoot = '/private/tmp/dsh-canvas-ui-reference-a04a99b'
const outputRoot = resolve(process.env.ASCII_GPU_FIXTURE_DIR ?? '/private/tmp/iexp-ascii-gpu-fixture-20261102')
if (!outputRoot.startsWith('/private/tmp/iexp-ascii-gpu-')) throw new Error('Fixture output must remain in a dedicated private temporary directory.')
const pinned = {
  'LICENSE.md': '2a9a221a47f581d7984ca3a568e38fb17d5b6e43164db3f3482b4767c8e8e5b3',
  'src/lib/Asciify/AsciifyVanilla.ts': '71911119f429fcec82e53c3935e7604af6931a64b05ddfd32b73c8001da8c1d2',
  'src/lib/AsciiObject/AsciiObjectVanilla.ts': '77ed695e83910f993320b2aad51a66b603d4672071f9c64e038556172230b571',
  'src/lib/InkObject/InkObjectVanilla.ts': '626b242ae7908c5698166802e0412bc4d87479f10857b2477fb00371e39daaf1',
  'src/lib/canvas-viewport.ts': 'd88c8a55a656f81e6386570058f1bc0f7ad98b4f857da11457a862e10f4218bd',
  'src/lib/html-in-canvas.ts': '8fd3adf59ba3b54a32c8552f614321e123047e107f94e6272c64658e71501e9a',
}
for (const [relative, expected] of Object.entries(pinned)) {
  const bytes = await readFile(resolve(sourceRoot, relative))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`Pinned Canvas UI source integrity check failed: ${relative}`)
}
const markdown = process.env.EXPERIENCE_MARKDOWN_REPORT ? await readFile(process.env.EXPERIENCE_MARKDOWN_REPORT, 'utf8') : null
const license = await readFile(resolve(sourceRoot, 'LICENSE.md'), 'utf8')
const projectPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const installedThree = JSON.parse(await readFile(resolve(root, 'node_modules/three/package.json'), 'utf8'))
if (projectPackage.dependencies?.three !== '0.185.1' || installedThree.version !== '0.185.1') throw new Error('The pinned project Three.js dependency is unavailable.')
await mkdir(outputRoot, { recursive: true, mode: 0o700 })
await chmod(outputRoot, 0o700)
const effects = [
  ['asciify', 'src/lib/Asciify/AsciifyVanilla.ts'],
  ['ascii-object', 'src/lib/AsciiObject/AsciiObjectVanilla.ts'],
  ['ink-object', 'src/lib/InkObject/InkObjectVanilla.ts'],
]
for (const [slug, entry] of effects) {
  await build({ entryPoints: [resolve(sourceRoot, entry)], nodePaths: [resolve(root, 'node_modules')], bundle: true, format: 'esm', platform: 'browser', outfile: resolve(outputRoot, `${slug}.mjs`), sourcemap: false, banner: { js: `/*\n${license.replaceAll('*/', '* /')}\n*/` } })
}
await build({
  absWorkingDir: root, entryPoints: ['tools/browser-ascii-gpu/fixture.ts'], bundle: true, format: 'esm', platform: 'browser', outfile: resolve(outputRoot, 'fixture.js'), sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"', __IEXP_ELK_WORKER_SOURCE__: JSON.stringify(await readFile(resolve(root, 'node_modules/elkjs/lib/elk-worker.min.js'), 'utf8')), LOCAL_REPORT: JSON.stringify(markdown) },
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  plugins: [openuiCssPlugin, { name: 'fixture-remote', setup(build) { build.onResolve({ filter: /^\.\/remote\.js$/ }, () => ({ path: resolve(root, 'tools/browser-experience/remote-stub.ts') })) } }],
})
await Promise.all([...effects.map(([slug]) => `${slug}.mjs`), 'fixture.js'].map(name => chmod(resolve(outputRoot, name), 0o600)))
console.log(`Built private fixture at ${outputRoot}; fixed Canvas UI sources and Three.js ${installedThree.version} verified; optional report ${markdown === null ? 'not included' : 'included'}.`)
