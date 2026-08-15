/** RPS catalog and board contributions for the generic game shell. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-game/client'
import { RpsCatalogItem, RpsSurface } from './RpsSurface.tsx'

export { RpsCatalogItem, RpsSurface } from './RpsSurface.tsx'

/** Required service: the generic game shell's slot declarations. */
export const inject = ['slots']

/** Register the RPS catalog item and keyed surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('game.catalog.item', () => ctx.slots.register({
    name: 'game.catalog.item', id: 'rps', order: 10, label: '剪刀石头布',
  }, RpsCatalogItem))
  ctx.slots.inject('game.surface', () => ctx.slots.register({
    name: 'game.surface', key: 'rps',
  }, RpsSurface))
}
