import { describe, expect, it } from 'vitest'

import { liveSeriesInputSchema as sourceLiveSeriesInputSchema } from '../src/adaptive-ui/source-contracts.js'
import {
  historicalLibraryInputSchema,
  historicalPlanInputSchema,
  skulletLibraryInputSchema,
  torphLibraryInputSchema,
} from '../src/dil/library-inputs.js'
import { getDilLibraryComponentInputSchema } from '../src/dil/library-contracts.js'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  expect(value).toBeTypeOf('object')
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  return value as JsonRecord
}

describe('DIL library input contracts', () => {
  it('is importable under the Node test environment without a browser graph', () => {
    expect(typeof globalThis.document).toBe('undefined')
    expect(getDilLibraryComponentInputSchema('component:skullet')).toMatchObject({ library: 'skullet' })
  })

  it('uses the authoritative source-contracts live-series schema directly', () => {
    // The catalog and renderer must not acquire a second, drifting live-series schema.
    expect(sourceLiveSeriesInputSchema.parse).toBeTypeOf('function')
    expect(() => sourceLiveSeriesInputSchema.parse({
      type: 'live-series', source: 'observed feed', unit: 'ms', timeUnit: 'seconds',
      points: [{ time: 2, value: 20 }, { time: 1, value: 10 }],
    })).toThrow()
  })

  it('exposes complete live-series properties, required fields, bounds, and cross-field constraints', () => {
    const live = record(getDilLibraryComponentInputSchema('component:liveline'))
    const properties = record(live.properties)
    const points = record(properties.points)
    const point = record(points.items)
    const pointProperties = record(point.properties)
    expect(live.type).toBe('object')
    expect(live.required).toEqual(expect.arrayContaining(['type', 'source', 'unit', 'timeUnit', 'points']))
    expect(live.additionalProperties).toBe(false)
    expect(points.minItems).toBe(1)
    expect(point.required).toEqual(expect.arrayContaining(['time', 'value']))
    expect(point.additionalProperties).toBe(false)
    expect(record(pointProperties.time).type).toBe('number')
    expect(record(pointProperties.value).type).toBe('number')
    expect(live.constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('strictly increasing time'),
      expect.stringContaining('must not predate'),
    ]))
  })

  it('exposes complete Visx plan structure while documenting cross-field provenance rules', () => {
    const historical = record(getDilLibraryComponentInputSchema('component:visx-historical'))
    const outerProperties = record(historical.properties)
    const plan = record(outerProperties.plan)
    const planProperties = record(plan.properties)
    const series = record(planProperties.series)
    const seriesItem = record(series.items)
    const seriesProperties = record(seriesItem.properties)
    expect(historical.type).toBe('object')
    expect(historical.required).toEqual(['plan'])
    expect(plan.required).toEqual(expect.arrayContaining(['kind', 'labels', 'series', 'reason', 'icon']))
    expect(record(planProperties.labels)).toMatchObject({ type: 'array', minItems: 1, maxItems: 2_000 })
    expect(series).toMatchObject({ type: 'array', minItems: 1, maxItems: 8 })
    expect(seriesItem.required).toEqual(expect.arrayContaining(['name', 'values', 'unit']))
    expect(record(seriesProperties.unit)).toMatchObject({ type: 'string', maxLength: 100 })
    expect(record(seriesProperties.values)).toMatchObject({ type: 'array', minItems: 1, maxItems: 2_000 })
    expect(historical.constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('same length as plan.labels'),
      expect.stringContaining('half-open [start,end)'),
    ]))
  })

  it('shares the strict Skullet, Torph, and Visx validators consumed by the view', () => {
    expect(() => skulletLibraryInputSchema.parse({ loading: false })).toThrow()
    expect(() => torphLibraryInputSchema.parse({ text: '```ts\nconst x = 1\n```' })).toThrow()
    const invalidPlan = {
      kind: 'line', labels: ['Jan'],
      series: [{ name: 'actual', values: [1, 2], unit: 'ms' }],
      reason: 'actual source', icon: 'trending-up',
    }
    expect(() => historicalPlanInputSchema.parse(invalidPlan)).toThrow()
    expect(() => historicalLibraryInputSchema.parse({ plan: invalidPlan })).toThrow()
  })
})
