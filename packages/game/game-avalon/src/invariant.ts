/** Package-owned invariant companion for the Avalon definition. @module @deepseek-ai/dsh-game-avalon/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-game-avalon'
/** Cordis companion plugin name. */
export const name = 'game-avalon-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: event relations are owned by the pure definition methods. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
