/** Package-owned invariant companion for SQLite match persistence. @module @deepseek-ai/dsh-game-persistence-sqlite/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-game-persistence-sqlite'
/** Cordis companion plugin name. */
export const name = 'game-persistence-sqlite-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: transactions validate revision and sequence at the persistence operation. */
const install: InvariantInstaller = () => {}
/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
