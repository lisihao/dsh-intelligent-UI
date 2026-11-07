#!/usr/bin/env node
/** Thin CLI entrypoint for the committed synthetic browser-proof templates. */
import { resolve } from 'node:path'
import { buildOpaqueParent } from './build-browser-proof.mjs'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const repo = option('--repo') && resolve(option('--repo'))
const output = option('--out') && resolve(option('--out'))
const sourceManifestPath = option('--manifest') && resolve(option('--manifest'))
const typeManifestPath = option('--type-manifest') && resolve(option('--type-manifest'))
const frameOrigin = option('--frame-origin')
const runtimeEndpoint = option('--runtime-endpoint')
const scenario = option('--scenario') ?? 'data-table'
const optionNames = new Set(['--repo', '--out', '--manifest', '--type-manifest', '--frame-origin', '--runtime-endpoint', '--scenario'])

export const generateReact18OpaqueParent = buildOpaqueParent

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!repo || !output || !sourceManifestPath || !typeManifestPath || Boolean(frameOrigin) === Boolean(runtimeEndpoint) || args.filter(value => value.startsWith('--')).some(value => !optionNames.has(value))) throw new Error('TUFFUI_REACT18_HARNESS_ARGUMENTS')
  process.stdout.write(`${JSON.stringify(await buildOpaqueParent({ repo, output, sourceManifestPath, typeManifestPath, frameOrigin, runtimeEndpoint, scenario }))}\n`)
}
