/** Table Forge game product bundle marker. */

import type { Context } from '@deepseek-ai/cordis'
import { GameControllerRegistry } from '@deepseek-ai/dsh-game'

/** Stable Cordis plugin name. */
export const name = 'game-app'

/**
 * Mount bundle-local runtime glue.
 * @param _ctx - bundle plugin context; composition lives in the patch layer.
 */
export function apply(ctx: Context): void {
  ctx.plugin(GameControllerRegistry)
}
