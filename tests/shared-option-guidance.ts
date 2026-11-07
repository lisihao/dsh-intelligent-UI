import type { JevJson, JevQuestion, JevRequest } from '../src/adaptive-ui/contracts.js'
import { SHARED_OPTION_GUIDANCE_PATH } from '../src/adaptive-ui/question-sharing.js'

export type SharedOptionGuidanceSection = { format: string, merge: string, options: Record<string, Record<string, Record<string, JevJson>>> }

/** Test-only inverse of `shareBlockOptionGuidance`, so a round trip can be compared exactly. */
export function expandSharedOptionGuidance(questions: readonly JevQuestion[], shared: SharedOptionGuidanceSection | undefined): JevQuestion[] {
  return questions.map(item => {
    const prompt = { ...(item.prompt as Record<string, JevJson>) }
    delete prompt.optionGuidanceRef
    return { ...item, prompt, options: item.options.map(option => {
      const description = option.description as Record<string, JevJson> | null
      if (!description || typeof description.guidanceRef !== 'string') return option
      const { guidanceRef, ...rest } = description
      const [field, optionId] = (guidanceRef as string).slice(`${SHARED_OPTION_GUIDANCE_PATH}.options.`.length).split('.')
      return { id: option.id, description: { ...shared!.options[field!]![optionId!]!, ...rest } }
    }) }
  })
}

export function expandRequestQuestions(request: JevRequest): JevQuestion[] {
  const composition = (request.state as { composition?: { sharedOptionGuidance?: SharedOptionGuidanceSection } }).composition
  return expandSharedOptionGuidance(request.questions, composition?.sharedOptionGuidance)
}
