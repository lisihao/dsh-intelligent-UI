import type { UiverseRuntimeTarget } from './runtime-registry.js'

/** Named pure reasons are safe to expose at the source-binding boundary. */
export type UiverseRuntimeFieldValueIssue =
  | 'constraint-missing'
  | 'constraint-invalid'
  | 'select-option-unknown'
  | 'numeric-invalid'
  | 'below-min'
  | 'above-max'
  | 'step-mismatch'
  | 'date-invalid'
  | 'color-invalid'

function finiteDecimal(value: string): number | undefined {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/u.test(value)) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

type DateParts = Readonly<{ year: number, month: number, day: number }>

function dateParts(value: string): DateParts | undefined {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return undefined
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  if (!Number.isSafeInteger(year) || year < 1 || month < 1 || month > 12 || day < 1) return undefined
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  return day <= maximum ? { year, month, day } : undefined
}

function validDate(value: string): boolean { return dateParts(value) !== undefined }

function compareDate(left: string, right: string): number {
  const a = dateParts(left), b = dateParts(right)
  if (!a || !b) return 0
  return a.year - b.year || a.month - b.month || a.day - b.day
}

function withinStep(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step
  return Math.abs(quotient - Math.round(quotient)) <= 1e-9 * Math.max(1, Math.abs(quotient))
}

/**
 * Validates only deterministic, browser-independent constraints. The renderer
 * performs a second reflected-value check on the detached real DOM before the
 * fixed source can enter a ShadowRoot. It intentionally does not run browser
 * form validity such as e-mail syntax, because a visible draft is legitimate.
 */
export function validateUiverseRuntimeFieldValue(target: UiverseRuntimeTarget, value: string): UiverseRuntimeFieldValueIssue | undefined {
  if (target.kind !== 'value') return undefined
  const constraint = target.fieldConstraint
  if (!constraint) return 'constraint-missing'
  if (constraint.element === 'select') return constraint.options?.includes(value) ? undefined : 'select-option-unknown'
  if (constraint.element === 'textarea') return undefined
  if (constraint.element !== 'input') return 'constraint-invalid'

  const inputType = constraint.inputType ?? 'text'
  if (inputType === 'date') {
    if (value === '') return undefined
    if (!validDate(value)) return 'date-invalid'
    if (constraint.min && validDate(constraint.min) && compareDate(value, constraint.min) < 0) return 'below-min'
    if (constraint.max && validDate(constraint.max) && compareDate(value, constraint.max) > 0) return 'above-max'
    return undefined
  }
  if (inputType === 'color') return /^#[0-9a-f]{6}$/iu.test(value) ? undefined : 'color-invalid'
  if (inputType !== 'number' && inputType !== 'range') return undefined
  if (inputType === 'number' && value === '') return undefined

  const numeric = finiteDecimal(value)
  if (numeric === undefined) return 'numeric-invalid'
  const min = constraint.min === undefined ? undefined : finiteDecimal(constraint.min)
  const max = constraint.max === undefined ? undefined : finiteDecimal(constraint.max)
  if (min !== undefined && numeric < min) return 'below-min'
  if (max !== undefined && numeric > max) return 'above-max'
  if (constraint.step !== undefined && constraint.step.toLowerCase() !== 'any') {
    const step = finiteDecimal(constraint.step)
    if (step === undefined || step <= 0) return 'constraint-invalid'
    if (!withinStep(numeric, min ?? 0, step)) return 'step-mismatch'
  }
  return undefined
}

/** Allows only documented native number/color normalizations after assignment. */
export function reflectsUiverseRuntimeFieldValue(target: UiverseRuntimeTarget, actual: string, expected: string): boolean {
  if (actual === expected) return true
  const constraint = target.fieldConstraint
  if (constraint?.element !== 'input') return false
  if (constraint.inputType === 'number' || constraint.inputType === 'range') {
    const left = finiteDecimal(actual), right = finiteDecimal(expected)
    return left !== undefined && right !== undefined && left === right
  }
  if (constraint.inputType === 'color') return actual.toLowerCase() === expected.toLowerCase()
  return false
}

/**
 * Test/fixture-only source of legal synthetic values. Production selection
 * must always receive Host data and never falls back to this helper or an
 * author source default.
 */
export function uiverseRuntimeFixtureFieldValue(target: UiverseRuntimeTarget): string | undefined {
  if (target.kind !== 'value') return undefined
  const constraint = target.fieldConstraint
  if (!constraint) return undefined
  if (constraint.element === 'select') return constraint.options?.at(-1)
  if (constraint.element === 'textarea') return '__uiverse_fixture_textarea__'
  if (constraint.element !== 'input') return undefined

  const type = constraint.inputType ?? 'text'
  if (type === 'date') {
    if (constraint.min && validDate(constraint.min) && (!constraint.max || !validDate(constraint.max) || compareDate(constraint.min, constraint.max) <= 0)) return constraint.min
    const fallback = '2030-01-02'
    if (constraint.max && validDate(constraint.max) && compareDate(fallback, constraint.max) > 0) return constraint.max
    return fallback
  }
  if (type === 'number' || type === 'range') {
    const min = constraint.min === undefined ? undefined : finiteDecimal(constraint.min)
    const max = constraint.max === undefined ? undefined : finiteDecimal(constraint.max)
    if (min !== undefined && max !== undefined && min > max) return undefined
    const value = min ?? 0
    return String(value)
  }
  if (type === 'color') return '#123456'
  return '__uiverse_fixture_input__'
}
