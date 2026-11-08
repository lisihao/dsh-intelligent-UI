import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export const DIL_REFERENCE_COMMIT = 'c4920ad2327ee5dfdfb42744e4696286868d934e'
const pinnedSources = {
  "src/dil/index.ts": "da4d7a081e2396a633a8d580fe8d3a3bdc1db86ef794749f1d9b47e46210266e",
  "src/dil/compiler/index.ts": "eac505f8bf80eb8f19fe69e1cbd1d7a53055263cdf346aee78a6fe009cf93472",
  "src/client/dil/protocol.ts": "1ac8d2613a529d389b58accdc33b056b4dde4135a2d9a28d8d00cdb78969f8a5",
  "src/client/dil/frame.ts": "67f0d015eb7aecdeb8159f4c39db5e08f39eac4a32e3ae43bf26e31880040999",
  "src/client/dil/sandbox.ts": "96084ba7183bc4df0cc7887f46935d0c63c59ee4f743b40ddbf0a7fd41f87c3a",
  "src/client/dil/generated/frame-script.ts": "c6d5bead8eab6af8848ff6ae39c4a913bc58834ed3934b5fb812fa9f17bc5735",
  "src/client/dil/generated/worker-source.ts": "6940ce51cd72a7693938ca8ca4fba370e6eb452b0f26200145ddcd8a013d9dbf"
}

export function dilReferenceAliases() {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('@solar-ui/dil-reference/package.json'))
  for (const [name, expected] of Object.entries(pinnedSources)) {
    const actual = createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex')
    if (actual !== expected) throw new Error(`DIL_REFERENCE_SOURCE_MISMATCH: ${name}`)
  }
  return {
    '@solar-ui/dil-reference/compiler': resolve(root, 'src/dil/index.ts'),
    '@solar-ui/dil-reference/sandbox': resolve(root, 'src/client/dil/sandbox.ts'),
    '@solar-ui/dil-reference/frame': resolve(root, 'src/client/dil/frame.ts'),
  }
}

/** Internal paths are pinned build inputs; the reference plugin entry is never loaded. */
export function dilReferencePlugin({ compiler = false } = {}) {
  const aliases = dilReferenceAliases()
  return {
    name: 'solar-pinned-dil-reference',
    setup(build) {
      build.onResolve({ filter: /^@solar-ui\/dil-reference(?:$|\/)/ }, args => {
        if (args.path === '@solar-ui/dil-reference/compiler' && !compiler) return { errors: [{ text: 'DIL_HOST_COMPILER_IN_BROWSER: compiler uses node:vm and must remain on Host' }] }
        const path = aliases[args.path]
        return path ? { path } : { errors: [{ text: `DIL_REFERENCE_IMPORT_UNSUPPORTED: ${args.path}` }] }
      })
    },
  }
}
