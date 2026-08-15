/** Package-owned invariant companion for the match engine. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** No runtime invariant: persistence checks sequence relationships on every append. */
const install: InvariantInstaller = () => {}
export const name = 'game-engine-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-game-engine', install))
