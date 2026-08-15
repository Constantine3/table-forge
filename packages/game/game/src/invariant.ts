/** Package-owned invariant companion for game service definitions. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** No runtime invariant: each registry rejects invalid owned mutations synchronously. */
const install: InvariantInstaller = () => {}
export const name = 'game-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-game', install))
