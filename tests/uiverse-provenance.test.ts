import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import adapters from '../src/uiverse-sources.json' with { type: 'json' }

test('live component adapters and development lookup share the exact pinned archive', async () => {
  const catalog = JSON.parse(await readFile(new URL('../resources/uiverse/catalog.json', import.meta.url), 'utf8'))
  const sources = JSON.parse(gunzipSync(await readFile(new URL('../resources/uiverse/sources.json.gz', import.meta.url))).toString('utf8')).sources
  expect(catalog.commit).toBe(adapters.commit)
  expect(catalog.total).toBe(3802)
  for (const set of Object.values(adapters.sets)) for (const adapter of set) {
    const id = adapter.file.replace(/\.html$/, '')
    const record = catalog.items.find((item: { id: string }) => item.id === id)
    expect(record?.sha256).toBe(adapter.sha256)
    expect(sources[id]).toBe(adapter.html)
    expect(createHash('sha256').update(adapter.html).digest('hex')).toBe(adapter.sha256)
  }
})
