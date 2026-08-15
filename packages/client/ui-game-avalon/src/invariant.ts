/** Package-owned invariant companion for the Avalon browser surface. @module @deepseek-ai/dsh-client-ui-game-avalon/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-game-avalon'
/** Cordis companion plugin name. */
export const name = 'client-ui-game-avalon-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: client manifest gates inspect the keyed slot contribution. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
