/** Package-owned invariant companion for the game root view. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
/** No runtime invariant: the client manifest gates inspect the root-slot contribution. */
const install: InvariantInstaller = () => {}
export const name = 'client-ui-game-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-client-ui-game', install))
