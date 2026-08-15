/** Package-owned invariant companion for the Agent seat controller. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** No runtime invariant: controller requests have no independent mutable companion state. */
const install: InvariantInstaller = () => {}
export const name = 'game-controller-agent-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-game-controller-agent', install))
