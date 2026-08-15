import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import GameDefinitions, {
  GameControllerRegistry,
  MatchId,
  type GameDefinition,
} from '../src/index.ts'

const definition = (id: string): GameDefinition => ({
  id, rulesVersion: 1, configSchema: {}, actionSchema: {},
  validateConfig: () => null, validateAction: () => null, initial: () => [],
  reduce: () => null, pending: () => undefined, resolve: () => [], view: () => null,
  modelPrompt: () => '',
})

describe('game registries', () => {
  it('contains controller listener failures without suppressing other listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(GameControllerRegistry)
    const observed = vi.fn()
    ctx.gameControllers.onRegister(() => { throw new Error('broken observer') })
    ctx.gameControllers.onRegister(observed)
    const dispose = ctx.gameControllers.register('agent', {
      validate: async () => undefined,
      drive: async () => undefined,
      cancel: async () => undefined,
    })
    expect(observed).toHaveBeenCalledWith('agent')
    expect(ctx.gameControllers.has('agent')).toBe(true)
    dispose()
    expect(ctx.gameControllers.has('agent')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('contains definition listener failures during replay', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    ctx.gameDefinitions.register({
      id: 'test', rulesVersion: 1, configSchema: {}, actionSchema: {},
      validateConfig: () => null, validateAction: () => null, initial: () => [],
      reduce: () => null, pending: () => undefined, resolve: () => [], view: () => null,
      modelPrompt: () => '',
    })
    expect(() => ctx.gameDefinitions.onRegister(() => { throw new Error('broken observer') })).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('owns controller registration, dispatch, validation, cancellation, and stale disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(GameControllerRegistry)
    const first = {
      validate: vi.fn(() => Promise.resolve()),
      drive: vi.fn(() => Promise.resolve()),
      cancel: vi.fn(() => Promise.resolve()),
    }
    const dispose = ctx.gameControllers.register('agent', first)
    await expect(ctx.gameControllers.validate('agent', { type: 'human' })).resolves.toBeUndefined()
    await expect(ctx.gameControllers.drive('agent', {} as never)).resolves.toBeUndefined()
    await expect(ctx.gameControllers.cancel(MatchId('match'))).resolves.toBeUndefined()
    expect(first.validate).toHaveBeenCalled()
    expect(first.drive).toHaveBeenCalled()
    expect(first.cancel).toHaveBeenCalledWith(MatchId('match'))
    expect(() => ctx.gameControllers.register('agent', first)).toThrow(/already registered/)
    dispose()
    dispose()
    await expect(ctx.gameControllers.drive('agent', {} as never)).rejects.toThrow(/unavailable/)
    await expect(ctx.gameControllers.validate('agent', { type: 'human' })).rejects.toThrow(/unavailable/)
    await ctx.fiber.dispose()
  })

  it('replays controller registrations and supports removing listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(GameControllerRegistry)
    const provider = { validate: async () => undefined, drive: async () => undefined, cancel: async () => undefined }
    ctx.gameControllers.register('agent', provider)
    const observed = vi.fn()
    const stop = ctx.gameControllers.onRegister(observed)
    expect(observed).toHaveBeenCalledWith('agent')
    stop()
    ctx.gameControllers.register('other', provider)
    expect(observed).toHaveBeenCalledTimes(1)
    ctx.gameControllers.onRegister(() => { throw 'broken' })
    expect(() => ctx.gameControllers.register('third', provider)).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('owns definition lookup, ordering, duplicate rejection, and stale disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    const beta = definition('beta')
    const alpha = definition('alpha')
    const dispose = ctx.gameDefinitions.register(beta)
    ctx.gameDefinitions.register(alpha)
    expect(ctx.gameDefinitions.list().map(item => item.id)).toEqual(['alpha', 'beta'])
    expect(ctx.gameDefinitions.require('beta')).toBe(beta)
    expect(() => ctx.gameDefinitions.require('missing')).toThrow(/unknown game definition/)
    expect(() => ctx.gameDefinitions.register(beta)).toThrow(/already registered/)
    dispose()
    dispose()
    expect(() => ctx.gameDefinitions.require('beta')).toThrow(/unknown game definition/)
    await ctx.fiber.dispose()
  })

  it('contains non-Error listener failures and removes definition listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    const stop = ctx.gameDefinitions.onRegister(() => { throw 'broken' })
    expect(() => ctx.gameDefinitions.register(definition('one'))).not.toThrow()
    stop()
    expect(() => ctx.gameDefinitions.register(definition('two'))).not.toThrow()
    await ctx.fiber.dispose()
  })
})
