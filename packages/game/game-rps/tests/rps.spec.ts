import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import GameDefinitions, {
  ActionWindowId, GameCommandId, GameControllerRegistry, MATCH_FORMAT_VERSION, MatchId, SeatId,
} from '@deepseek-ai/dsh-game'
import GameEngine, { MemoryGamePersistence } from '@deepseek-ai/dsh-game-engine'
import * as Rps from '../src/index.ts'
import { createRpsDefinition } from '../src/index.ts'

const choices = ['rock', 'paper', 'scissors'] as const

describe('RPS definition', () => {
  it('resolves all choice pairs', () => {
    const definition = createRpsDefinition({ defaultRounds: 3, maxRounds: 20 })
    for (const left of choices) {
      for (const right of choices) {
        const started = definition.initial({
          config: { roundCount: 1 },
          seats: [
            { id: SeatId('left'), displayName: 'Left', controller: { type: 'human' } },
            { id: SeatId('right'), displayName: 'Right', controller: { type: 'agent', provider: 'test', model: 'test' } },
          ],
          randomSeed: 'rps-test',
        })
        const state = definition.reduce(undefined, started[0]!)
        const [event] = definition.resolve({
          state,
          window: definition.pending(state)!,
          actions: new Map([
            [SeatId('left'), { choice: left }],
            [SeatId('right'), { choice: right }],
          ]),
        })
        const result = event!.data as { winner: string | null }
        expect(result.winner === null).toBe(left === right)
      }
    }
  })

  it('rejects an invalid round count and action', () => {
    const definition = createRpsDefinition({ defaultRounds: 3, maxRounds: 20 })
    expect(() => definition.validateConfig({ roundCount: 0 })).toThrow(/1 through 20/)
    const seat = { id: SeatId('left'), displayName: 'Left', controller: { type: 'human' as const } }
    const state = definition.reduce(undefined, { type: 'rps/started', data: { roundCount: 1, seats: ['left', 'right'] } })
    expect(() => definition.action({ state, window: definition.pending(state)!, seat }).validate({ choice: 'fire' }))
      .toThrow(/rock.*paper.*scissors/)
  })

  it('validates every configuration and action representation', () => {
    const definition = createRpsDefinition({ defaultRounds: 3, maxRounds: 20 })
    expect(definition.validateConfig(undefined)).toEqual({ roundCount: 3 })
    expect(definition.validateConfig(null)).toEqual({ roundCount: 3 })
    for (const invalid of [false, [], { roundCount: 1.5 }, { roundCount: 21 }]) {
      expect(() => definition.validateConfig(invalid)).toThrow()
    }
    const seat = { id: SeatId('left'), displayName: 'Left', controller: { type: 'human' as const } }
    const state = definition.reduce(undefined, { type: 'rps/started', data: { roundCount: 1, seats: ['left', 'right'] } })
    const action = definition.action({ state, window: definition.pending(state)!, seat })
    for (const invalid of [null, [], 'rock']) expect(() => action.validate(invalid)).toThrow(/object/)
    expect(() => action.validate({ choice: 'rock', explanation: 'extra' })).toThrow(/unexpected fields/)
    expect(() => action.validate({})).toThrow(/unexpected fields/)
    expect(() => createRpsDefinition({ defaultRounds: 2, maxRounds: 1 })).toThrow(/must not exceed/)
  })

  it('rejects malformed rule streams and incomplete resolution', () => {
    const definition = createRpsDefinition({ defaultRounds: 1, maxRounds: 1 })
    expect(() => definition.reduce(undefined, { type: 'rps/round-resolved', data: {} })).toThrow(/precedes start/)
    expect(() => definition.reduce({} as never, { type: 'unknown', data: {} })).toThrow(/unknown RPS event/)
    const [started] = definition.initial({
      config: { roundCount: 1 },
      seats: [
        { id: SeatId('left'), displayName: 'Left', controller: { type: 'human' } },
        { id: SeatId('right'), displayName: 'Right', controller: { type: 'human' } },
      ],
      randomSeed: 'rps-test',
    })
    const state = definition.reduce(undefined, started!)
    expect(() => definition.resolve({ state, window: definition.pending(state)!, actions: new Map() })).toThrow(/both choices/)
  })

  it('projects tied, left-winning, and right-winning completed games', () => {
    const definition = createRpsDefinition({ defaultRounds: 1, maxRounds: 1 })
    const seats = [SeatId('left'), SeatId('right')] as const
    const started = definition.reduce(undefined, { type: 'rps/started', data: { roundCount: 1, seats } })
    expect((definition.view(started) as { winner: unknown }).winner).toBeNull()
    for (const [winner, expected] of [[null, null], [seats[0], seats[0]], [seats[1], seats[1]]] as const) {
      const complete = definition.reduce(started, {
        type: 'rps/round-resolved',
        data: { number: 1, choices: { left: 'rock', right: 'rock' }, winner },
      })
      expect((definition.view(complete) as { winner: unknown }).winner).toBe(expected)
      expect(definition.pending(complete)).toBeUndefined()
    }
    expect(definition.modelPrompt(started, seats[0])).toContain('所有思考、分析和自然语言输出必须使用简体中文')
    expect(definition.modelPrompt(started, seats[0])).toContain('当前观察：')

    const missingScores = { ...started, scores: {} }
    expect((definition.view(missingScores) as { winner: unknown }).winner).toBeNull()
    const unknownWinner = definition.reduce(missingScores, {
      type: 'rps/round-resolved',
      data: { number: 1, choices: {}, winner: SeatId('late') },
    })
    expect((unknownWinner.scores as Record<string, number>).late).toBe(1)
  })

  it('registers and disposes the RPS plugin definition', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    const fiber = await ctx.plugin(Rps, { defaultRounds: 2, maxRounds: 4 })
    expect(ctx.gameDefinitions.require('rps').configSchema).toMatchObject({ properties: { roundCount: { default: 2, maximum: 4 } } })
    await fiber.dispose()
    expect(() => ctx.gameDefinitions.require('rps')).toThrow(/unknown game definition/)
    await ctx.fiber.dispose()
  })
})

describe('RPS match', () => {
  it('keeps the first choice sealed and finishes after the configured rounds', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    const persistence = new MemoryGamePersistence()
    await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))

    let view = await ctx.matches.create({
      gameId: 'rps',
      config: { roundCount: 1 },
      seats: [
        { id: SeatId('human'), displayName: 'You', controller: { type: 'human' } },
        { id: SeatId('ai'), displayName: 'AI', controller: { type: 'agent', provider: 'test', model: 'test' } },
      ],
    })
    const windowId = view.window!.id
    view = await ctx.matches.submit({ matchId: view.id, windowId, commandId: GameCommandId('one'), seatId: SeatId('human'), action: { choice: 'rock' } })
    expect((view.game as { rounds: unknown[] }).rounds).toEqual([])
    expect(view.window?.submittedSeats).toEqual([SeatId('human')])

    view = await ctx.matches.submit({ matchId: view.id, windowId, commandId: GameCommandId('two'), seatId: SeatId('ai'), action: { choice: 'scissors' } })
    expect(view.status).toBe('finished')
    expect((view.game as { winner: string }).winner).toBe('human')
    expect({ status: view.status, seats: view.seats, game: view.game }).toMatchInlineSnapshot(`
      {
        "game": {
          "roundCount": 1,
          "rounds": [
            {
              "choices": {
                "ai": "scissors",
                "human": "rock",
              },
              "number": 1,
              "winner": "human",
            },
          ],
          "scores": {
            "ai": 0,
            "human": 1,
          },
          "winner": "human",
        },
        "seats": [
          {
            "controller": {
              "type": "human",
            },
            "displayName": "You",
            "id": "human",
          },
          {
            "controller": {
              "model": "test",
              "provider": "test",
              "type": "agent",
            },
            "displayName": "AI",
            "id": "ai",
          },
        ],
        "status": "finished",
      }
    `)
    expect((await persistence.load(view.id))?.events).toHaveLength(6)
    await ctx.fiber.dispose()
  })

  it('returns the committed view for a repeated command id', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', new MemoryGamePersistence()))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))
    const created = await ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 }, seats: [
        { id: SeatId('a'), displayName: 'A', controller: { type: 'human' } },
        { id: SeatId('b'), displayName: 'B', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ],
    })
    const request = { matchId: created.id, windowId: created.window!.id, commandId: GameCommandId('same'), seatId: SeatId('a'), action: { choice: 'paper' } }
    const first = await ctx.matches.submit(request)
    const repeated = await ctx.matches.submit(request)
    expect(repeated.revision).toBe(first.revision)
    await expect(ctx.matches.submit({ ...request, action: { choice: 'rock' } })).rejects.toThrow(/reused with different input/)
    await ctx.fiber.dispose()
  })

  it('abandons an open match, drains controllers, and rejects later actions', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', new MemoryGamePersistence()))
    const cancel = vi.fn(() => Promise.resolve())
    ctx.gameControllers.register('agent', { validate: async () => undefined, drive: async () => undefined, cancel })
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))
    const created = await ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 }, seats: [
        { id: SeatId('person'), displayName: 'Person', controller: { type: 'human' } },
        { id: SeatId('bot'), displayName: 'Bot', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ],
    })
    const abandoned = await ctx.matches.abandon(created.id)
    expect(abandoned.status).toBe('abandoned')
    expect(abandoned).not.toHaveProperty('window')
    expect(cancel).toHaveBeenCalledWith(created.id)
    await expect(ctx.matches.submit({
      matchId: created.id, windowId: created.window!.id, commandId: GameCommandId('late'),
      seatId: SeatId('person'), action: { choice: 'rock' },
    })).rejects.toThrow(/abandoned/)
    await ctx.fiber.dispose()
  })

  it('does not persist a header when initial rule validation rejects', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    const persistence = new MemoryGamePersistence()
    await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))
    await expect(ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 },
      seats: [{ id: SeatId('alone'), displayName: 'Alone', controller: { type: 'human' } }],
    })).rejects.toThrow(/exactly two seats/)
    await expect(persistence.list()).resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('assigns wire submissions to the human seat and rejects AI-only matches', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', new MemoryGamePersistence()))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))
    const humanMatch = await ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 }, seats: [
        { id: SeatId('person'), displayName: 'Person', controller: { type: 'human' } },
        { id: SeatId('bot'), displayName: 'Bot', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ],
    })
    const submitted = await (ctx.matches as GameEngine).remoteSubmit({
      matchId: humanMatch.id, windowId: humanMatch.window!.id, commandId: 'wire', action: { choice: 'rock' },
    })
    expect(submitted.window?.submittedSeats).toEqual([SeatId('person')])
    const aiMatch = await ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 }, seats: [
        { id: SeatId('one'), displayName: 'One', controller: { type: 'agent', provider: 'x', model: 'y' } },
        { id: SeatId('two'), displayName: 'Two', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ],
    })
    await expect((ctx.matches as GameEngine).remoteSubmit({
      matchId: aiMatch.id, windowId: aiMatch.window!.id, commandId: 'wire-ai', action: { choice: 'paper' },
    })).rejects.toThrow(/no human-controlled seat/)
    await ctx.fiber.dispose()
  })

  it('resumes an open AI action when its controller registers', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', new MemoryGamePersistence()))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))
    const match = await ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 }, seats: [
        { id: SeatId('person'), displayName: 'Person', controller: { type: 'human' } },
        { id: SeatId('bot'), displayName: 'Bot', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ],
    })
    const driven = new Promise<string>((resolve) => {
      ctx.gameControllers.register('agent', {
        validate: async () => undefined,
        drive: async (request) => { resolve(request.windowId) },
        cancel: async () => undefined,
      })
    })
    await expect(driven).resolves.toBe(match.window!.id)
    await ctx.fiber.dispose()
  })

  it('reconciles an open AI action when dependencies registered before the engine', async () => {
    const ctx = new Context()
    const persistence = new MemoryGamePersistence()
    const definition = createRpsDefinition({ defaultRounds: 3, maxRounds: 20 })
    const matchId = MatchId('persisted')
    const windowId = ActionWindowId('persisted:window:1')
    const person = SeatId('person')
    const bot = SeatId('bot')
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
    ctx.gameDefinitions.register(definition)
    const driven = new Promise<string>((resolve) => {
      ctx.gameControllers.register('agent', {
        validate: async () => undefined,
        drive: async (request) => { resolve(request.windowId) },
        cancel: async () => undefined,
      })
    })
    await persistence.create({
      id: matchId,
      formatVersion: MATCH_FORMAT_VERSION,
      gameId: definition.id,
      rulesVersion: definition.rulesVersion,
      config: { roundCount: 1 },
      seats: [
        { id: person, displayName: 'Person', controller: { type: 'human' } },
        { id: bot, displayName: 'Bot', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ],
      createdAt: 1,
      events: [
        { seq: 0, time: 1, type: 'match/rule', data: { ruleType: 'rps/started', ruleData: { roundCount: 1, seats: [person, bot] } } },
        { seq: 1, time: 1, type: 'match/action-opened', data: { windowId, key: 'round-1', requiredSeats: [person, bot], audience: 'public' } },
      ],
    })
    await ctx.plugin(GameEngine)
    await expect(driven).resolves.toBe(windowId)
    await ctx.fiber.dispose()
  })

  it('continues recovery after an unrelated persisted game is unavailable', async () => {
    const ctx = new Context()
    const persistence = new MemoryGamePersistence()
    const definition = createRpsDefinition({ defaultRounds: 3, maxRounds: 20 })
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
    await persistence.create({
      id: MatchId('unknown'), formatVersion: MATCH_FORMAT_VERSION, gameId: 'removed', rulesVersion: 1, config: {},
      seats: [{ id: SeatId('bot'), displayName: 'Bot', controller: { type: 'agent', provider: 'x', model: 'y' } }],
      createdAt: 1, events: [],
    })
    const matchId = MatchId('known')
    const windowId = ActionWindowId('known:window:1')
    await persistence.create({
      id: matchId, formatVersion: MATCH_FORMAT_VERSION, gameId: 'rps', rulesVersion: 1, config: { roundCount: 1 },
      seats: [
        { id: SeatId('person'), displayName: 'Person', controller: { type: 'human' } },
        { id: SeatId('bot'), displayName: 'Bot', controller: { type: 'agent', provider: 'x', model: 'y' } },
      ], createdAt: 2,
      events: [
        { seq: 0, time: 1, type: 'match/rule', data: { ruleType: 'rps/started', ruleData: { roundCount: 1, seats: ['person', 'bot'] } } },
        { seq: 1, time: 1, type: 'match/action-opened', data: { windowId, key: 'round-1', requiredSeats: ['person', 'bot'], audience: 'public' } },
      ],
    })
    ctx.gameDefinitions.register(definition)
    const driven = new Promise<string>((resolve) => {
      ctx.gameControllers.register('agent', {
        validate: async () => undefined,
        drive: async (request) => { resolve(request.windowId) },
        cancel: async () => undefined,
      })
    })
    await ctx.plugin(GameEngine)
    await expect(driven).resolves.toBe(windowId)
    await ctx.fiber.dispose()
  })

  it('preserves but does not drive an open match with an incompatible persisted controller', async () => {
    const ctx = new Context()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', new MemoryGamePersistence()))
    await ctx.plugin(GameEngine)
    ctx.gameDefinitions.register(createRpsDefinition({ defaultRounds: 3, maxRounds: 20 }))
    await ctx.matches.create({
      gameId: 'rps', config: { roundCount: 1 }, seats: [
        { id: SeatId('person'), displayName: 'Person', controller: { type: 'human' } },
        { id: SeatId('bot'), displayName: 'Bot', controller: { type: 'agent', provider: 'removed', model: 'old' } },
      ],
    })
    const drive = vi.fn(() => Promise.resolve())
    const validate = vi.fn(() => Promise.reject(new Error('provider is unavailable')))
    ctx.gameControllers.register('agent', { validate, drive, cancel: async () => undefined })
    await vi.waitFor(() => { expect(validate).toHaveBeenCalled() })
    expect(drive).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
