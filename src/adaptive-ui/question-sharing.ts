import type { JevJson, JevQuestion } from './contracts.js'
import { stableExecutableJson } from './executable-registry.js'

export const SHARED_OPTION_GUIDANCE_FORMAT = 'shared-option-guidance@1'
/** State path of the shared section, in the same dotted form as `designRubricRef`. */
export const SHARED_OPTION_GUIDANCE_PATH = 'composition.sharedOptionGuidance'

const SEGMENT = /^[a-z][a-z0-9-]{0,63}$/
const REFERENCE_KEY = 'guidanceRef'

type JsonRecord = { readonly [key: string]: JevJson }

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function blockField(question: JevQuestion): string | undefined {
  const prompt = question.prompt
  if (!isRecord(prompt) || prompt.scope !== 'block' || typeof prompt.field !== 'string') return undefined
  return SEGMENT.test(prompt.field) ? prompt.field : undefined
}

export interface SharedOptionGuidance {
  readonly questions: readonly JevQuestion[]
  /** Absent when no option field is identical in two or more block questions. */
  readonly shared?: JevJson
}

/**
 * Sends option guidance that is identical in every block question of one field
 * once, in request state, and leaves a `guidanceRef` plus the block-specific
 * fields in each option. Prompts carry task rules and stay in each question,
 * because Jev sends state through the same input channel as untrusted source text.
 */
export function shareBlockOptionGuidance(questions: readonly JevQuestion[]): SharedOptionGuidance {
  const groups = new Map<string, JevQuestion[]>()
  for (const question of questions) {
    const field = blockField(question)
    if (field === undefined) continue
    const group = groups.get(field) ?? []
    group.push(question)
    groups.set(field, group)
  }

  const shared: Record<string, Record<string, JsonRecord>> = {}
  for (const [field, group] of groups) {
    const descriptions = new Map<string, JsonRecord[]>()
    let conflicting = false
    for (const question of group) {
      for (const option of question.options) {
        if (!isRecord(option.description)) continue
        if (Object.hasOwn(option.description, REFERENCE_KEY)) conflicting = true
        if (!SEGMENT.test(option.id)) continue
        const list = descriptions.get(option.id) ?? []
        list.push(option.description)
        descriptions.set(option.id, list)
      }
    }
    if (conflicting) continue
    for (const [optionId, list] of descriptions) {
      if (list.length < 2) continue
      const first = list[0]!
      const keys = Object.keys(first).filter(key => list.every(description => Object.hasOwn(description, key)
        && stableExecutableJson(description[key]) === stableExecutableJson(first[key])))
      if (!keys.length) continue
      shared[field] ??= {}
      shared[field][optionId] = Object.fromEntries(keys.map(key => [key, first[key]!]))
    }
  }
  if (!Object.keys(shared).length) return { questions }

  const rewritten = questions.map(question => {
    const field = blockField(question)
    const fieldShared = field === undefined ? undefined : shared[field]
    if (field === undefined || fieldShared === undefined) return question
    let referenced = false
    const options = question.options.map(option => {
      const guidance = fieldShared[option.id]
      if (guidance === undefined || !isRecord(option.description)) return option
      referenced = true
      const rest = Object.fromEntries(Object.entries(option.description).filter(([key]) => !Object.hasOwn(guidance, key)))
      return { id: option.id, description: { [REFERENCE_KEY]: `${SHARED_OPTION_GUIDANCE_PATH}.options.${field}.${option.id}`, ...rest } }
    })
    if (!referenced) return question
    return { ...question, prompt: { ...(question.prompt as JsonRecord), optionGuidanceRef: SHARED_OPTION_GUIDANCE_PATH }, options }
  })
  return {
    questions: rewritten,
    shared: {
      format: SHARED_OPTION_GUIDANCE_FORMAT,
      merge: 'An option description with guidanceRef means the object at that path in this state, plus the other fields of that description. The referenced object is identical for every block question that cites it.',
      options: shared,
    },
  }
}
