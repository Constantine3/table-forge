/** Package-owned invariant companion for the Table Forge bundle. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** No runtime invariant: Loader gates inspect the declarative bundle rows. */
const install: InvariantInstaller = () => {}
export const name = 'game-app-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-game-app', install))
