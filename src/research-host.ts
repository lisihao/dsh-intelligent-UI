import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ResearchApi, ResearchDocument, PrepareInput, MarkSubmissionInput, SaveNotesInput } from './research-contracts.js'
import { ResearchStore } from './research-store.js'
import { SERVICE_ID } from './research-remote.js'

export const RESEARCH_TOOL = 'solar_research_submit'
export class ResearchControl extends TypertRemoteService implements ResearchApi {
  constructor(ctx: Context, readonly store: ResearchStore) { super(ctx, SERVICE_ID) }
  private owner(): void {
    if (this.ctx.invocation !== undefined && this.ctx.invocation.peer.principal.kind !== 'owner') throw new Error('RESEARCH_OWNER_REQUIRED')
  }
  @Remote
  async get(input: ResearchDocument) { this.owner(); return this.store.get(input) }
  @Remote
  async prepare(input: PrepareInput) { this.owner(); return this.store.prepare(input) }
  @Remote
  async markSubmission(input: MarkSubmissionInput) { this.owner(); return this.store.markSubmission(input) }
  @Remote
  async saveNotes(input: SaveNotesInput) { this.owner(); return this.store.saveNotes(input) }
}
declare module '@deepseek-ai/cordis' { interface Context { solarResearch: ResearchControl } }

const anchor = { type: 'object', additionalProperties: false, properties: { start: { type: 'integer' }, end: { type: 'integer' }, quote: { type: 'string', required: true } } } as const satisfies ValueSchemaSpec
const strings = { type: 'array', items: { type: 'string' } } as const satisfies ValueSchemaSpec
export function createResearchTool(store: ResearchStore) {
  return defineTool({
    name: RESEARCH_TOOL,
    description: 'Submit organization of a report explicitly prepared in this same session. Prefer exact verbatim quote-only anchors; a unique quote resolves automatically to UTF-16 offsets. Repeated quotes require both correct start/end offsets; incorrect offsets and ambiguous quotes are rejected. Uses links already in the supplied report. Does not fetch or verify sources. AI assertions remain unreviewed; only the human owner can confirm/question claims. Full arguments/results remain in normal tool logs.',
    parameters: {
      requestId: { type: 'string', required: true },
      analysis: { type: 'object', additionalProperties: false, required: true, properties: {
        formatVersion: { type: 'integer', const: 1, required: true }, reportHash: { type: 'string', required: true }, question: { type: 'string', required: true },
        claims: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, text: { type: 'string', required: true }, kind: { type: 'string', enum: ['observation', 'inference', 'hypothesis'], required: true }, anchor: { ...anchor, required: true }, conditions: { ...strings, required: true }, openQuestions: { ...strings, required: true },
          evidence: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, relation: { type: 'string', enum: ['citation', 'support', 'challenge', 'limitation'], required: true }, anchor: { ...anchor, required: true }, sourceUrl: { type: 'string' }, note: { type: 'string' } } } },
        } } },
      } },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: () => ({ card: 'generic', kind: 'edit', title: '保存报告整理结果' }),
    async execute(args, exec) { return await store.submit(args, exec.agent?.session.id) as never },
  })
}

/** Plugin-owned persistence and registrations only; the client dispatches visible session prompts. */
export function installResearch(ctx: Context, root: string): ResearchControl {
  if (ctx.get(SERVICE_ID) || ctx.tools.get(RESEARCH_TOOL)) throw new Error('RESEARCH_REGISTRATION_CONFLICT')
  const store = new ResearchStore(root)
  const control = new ResearchControl(ctx, store)
  ctx.effect(() => ctx.tools.register(createResearchTool(store)))
  return control
}
