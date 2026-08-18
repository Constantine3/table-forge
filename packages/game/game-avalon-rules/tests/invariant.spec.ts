import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as AvalonRulesInvariant from '../src/invariant.ts'

describe('Avalon rule catalog invariant companion', () => {
  it('registers the pure package without runtime checks', async () => {
    expect(AvalonRulesInvariant.name).toBe('game-avalon-rules-invariant')
    expect(AvalonRulesInvariant.inject).toEqual(['invariants'])
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AvalonRulesInvariant)
    await ctx.fiber.dispose()
  })
})
