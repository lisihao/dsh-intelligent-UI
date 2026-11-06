import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

process.umask(0o077)
const root = fileURLToPath(new URL('../../', import.meta.url))
const sourceRoot = resolve(process.env.CANVAS_EXTENDED_SOURCE_ROOT ?? '/private/tmp/dsh-canvas-ui-reference-20261106')
const output = resolve(process.env.CANVAS_EXTENDED_FIXTURE_DIR ?? '/private/tmp/iexp-canvas-extended-20261106')
if (!output.startsWith('/private/tmp/iexp-canvas-extended-')) throw new Error('CANVAS_EXTENDED_FIXTURE_OUTPUT')
const entries = {
  'ascii-sweep': ['src/lib/AsciiSweep/AsciiSweepVanilla.ts', '689762d1b370a88614d1c75dea2f02a3a45777c7f46ac524992bca40aac7cadc'],
  bubble: ['src/lib/Bubble/BubbleVanilla.ts', '13599050bc3c45e96901ab3f8a91bc10a50ddadae17725a8ffa170f5a477a588'],
  cloth: ['src/lib/Cloth/ClothVanilla.ts', '931f283b5861fdd362372a29ef0ffe38b84034400f58fd03988868bd31f371c1'],
  droplets: ['src/lib/Droplets/DropletsVanilla.ts', 'a480a1c02bc56adab8fcc7b9a4207d66f247a4aba0ad56bbc0c8a4957360effa'],
  'flame-wrap': ['src/lib/FlameWrap/FlameWrapVanilla.ts', '84930e4f1335fb6d66cad1d59dab4720e71ec3e5a10b03a8d6f13fc272bef29a'],
  'force-field': ['src/lib/ForceField/ForceFieldVanilla.ts', '5953633f26c6abeff238009cfe483d7750c2a3661f62c8df930303378eb5949d'],
  glass: ['src/lib/Glass/GlassVanilla.ts', '3642cf1fcf87e6b4857ebbba50520fe2597b3e88d07507955085dc1b0f0c8138'],
  'glyph-rain': ['src/lib/GlyphRain/GlyphRainVanilla.ts', '0299b3de6b909a00bb093f2fa6dbe8dd22aacced739409e971f264d8d2e2b267'],
  laser: ['src/lib/Laser/LaserVanilla.ts', '9b92524804a8fb2c722d97622d4656d677dccdd2cd202779c9fb38ff8da86a44'],
  liquid: ['src/lib/Liquid/LiquidVanilla.ts', 'd35368f1bc5b262b5c2692168c05e8d43a10dc3df0665142b14909786089fd37'],
  peel: ['src/lib/Peel/PeelVanilla.ts', 'be9ff8060b5ff19a71688624e51cbdb94aee1d1cffa7d9def6561051a266acb5'],
  'retro-dither': ['src/lib/RetroDither/RetroDitherVanilla.ts', 'ca237acc023dda658213155714adc2e54a290fed359021e6ae0ce4d9818d9a51'],
  ripple: ['src/lib/Ripple/RippleVanilla.ts', '60ef5fdc2aa284c717009feaf4e3031ca5f4df24c9717908c785d0bc0d8c92ea'],
  'dithered-object': ['src/lib/DitheredObject/DitheredObjectVanilla.ts', '66e187592334cd7bdaa56e2d0b95505cdda1bd479008adcdbb43f33ee040a53e'],
  'particle-object': ['src/lib/ParticleObject/ParticleObjectVanilla.ts', 'df43e3d58ab84ffda85b1d71b13f14836696d0d0ef04d3a225c8335af887b9c3'],
  'liquid-object': ['src/lib/LiquidObject/LiquidObjectVanilla.ts', '7feb9476c20ba52fe6e2aa5cd0fa6b1d743ae114f3164d7b7d3774b1f621d466'],
}

await mkdir(resolve(output, 'effects'), { recursive: true, mode: 0o700 })
for (const [slug, [entry, expected]] of Object.entries(entries)) {
  const source = await readFile(resolve(sourceRoot, entry))
  const actual = createHash('sha256').update(source).digest('hex')
  if (actual !== expected) throw new Error(`CANVAS_EXTENDED_SOURCE_INTEGRITY:${slug}`)
  await build({ entryPoints: [resolve(sourceRoot, entry)], nodePaths: [resolve(root, 'node_modules')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: resolve(output, 'effects', `${slug}.mjs`), logLevel: 'silent' })
}
await build({ absWorkingDir: root, entryPoints: ['tools/browser-canvas-extended/fixture.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: resolve(output, 'fixture.js'), logLevel: 'silent' })
await build({ absWorkingDir: root, entryPoints: ['tools/browser-canvas-extended/component-view-fixture.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: resolve(output, 'component-view.js'), logLevel: 'silent' })
await build({ absWorkingDir: root, entryPoints: ['tools/browser-canvas-extended/texture-debug.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: resolve(output, 'texture-debug.js'), logLevel: 'silent' })
await build({ absWorkingDir: root, entryPoints: ['src/canvas-extended-isolated-frame.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: resolve(output, 'liquid-frame.mjs'), logLevel: 'silent' })
for (const file of ['fixture.js', 'component-view.js', 'texture-debug.js', 'liquid-frame.mjs', ...Object.keys(entries).map(slug => `effects/${slug}.mjs`)]) await chmod(resolve(output, file), 0o600)
process.stdout.write(`Canvas extended fixture built at ${output}; ${String(Object.keys(entries).length)} fixed source modules verified.\n`)
