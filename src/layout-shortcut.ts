import { z } from 'zod'

/** Persisted physical-key binding for the experimental block-layout switch. */
export const DEFAULT_BLOCK_LAYOUT_SHORTCUT = 'Alt+Meta+KeyI'
export const DISABLED_BLOCK_LAYOUT_SHORTCUT = ''

const modifierOrder = ['Control', 'Alt', 'Shift', 'Meta'] as const
type Modifier = typeof modifierOrder[number]

export type BlockLayoutShortcut = Readonly<{
  code: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
}>

function shortcutError(reason: string): Error {
  return new Error('BLOCK_LAYOUT_SHORTCUT_INVALID: ' + reason)
}

function normalizeModifier(value: string): Modifier | undefined {
  switch (value.toLowerCase()) {
    case 'control':
    case 'ctrl':
      return 'Control'
    case 'alt':
    case 'opt':
    case 'option':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'meta':
    case 'command':
    case 'cmd':
      return 'Meta'
    default:
      return undefined
  }
}

function normalizeCode(value: string): string | undefined {
  const letter = /^([a-z])$/i.exec(value)
  if (letter) return 'Key' + letter[1]!.toUpperCase()
  const key = /^key([a-z])$/i.exec(value)
  if (key) return 'Key' + key[1]!.toUpperCase()
  if (/^[0-9]$/.test(value)) return 'Digit' + value
  const digit = /^digit([0-9])$/i.exec(value)
  if (digit) return 'Digit' + digit[1]
  const functionKey = /^f([1-9]|1[0-2])$/i.exec(value)
  if (functionKey) return 'F' + functionKey[1]
  return undefined
}

/**
 * Reads the persisted form rather than event.key. The supported physical keys
 * intentionally exclude printable/unmodified keys and system/navigation keys.
 */
export function parseBlockLayoutShortcut(value: string): BlockLayoutShortcut | undefined {
  if (typeof value !== 'string') throw shortcutError('expected a string')
  const source = value.trim()
  if (source === DISABLED_BLOCK_LAYOUT_SHORTCUT) return undefined
  const parts = source.split('+').map(part => part.trim())
  if (parts.length < 2 || parts.some(part => !part)) throw shortcutError('use modifiers plus a physical key')
  const modifiers = new Set<Modifier>()
  let code: string | undefined
  for (const part of parts) {
    const modifier = normalizeModifier(part)
    if (modifier) {
      if (modifiers.has(modifier)) throw shortcutError('duplicate modifier ' + modifier)
      modifiers.add(modifier)
      continue
    }
    const nextCode = normalizeCode(part)
    if (!nextCode || code !== undefined) throw shortcutError('unsupported physical key')
    code = nextCode
  }
  if (!code) throw shortcutError('a physical key is required')
  if (!modifiers.has('Alt') && !modifiers.has('Control') && !modifiers.has('Meta')) {
    throw shortcutError('include Alt, Control, or Meta to avoid unmodified bindings')
  }
  return {
    code,
    altKey: modifiers.has('Alt'),
    ctrlKey: modifiers.has('Control'),
    shiftKey: modifiers.has('Shift'),
    metaKey: modifiers.has('Meta'),
  }
}

/** Converts supported aliases/order into the one durable, deterministic form. */
export function normalizeBlockLayoutShortcut(value: string): string {
  const parsed = parseBlockLayoutShortcut(value)
  if (!parsed) return DISABLED_BLOCK_LAYOUT_SHORTCUT
  const modifiers = modifierOrder.filter(modifier =>
    modifier === 'Control' ? parsed.ctrlKey :
      modifier === 'Alt' ? parsed.altKey :
        modifier === 'Shift' ? parsed.shiftKey :
          parsed.metaKey,
  )
  return [...modifiers, parsed.code].join('+')
}

export const blockLayoutShortcutSchema = z.string().max(64).superRefine((value, context) => {
  try {
    parseBlockLayoutShortcut(value)
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'BLOCK_LAYOUT_SHORTCUT_INVALID' })
  }
}).transform(value => normalizeBlockLayoutShortcut(value))

/** Missing legacy configuration keeps the documented default without a rewrite. */
export function resolveBlockLayoutShortcut(value: string | undefined): string {
  return value === undefined ? DEFAULT_BLOCK_LAYOUT_SHORTCUT : normalizeBlockLayoutShortcut(value)
}

/** Missing legacy configuration keeps the experimental compiler disabled. */
export function blockLayoutEnabled(value: boolean | undefined): boolean {
  return value === true
}

/** Human-readable macOS-style label while persistence always uses event.code. */
export function blockLayoutShortcutLabel(value: string | undefined): string {
  const parsed = parseBlockLayoutShortcut(resolveBlockLayoutShortcut(value))
  if (!parsed) return '已关闭'
  const modifiers = [
    parsed.ctrlKey ? '⌃' : '',
    parsed.altKey ? '⌥' : '',
    parsed.shiftKey ? '⇧' : '',
    parsed.metaKey ? '⌘' : '',
  ].join('')
  const key = parsed.code.startsWith('Key') ? parsed.code.slice(3) :
    parsed.code.startsWith('Digit') ? parsed.code.slice(5) :
      parsed.code
  return modifiers + key
}

type ShortcutKeyboardEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'defaultPrevented' | 'isComposing' | 'keyCode' | 'repeat'>

/** Returns a canonical safe binding from a real physical-key event, if any. */
export function blockLayoutShortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | undefined {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return undefined
  const parts = [
    event.ctrlKey ? 'Control' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
    event.code,
  ].filter(Boolean)
  try {
    return normalizeBlockLayoutShortcut(parts.join('+'))
  } catch {
    return undefined
  }
}

/** Exact modifier matching prevents a configured binding from shadowing others. */
export function matchesBlockLayoutShortcut(event: ShortcutKeyboardEvent, shortcut: string | undefined): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return false
  const parsed = parseBlockLayoutShortcut(resolveBlockLayoutShortcut(shortcut))
  return !!parsed &&
    event.code === parsed.code &&
    event.altKey === parsed.altKey &&
    event.ctrlKey === parsed.ctrlKey &&
    event.shiftKey === parsed.shiftKey &&
    event.metaKey === parsed.metaKey
}

/** The capture editor owns its own key event; ordinary chat inputs remain eligible. */
export function isBlockLayoutShortcutCaptureTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => Element | null } | null
  return typeof candidate?.closest === 'function' &&
    candidate.closest('[data-iexp-layout-shortcut-capture="true"]') !== null
}
