// Fixed Rune realm. It accepts only bounded rectangle/state JSON over its
// nonce-bound MessagePort and imports only the manifest-listed local loader.
import init, * as runeTheme from './rune_theme.js'

const PROTOCOL_VERSION = 1
const MAX_SURFACES = 64
const MAX_EXTENT = 32768
const MAX_ORIGIN = 65536
const roles = new Set(['reading', 'card', 'button', 'input', 'toggle', 'chart'])
const states = new Set(['idle', 'hover', 'focus', 'pressed', 'disabled'])
const materials = new Set(['native', 'liquid-metal', 'fluted-glass'])
const canvas = document.querySelector('#rune-canvas')
let port
let nonce
let highestRevision = 0
let wasmReady
let mounted = false

function errorCode(error, fallback) {
  const value = error instanceof Error ? error.message : String(error)
  return /^[A-Z][A-Z0-9_]{2,119}$/u.test(value) ? value : fallback
}

function record(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code)
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new Error(code)
  return value
}

function exactKeys(value, keys, code) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code)
}

function finiteExtent(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_EXTENT) throw new Error(code)
}

function finiteOrigin(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_ORIGIN) throw new Error(code)
}

function payload(value) {
  const input = record(value, 'RUNE_FRAME_PAYLOAD_INVALID')
  exactKeys(input, ['version', 'width', 'height', 'reducedMotion', 'surfaces'], 'RUNE_FRAME_PAYLOAD_EXTRA_FIELD')
  if (input.version !== 1) throw new Error('RUNE_THEME_CONTRACT_VERSION_UNSUPPORTED')
  finiteExtent(input.width, 'RUNE_THEME_WIDTH_INVALID')
  finiteExtent(input.height, 'RUNE_THEME_HEIGHT_INVALID')
  if (typeof input.reducedMotion !== 'boolean' || !Array.isArray(input.surfaces) || input.surfaces.length > MAX_SURFACES) {
    throw new Error('RUNE_THEME_SURFACE_LIMIT_EXCEEDED')
  }
  const ids = new Set()
  for (const value of input.surfaces) {
    const surface = record(value, 'RUNE_THEME_SURFACE_INVALID')
    exactKeys(surface, ['id', 'role', 'x', 'y', 'width', 'height', 'state', 'material'], 'RUNE_THEME_SURFACE_EXTRA_FIELD')
    if (typeof surface.id !== 'string' || !surface.id || surface.id.length > 160 || /[\u0000-\u001f\u007f]/u.test(surface.id) || ids.has(surface.id)) {
      throw new Error(ids.has(surface.id) ? 'RUNE_THEME_SURFACE_ID_DUPLICATE' : 'RUNE_THEME_SURFACE_ID_INVALID')
    }
    ids.add(surface.id)
    if (!roles.has(surface.role) || !states.has(surface.state) || !materials.has(surface.material)) throw new Error('RUNE_THEME_SURFACE_INVALID')
    finiteOrigin(surface.x, 'RUNE_THEME_SURFACE_X_INVALID')
    finiteOrigin(surface.y, 'RUNE_THEME_SURFACE_Y_INVALID')
    finiteExtent(surface.width, 'RUNE_THEME_SURFACE_WIDTH_INVALID')
    finiteExtent(surface.height, 'RUNE_THEME_SURFACE_HEIGHT_INVALID')
  }
  return input
}

function post(type, revision, extra = {}) {
  port?.postMessage(Object.freeze({ type, protocolVersion: PROTOCOL_VERSION, nonce, revision, ...extra }))
}

function showError(code) {
  const prior = document.querySelector('#rune-error')
  if (prior) prior.textContent = code
  else {
    const node = document.createElement('pre')
    node.id = 'rune-error'
    node.textContent = code
    document.body.append(node)
  }
}

async function waitForMounted(revision) {
  for (let frame = 0; frame < 300; frame += 1) {
    const runtimeError = runeTheme.runtime_capability_error?.()
    if (typeof runtimeError === 'string' && runtimeError) throw new Error(runtimeError)
    if (runeTheme.mounted()) {
      // The first visual frame reports a missing COPY_SRC capability from the
      // real Rust compositor. Wait one browser frame before declaring success.
      await new Promise(resolve => requestAnimationFrame(resolve))
      const afterPaint = runeTheme.runtime_capability_error?.()
      if (typeof afterPaint === 'string' && afterPaint) throw new Error(afterPaint)
      return
    }
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
  throw new Error('RUNE_MOUNT_TIMEOUT')
}

async function apply(message) {
  const raw = record(message, 'RUNE_FRAME_MESSAGE_INVALID')
  exactKeys(raw, ['type', 'protocolVersion', 'nonce', 'revision', ...(raw.type === 'rune/dispose' ? [] : ['payload'])], 'RUNE_FRAME_MESSAGE_EXTRA_FIELD')
  if (raw.protocolVersion !== PROTOCOL_VERSION || raw.nonce !== nonce || !Number.isSafeInteger(raw.revision) || raw.revision < 1) return
  if (!['rune/mount', 'rune/update', 'rune/dispose'].includes(raw.type) || raw.revision <= highestRevision) return
  highestRevision = raw.revision
  try {
    if (raw.type === 'rune/dispose') {
      runeTheme.dispose()
      mounted = false
      post('rune/disposed', raw.revision)
      return
    }
    const next = payload(raw.payload)
    wasmReady ??= init()
    await wasmReady
    if (!runeTheme.opaque_owned_region_supported() || runeTheme.transparent_overlay_supported() || !runeTheme.fluted_glass_supported()) {
      throw new Error('RUNE_CAPABILITY_MISMATCH')
    }
    if (raw.type === 'rune/mount') {
      runeTheme.mount('rune-canvas', next)
      await waitForMounted(raw.revision)
      mounted = true
      post('rune/mounted', raw.revision)
    } else {
      if (!mounted) throw new Error('RUNE_UPDATE_BEFORE_MOUNT')
      runeTheme.update(next)
      await new Promise(resolve => requestAnimationFrame(resolve))
      const runtimeError = runeTheme.runtime_capability_error?.()
      if (typeof runtimeError === 'string' && runtimeError) throw new Error(runtimeError)
      post('rune/updated', raw.revision)
    }
  } catch (error) {
    const code = errorCode(error, 'RUNE_FRAME_RUNTIME_ERROR')
    showError(code)
    post('rune/error', raw.revision, { code })
  }
}

window.addEventListener('message', event => {
  const raw = event.data
  if (event.source !== window.parent || event.ports.length !== 1 || !raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const message = raw
  if (message.type !== 'rune/connect' || message.protocolVersion !== PROTOCOL_VERSION || typeof message.nonce !== 'string' || !/^[a-f0-9]{32}$/u.test(message.nonce)
    || typeof message.parentOrigin !== 'string' || !/^https?:\/\/[^/]+$/u.test(message.parentOrigin) || event.origin !== message.parentOrigin || port) return
  nonce = message.nonce
  port = event.ports[0]
  port.onmessage = event => { void apply(event.data) }
  port.start?.()
  post('rune/ready', 0)
})
