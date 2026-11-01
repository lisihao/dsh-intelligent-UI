import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile, copyFile, readFile, cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { openuiCssPlugin } from './build-css.mjs'
const root = fileURLToPath(new URL('.', import.meta.url))
await rm(join(root, 'lib'), { recursive: true, force: true })
await mkdir(join(root, 'lib'), { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['src/index.ts', 'src/contracts.ts', 'src/typert.ts'], outdir: 'lib', bundle: true, packages: 'external', platform: 'node', target: 'node22', format: 'esm', sourcemap: true })
await build({ absWorkingDir: root, entryPoints: ['src/client.ts'], outfile: 'lib/client.cjs', bundle: true, platform: 'browser', target: 'es2022', format: 'cjs', external: ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'react-dom/*'], define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'text', '.woff2': 'dataurl' }, plugins: [openuiCssPlugin],
  banner: { js: 'window.__ModuleLoader__.load({ id: "@lisihao/dsh-solar-intelligent-experience-platform", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' }, sourcemap: true,
})
await writeFile(join(root, 'tsconfig.build.json'), JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: './src', outDir: './lib/types' }, include: ['src/**/*.ts'], exclude: ['tests', 'node_modules', 'lib'] }, null, 2) + '\n')
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' })
await copyFile(join(root, 'assets/Recursive-OFL.txt'), join(root, 'lib/Recursive-OFL.txt'))
await copyFile(join(root, 'assets/DM-Sans-OFL.txt'), join(root, 'lib/DM-Sans-OFL.txt'))
await copyFile(join(root, 'assets/Uiverse-MIT.txt'), join(root, 'lib/Uiverse-MIT.txt'))
await mkdir(join(root, 'lib/themes'), { recursive: true })
await copyFile(join(root, 'src/themes/linen-example.dsh-theme.json'), join(root, 'lib/themes/linen.dsh-theme.json'))
await mkdir(join(root, 'lib/uiverse/assets'), { recursive: true })
for (const name of ['catalog.json', 'LICENSE']) await copyFile(join(root, 'resources/uiverse', name), join(root, 'lib/uiverse/assets', name))
for (const name of ['sources.json', 'tailwind.css']) await writeFile(join(root, 'lib/uiverse/assets', name), gunzipSync(await readFile(join(root, 'resources/uiverse', name + '.gz'))))
await cp(join(root, 'skills/uiverse-components'), join(root, 'lib/uiverse/assets/uiverse-components'), { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['src/uiverse/cli.ts'], outfile: 'lib/uiverse/cli.mjs', bundle: true, platform: 'node', target: 'node22', format: 'esm' })
await build({ absWorkingDir: root, entryPoints: ['src/uiverse/catalog.ts'], outfile: 'lib/uiverse/catalog.js', bundle: true, platform: 'node', target: 'node22', format: 'esm' })
console.log('Built intelligent UI with integrated silent Uiverse tools and source-backed rendering.')
