/** Package-owned invariant companion for the RPS browser surface. @module @deepseek-ai/dsh-client-ui-game-rps/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-game-rps'
/** Cordis companion plugin name. */
export const name = 'client-ui-game-rps-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: client manifest gates inspect the keyed slot contribution. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
