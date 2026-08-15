/** Avalon catalog and board contributions for the generic game shell. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-game/client'
import { AvalonCatalogItem, AvalonSurface } from './AvalonSurface.tsx'

export { AvalonCatalogItem, AvalonSurface } from './AvalonSurface.tsx'

/** Required service: the generic game shell's slot declarations. */
export const inject = ['slots']

/** Register the Avalon catalog item and keyed surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('game.catalog.item', () => ctx.slots.register({
    name: 'game.catalog.item', id: 'avalon', order: 20, label: '阿瓦隆',
  }, AvalonCatalogItem))
  ctx.slots.inject('game.surface', () => ctx.slots.register({
    name: 'game.surface', key: 'avalon',
  }, AvalonSurface))
}
