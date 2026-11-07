import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { ExecutableComponentRegistry } from '../src/adaptive-ui/executable-registry.js'
import { createTuffUiCatalog } from '../src/tuffui/catalog.js'
import { registerTuffUiComponents } from '../src/tuffui/executable-components.js'
import { validateTuffUiTypeSchemaManifest } from '../src/tuffui/type-schema.js'

const sourcePath = new URL('../resources/components/tuffui/source-manifest.json', import.meta.url)
const typesPath = new URL('../resources/components/tuffui/type-schema.json', import.meta.url)
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

describe('TuffUI production artifact ChartCard mapping', () => {
  test('uses the copied fixed source/type artifacts for an analyzer-backed chart binding', async () => {
    const [sourceBytes, typesBytes] = await Promise.all([readFile(sourcePath), readFile(typesPath)])
    const catalog = createTuffUiCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes)))
    const types = validateTuffUiTypeSchemaManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(typesBytes)))
    expect(types.sourceManifestSha256).toBe(sha256(sourceBytes))
    const registry = new ExecutableComponentRegistry()
    registerTuffUiComponents(registry, catalog, { typeSchemas: types })
    const source = `| Period | Revenue (USD) | Cost (USD) |
| --- | ---: | ---: |
| 2025-01 | 12 | 7 |
| 2025-02 | 16 | 9 |
| 2025-03 | 18 | 10 |`
    const dispatch = registry.dispatch('tuffui:chart-card', { source: { id: 'production-chart', value: source }, capabilities: { webgl: false, reducedMotion: true } })
    expect(dispatch).toMatchObject({
      id: 'tuffui:chart-card', rendererKey: 'tuffui-v1', actionIds: [],
      input: {
        componentId: 'chart-card',
        binding: {
          exportName: 'ChartCard',
          props: {
            type: 'line',
            data: {
              labels: ['2025-01', '2025-02', '2025-03'],
              series: [{ label: 'Revenue (USD)', values: [12, 16, 18] }, { label: 'Cost (USD)', values: [7, 9, 10] }],
            },
          },
        },
      },
    })
  })
})
