import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

const HEADER_ACTION_SLOT = 'conversation.session.header.actions' as const
const HIDDEN_HEADER_ACTION_IDS = [
  'agent-team',
  'subagent-catalog',
  'solar-pstack-status',
  'cost-meter-statistics',
  'agy-link-status',
] as const
const HIDDEN_HEADER_ACTION_PRIORITY = -100

type HeaderActionProps = PropsRuntime<typeof HEADER_ACTION_SLOT>

/** Shadows only the redundant native Session header actions. */
export function installCollaborationHeaderPolicy(ctx: Context): void {
  // SlotRegistry.inject already owns this callback and every register disposer
  // through the caller's ctx.effect; adding another wrapper would duplicate it.
  ctx.slots.inject(HEADER_ACTION_SLOT, () => HIDDEN_HEADER_ACTION_IDS.map(id => ctx.slots.register(
    { name: HEADER_ACTION_SLOT, id, priority: HIDDEN_HEADER_ACTION_PRIORITY },
    (_props: HeaderActionProps) => null,
  )))
}
