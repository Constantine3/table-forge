import { Context } from '@deepseek-ai/cordis'
import GameDefinitions, {
  ActionWindowId, GameCommandId, GameControllerRegistry, MATCH_FORMAT_VERSION, MatchId, SeatId,
  type GameDefinition, type GameJson, type GameRuleEvent, type MatchEvent, type MatchRecord,
} from '@deepseek-ai/dsh-game'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GameEngine, { applyMemoryPersistence, MemoryGamePersistence } from '../src/index.ts'

interface State {
  readonly seats: readonly [SeatId, SeatId]
  readonly choices?: Readonly<Record<string, string>>
}

const definition: GameDefinition<State> = {
  id: 'simultaneous',
  rulesVersion: 1,
  configSchema: { type: 'object' },
  validateConfig: () => ({}),
  initial({ seats }): readonly GameRuleEvent[] {
    return [{ type: 'started', data: { seats: seats.map(seat => seat.id) } }]
  },
  reduce(state, event): State {
    if (event.type === 'started') return { seats: (event.data as { seats: [SeatId, SeatId] }).seats }
    if (state === undefined || event.type !== 'resolved') throw new Error(`invalid event '${event.type}'`)
    return { ...state, choices: event.data as Readonly<Record<string, string>> }
  },
  pending: state => state.choices === undefined ? { key: 'choice', requiredSeats: state.seats, audience: 'public' } : undefined,
  action: () => ({
    schema: { type: 'string' },
    validate(value): GameJson {
      if (typeof value !== 'string') throw new Error('action must be a string')
      return value
    },
  }),
  resolve({ actions }): readonly GameRuleEvent[] {
    return [{ type: 'resolved', data: Object.fromEntries(actions) }]
  },
  view: state => ({ choices: state.choices ?? null }),
  modelPrompt: () => 'Choose.',
}

async function mounted(): Promise<{ ctx: Context; engine: GameEngine; persistence: MemoryGamePersistence }> {
  const ctx = new Context()
  const persistence = new MemoryGamePersistence()
  await ctx.plugin(GameDefinitions)
  await ctx.plugin(GameControllerRegistry)
  await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
  ctx.gameDefinitions.register(definition)
  await ctx.plugin(GameEngine)
  return { ctx, engine: ctx.matches as GameEngine, persistence }
}

const seats = [
  { id: SeatId('human'), displayName: 'Human', controller: { type: 'human' as const } },
  { id: SeatId('ai'), displayName: 'AI', controller: { type: 'agent' as const, provider: 'p', model: 'm' } },
] as const

// Controllers are external plugins and JavaScript promises permit any rejection value.
// oxlint-disable-next-line typescript/prefer-promise-reject-errors
const rejected = <T = void>(cause: unknown): Promise<T> => new Promise((_resolve, reject) => { reject(cause) })

describe('game engine transactions', () => {
  afterEach(() => vi.useRealTimers())

  it('serializes simultaneous submissions and resolves the window exactly once', async () => {
    const { ctx, engine, persistence } = await mounted()
    const created = await engine.create({ gameId: definition.id, config: {}, seats })
    const windowId = created.window!.id

    const [left, right] = await Promise.all([
      engine.submit({ matchId: created.id, windowId, commandId: GameCommandId('left'), seatId: seats[0].id, action: 'rock' }),
      engine.submit({ matchId: created.id, windowId, commandId: GameCommandId('right'), seatId: seats[1].id, action: 'paper' }),
    ])

    expect([left.status, right.status]).toContain('finished')
    const record = await persistence.load(created.id)
    expect(record?.events.filter(event => event.type === 'match/action-closed')).toHaveLength(1)
    expect(record?.events.filter(event => event.type === 'match/rule')).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('returns an identical command replay and rejects reuse with different input', async () => {
    const { ctx, engine } = await mounted()
    const created = await engine.create({ gameId: definition.id, config: {}, seats })
    const request = {
      matchId: created.id,
      windowId: created.window!.id,
      commandId: GameCommandId('same'),
      seatId: seats[0].id,
      action: 'rock',
    }
    const first = await engine.submit(request)
    await expect(engine.submit(request)).resolves.toEqual(first)
    await expect(engine.submit({ ...request, action: 'paper' })).rejects.toThrow(/reused with different input/)
    await ctx.fiber.dispose()
  })

  it('compares idempotent JSON structurally and rejects non-lossless action input', async () => {
    const { ctx, engine } = await mounted()
    const jsonDefinition: GameDefinition<{ readonly seat: SeatId; readonly done: boolean }> = {
      id: 'json', rulesVersion: 1, configSchema: {}, validateConfig: () => ({}),
      initial: ({ seats: initialSeats }) => [{ type: 'json-started', data: { seat: initialSeats[0]!.id } }],
      reduce: (state, event) => event.type === 'json-started'
        ? { seat: (event.data as { seat: SeatId }).seat, done: false }
        : { ...state!, done: true },
      pending: state => state.done ? undefined : { key: 'json', requiredSeats: [state.seat], audience: 'public' },
      action: () => ({ schema: {}, validate: value => value as GameJson }),
      resolve: () => [{ type: 'json-done', data: null }], view: state => state, modelPrompt: () => '',
    }
    ctx.gameDefinitions.register(jsonDefinition)

    const objectMatch = await engine.create({ gameId: 'json', config: {}, seats: [seats[0]] })
    const objectRequest = {
      matchId: objectMatch.id, windowId: objectMatch.window!.id, commandId: GameCommandId('object'),
      seatId: seats[0].id, action: { first: [1, true], second: 'value' },
    }
    const committed = await engine.submit(objectRequest)
    await expect(engine.submit({ ...objectRequest, action: { second: 'value', first: [1, true] } })).resolves.toEqual(committed)
    await expect(engine.submit({ ...objectRequest, action: { second: 'value', first: [1] } })).rejects.toThrow(/different input/)
    await expect(engine.submit({ ...objectRequest, action: { third: 'value', first: [1, true] } })).rejects.toThrow(/different input/)
    await expect(engine.submit({ ...objectRequest, action: [] })).rejects.toThrow(/different input/)
    await expect(engine.submit({ ...objectRequest, action: null })).rejects.toThrow(/different input/)

    const nullMatch = await engine.create({ gameId: 'json', config: {}, seats: [seats[0]] })
    const nullRequest = {
      matchId: nullMatch.id, windowId: nullMatch.window!.id, commandId: GameCommandId('null'),
      seatId: seats[0].id, action: null,
    }
    await engine.submit(nullRequest)
    await expect(engine.submit(nullRequest)).resolves.toMatchObject({ status: 'finished' })
    await expect(engine.submit({ ...nullRequest, action: {} })).rejects.toThrow(/different input/)

    const invalid = await engine.create({ gameId: definition.id, config: {}, seats })
    for (const [index, [action, error]] of [
      [null, /action must be a string/], [7, /action must be a string/], [['rock'], /action must be a string/],
      [Number.NaN, /lossless JSON/], [undefined, /lossless JSON/], [{ value: undefined }, /lossless JSON/],
    ].entries()) {
      await expect(engine.submit({
        matchId: invalid.id, windowId: invalid.window!.id, commandId: GameCommandId(`invalid-${index}`),
        seatId: seats[0].id, action,
      })).rejects.toThrow(error)
    }
    await ctx.fiber.dispose()
  })

  it('rejects unsupported rules and malformed persisted event streams', async () => {
    const { ctx, engine, persistence } = await mounted()
    const unsupported = MatchId('unsupported')
    await persistence.create({
      id: unsupported, formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 2,
      config: {}, seats, createdAt: 1, events: [{ seq: 0, time: 1, type: 'match/rule', data: { ruleType: 'started', ruleData: { seats: ['human', 'ai'] } } }],
    })
    await expect(engine.get(unsupported)).rejects.toThrow(/unsupported rules version/)
    await expect(engine.remoteGet(unsupported)).resolves.toBeUndefined()

    const oldFormat = MatchId('old-format')
    await persistence.create({
      id: oldFormat, formatVersion: 0, gameId: definition.id, rulesVersion: 1,
      config: {}, seats, createdAt: 1, events: [],
    })
    await expect(engine.get(oldFormat)).rejects.toThrow(/unsupported format 0/)

    const corrupt = MatchId('corrupt')
    await persistence.create({
      id: corrupt, formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 1,
      config: {}, seats, createdAt: 1, events: [{ seq: 0, time: 1, type: 'match/action-submitted', data: { windowId: ActionWindowId('missing'), commandId: 'x', seatId: 'human', action: 'rock' } }],
    })
    await expect(engine.get(corrupt)).rejects.toThrow(/corrupt match submission window/)
    await expect(engine.remoteGet(corrupt)).rejects.toThrow(/corrupt match submission window/)
    await expect(engine.list()).rejects.toThrow(/corrupt match submission window/)
    await ctx.fiber.dispose()
  })

  it('keeps unsupported match and rules formats out of product listing and restore', async () => {
    const { ctx, engine, persistence } = await mounted()
    const legacy = MatchId('legacy')
    await persistence.create({
      id: legacy, formatVersion: 0, gameId: definition.id, rulesVersion: 1,
      config: {}, seats, createdAt: 1, events: [],
    })
    const oldRules = MatchId('old-rules')
    await persistence.create({
      id: oldRules, formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 2,
      config: {}, seats, createdAt: 2, events: [],
    })
    const current = await engine.create({ gameId: definition.id, config: {}, seats })
    await expect(engine.remoteGet(legacy)).resolves.toBeUndefined()
    await expect(engine.remoteGet(oldRules)).resolves.toBeUndefined()
    await expect(engine.list()).resolves.toEqual([expect.objectContaining({ id: current.id })])
    await ctx.fiber.dispose()
  })

  it('enforces in-memory persistence creation and append invariants', async () => {
    const persistence = new MemoryGamePersistence()
    const base: MatchRecord = {
      id: MatchId('memory'), formatVersion: MATCH_FORMAT_VERSION, gameId: 'test', rulesVersion: 1,
      config: {}, seats: [], createdAt: 1, events: [],
    }
    await persistence.create(base)
    expect(() => persistence.create(base)).toThrow(/already exists/)
    expect(() => persistence.create({
      ...base, id: MatchId('bad-initial'), events: [{ seq: 1, time: 1, type: 'match/abandoned', data: {} }],
    })).toThrow(/initial events are not contiguous/)
    expect(() => persistence.append(MatchId('missing'), 0, [])).toThrow(/unknown match/)
    expect(() => persistence.append(base.id, 1, [])).toThrow(/revision conflict/)
    expect(() => persistence.append(base.id, 0, [{ seq: 1, time: 1, type: 'match/abandoned', data: {} }]))
      .toThrow(/append is not contiguous/)
    await persistence.append(base.id, 0, [{ seq: 0, time: 1, type: 'match/abandoned', data: {} }])
    expect(await persistence.list()).toEqual([{ ...base, events: undefined }].map(({ events: _events, ...header }) => header))
  })

  it('rejects invalid seat layouts before persistence', async () => {
    const { ctx, engine, persistence } = await mounted()
    await expect(engine.create({ gameId: definition.id, config: {}, seats: [] })).rejects.toThrow(/at least one seat/)
    await expect(engine.create({ gameId: definition.id, config: {}, seats: [seats[0], seats[0]] }))
      .rejects.toThrow(/unique/)
    await expect(engine.create({
      gameId: definition.id, config: {},
      seats: [seats[0], { ...seats[0], id: SeatId('human-2') }],
    })).rejects.toThrow(/at most one human/)
    expect(await persistence.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('supports completed-at-creation games, missing reads, and stable listing', async () => {
    const { ctx, engine } = await mounted()
    const complete: GameDefinition<null> = {
      id: 'complete', rulesVersion: 1, configSchema: {},
      validateConfig: () => null, action: () => ({ schema: {}, validate: () => null }),
      initial: () => [{ type: 'done', data: null }], reduce: () => null,
      pending: () => undefined, resolve: () => [], view: () => ({ done: true }), modelPrompt: () => '',
    }
    ctx.gameDefinitions.register(complete)
    const created = await engine.create({ gameId: complete.id, config: null, seats: [seats[0]] })
    expect(created.status).toBe('finished')
    expect(created).not.toHaveProperty('window')
    await expect(engine.get(MatchId('missing'))).resolves.toBeUndefined()
    const active = await engine.create({ gameId: definition.id, config: {}, seats })
    expect((await engine.list()).map(view => view.id)).toEqual([created.id, active.id].sort().reverse())
    await ctx.fiber.dispose()
  })

  it('rejects closed, unactionable, duplicate, abandoned, and unknown submissions', async () => {
    const { ctx, engine } = await mounted()
    const created = await engine.create({ gameId: definition.id, config: {}, seats })
    const windowId = created.window!.id
    await expect(engine.submit({
      matchId: MatchId('missing'), windowId, commandId: GameCommandId('missing'),
      seatId: seats[0].id, action: 'rock',
    })).rejects.toThrow(/unknown match/)
    await expect(engine.submit({
      matchId: created.id, windowId: ActionWindowId('other'), commandId: GameCommandId('closed'),
      seatId: seats[0].id, action: 'rock',
    })).rejects.toThrow(/window is closed/)
    await expect(engine.submit({
      matchId: created.id, windowId, commandId: GameCommandId('outsider'),
      seatId: SeatId('outsider'), action: 'rock',
    })).rejects.toThrow(/not actionable/)
    const ghostDefinition: GameDefinition<State> = {
      ...definition,
      id: 'ghost',
      pending: state => state.choices === undefined
        ? { key: 'choice', requiredSeats: [SeatId('ghost')], audience: 'public' }
        : undefined,
    }
    ctx.gameDefinitions.register(ghostDefinition)
    const ghost = await engine.create({ gameId: ghostDefinition.id, config: {}, seats })
    await expect(engine.submit({
      matchId: ghost.id, windowId: ghost.window!.id, commandId: GameCommandId('ghost'),
      seatId: SeatId('ghost'), action: 'rock',
    })).rejects.toThrow(/not part of the match/)
    await engine.submit({ matchId: created.id, windowId, commandId: GameCommandId('first'), seatId: seats[0].id, action: 'rock' })
    await expect(engine.submit({
      matchId: created.id, windowId, commandId: GameCommandId('duplicate'),
      seatId: seats[0].id, action: 'rock',
    })).rejects.toThrow(/already submitted/)
    await engine.abandon(created.id)
    await expect(engine.submit({
      matchId: created.id, windowId, commandId: GameCommandId('abandoned'),
      seatId: seats[1].id, action: 'paper',
    })).rejects.toThrow(/abandoned/)
    await ctx.fiber.dispose()
  })

  it('makes repeated abandon terminal operations idempotent', async () => {
    const { ctx, engine } = await mounted()
    const active = await engine.create({ gameId: definition.id, config: {}, seats })
    const abandoned = await engine.abandon(active.id)
    await expect(engine.abandon(active.id)).resolves.toEqual(abandoned)
    const complete: GameDefinition<null> = {
      id: 'complete-abandon', rulesVersion: 1, configSchema: {},
      validateConfig: () => null, action: () => ({ schema: {}, validate: () => null }),
      initial: () => [{ type: 'done', data: null }], reduce: () => null,
      pending: () => undefined, resolve: () => [], view: () => null, modelPrompt: () => '',
    }
    ctx.gameDefinitions.register(complete)
    const finished = await engine.create({ gameId: complete.id, config: null, seats: [seats[0]] })
    await expect(engine.abandon(finished.id)).resolves.toEqual(finished)
    await ctx.fiber.dispose()
  })

  it('covers the JSON remote API and validates AI seats before creation', async () => {
    const { ctx, engine } = await mounted()
    const availability = vi.fn<() => Promise<{ available: boolean; message?: string }>>(() => Promise.resolve({ available: true }))
    ctx.gameControllers.register('agent', { validate: async () => undefined, availability, drive: async () => undefined, cancel: async () => undefined })
    await expect(engine.remoteCreate({
      gameId: definition.id, config: {}, seats: [
        { id: 'bot', displayName: 'Bot', controller: { type: 'agent', provider: 'p', model: 'm' } },
      ],
    })).rejects.toThrow(
      `game '${definition.id}' create request has no rules version; reload the page before creating a match`,
    )
    expect(availability).not.toHaveBeenCalled()
    await expect(engine.remoteCreate({
      gameId: definition.id, expectedRulesVersion: definition.rulesVersion + 1, config: {}, seats: [
        { id: 'bot', displayName: 'Bot', controller: { type: 'agent', provider: 'p', model: 'm' } },
      ],
    })).rejects.toThrow(
      `game '${definition.id}' rules changed from version 2 to 1; reload the page before creating a match`,
    )
    expect(availability).not.toHaveBeenCalled()
    const created = await engine.remoteCreate({
      gameId: definition.id, expectedRulesVersion: definition.rulesVersion, config: {}, seats: [
        { id: 'human', displayName: 'Human', controller: { type: 'human' } },
        { id: 'bot', displayName: 'Bot', controller: { type: 'agent', provider: 'p', model: 'm' } },
      ],
    })
    expect(availability).toHaveBeenCalledOnce()
    await expect(engine.remoteProviderAvailability([{ provider: 'p', model: 'm' }])).resolves.toEqual([
      { provider: 'p', model: 'm', available: true },
    ])
    expect(engine.remoteCatalog()).toEqual([{
      id: definition.id, rulesVersion: definition.rulesVersion, configSchema: definition.configSchema,
    }])
    expect(await engine.remoteGet(created.id)).toEqual(await engine.get(MatchId(created.id), SeatId('human')))
    expect(await engine.remoteGet('missing')).toBeUndefined()
    expect(await engine.remoteList()).toEqual(await engine.list())
    await expect(engine.remoteSubmit({
      matchId: created.id, windowId: created.window!.id,
      commandId: 'human-command', action: 'rock',
    })).resolves.toMatchObject({ status: 'active' })
    const botsOnly = await engine.create({ gameId: definition.id, config: {}, seats: [seats[1]] })
    await expect(engine.remoteSubmit({
      matchId: botsOnly.id, windowId: botsOnly.window!.id,
      commandId: 'invalid-human-command', action: 'rock',
    })).rejects.toThrow(/no human-controlled seat/)
    await expect(engine.remoteCreate({
      gameId: definition.id, expectedRulesVersion: definition.rulesVersion, config: {}, seats: [
        { id: 'bot', displayName: 'Bot', controller: { type: 'agent', provider: 'p', model: 'm' } },
      ],
    })).resolves.toMatchObject({ status: 'active', window: { canAct: false } })
    await expect(engine.remoteAbandon(created.id)).resolves.toMatchObject({ status: 'abandoned' })
    availability.mockResolvedValueOnce({ available: false, message: 'LAN route unavailable' })
    await expect(engine.remoteCreate({
      gameId: definition.id, expectedRulesVersion: definition.rulesVersion, config: {}, seats: [
        { id: 'bot', displayName: 'Bot', controller: { type: 'agent', provider: 'lan', model: 'm' } },
      ],
    })).rejects.toThrow('LAN route unavailable')
    availability.mockResolvedValueOnce({ available: false })
    await expect(engine.remoteCreate({
      gameId: definition.id, expectedRulesVersion: definition.rulesVersion, config: {}, seats: [
        { id: 'bot', displayName: 'Bot', controller: { type: 'agent', provider: 'offline', model: 'm' } },
      ],
    })).rejects.toThrow("provider 'offline' is unavailable")
    await ctx.fiber.dispose()
  })

  it('opens the next action window when resolution leaves work pending', async () => {
    const { ctx, engine } = await mounted()
    const repeated: GameDefinition<number> = {
      id: 'repeated', rulesVersion: 1, configSchema: {},
      validateConfig: () => 0,
      initial: () => [{ type: 'counted', data: 0 }],
      reduce: (_state, event) => event.data as number,
      pending: count => count < 2 ? { key: 'choice', requiredSeats: [seats[0].id], audience: 'public' } : undefined,
      action: () => ({ schema: {}, validate: value => typeof value === 'string' ? value : null }),
      resolve: ({ state }) => [{ type: 'counted', data: state + 1 }],
      view: state => state, modelPrompt: () => 'Choose.',
    }
    ctx.gameDefinitions.register(repeated)
    const created = await engine.create({ gameId: repeated.id, config: {}, seats: [seats[0]] })
    const next = await engine.submit({
      matchId: created.id, windowId: created.window!.id, commandId: GameCommandId('next'),
      seatId: seats[0].id, action: 'rock',
    })
    expect(next.window?.id).not.toBe(created.window?.id)
    expect(next.status).toBe('active')
    await ctx.fiber.dispose()
  })

  it('persists controller failures as blocked seats until an explicit retry', async () => {
    const { ctx, engine } = await mounted()
    const drive = vi.fn(() => Promise.reject(new Error('provider offline')))
    ctx.gameControllers.register('agent', {
      validate: async () => undefined,
      drive,
      cancel: async () => undefined,
    })
    const created = await engine.create({ gameId: definition.id, config: {}, seats })
    const internals = engine as unknown as {
      controllerTasks: Set<Promise<void>>
      resumeControllers: (type?: string) => Promise<void>
    }
    await Promise.allSettled([...internals.controllerTasks])
    await expect(engine.get(created.id)).resolves.toMatchObject({
      status: 'blocked',
      blockedSeats: [{ seatId: seats[1].id, message: 'provider offline' }],
    })

    await internals.resumeControllers('agent')
    expect(drive).toHaveBeenCalledOnce()
    await expect(engine.retry(created.id, seats[0].id)).rejects.toThrow(/not blocked/)
    await expect(engine.remoteRetry(created.id)).resolves.toMatchObject({ status: 'active', blockedSeats: [] })
    await Promise.allSettled([...internals.controllerTasks])
    expect(drive).toHaveBeenCalledTimes(2)
    await expect(engine.get(created.id)).resolves.toMatchObject({ status: 'blocked' })
    await expect(engine.retry(created.id, seats[1].id)).resolves.toMatchObject({ status: 'active', blockedSeats: [] })
    await Promise.allSettled([...internals.controllerTasks])
    expect(drive).toHaveBeenCalledTimes(3)
    await engine.abandon(created.id)
    await expect(engine.retry(created.id, seats[1].id)).rejects.toThrow(/no active action window/)
    await expect(engine.remoteRetry(created.id)).rejects.toThrow(/no active action window/)
    await ctx.fiber.dispose()
  })

  it('rejects remote retry when no controller is blocked', async () => {
    const { ctx, engine } = await mounted()
    const created = await engine.create({ gameId: definition.id, config: {}, seats })
    await expect(engine.remoteRetry(created.id)).rejects.toThrow(/no blocked controller/)
    await ctx.fiber.dispose()
  })

  it('recovers persisted matches when definitions and controllers register', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const persistence = new MemoryGamePersistence()
    await ctx.plugin(GameDefinitions)
    await ctx.plugin(GameControllerRegistry)
    await ctx.plugin(inner => inner.provide('gamePersistence', persistence))
    await ctx.plugin(GameEngine)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const id = MatchId('recovery')
    await persistence.create({
      id, formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 1, config: {}, seats,
      createdAt: 1, events: [
        { seq: 0, time: 1, type: 'match/rule', data: { ruleType: 'started', ruleData: { seats: ['human', 'ai'] } } },
        { seq: 1, time: 1, type: 'match/action-opened', data: { windowId: 'recovery-window', key: 'choice', requiredSeats: ['human', 'ai'], audience: 'public' } },
      ],
    })
    await persistence.create({
      ...(await persistence.load(id))!, id: MatchId('recovery-drive'),
    })
    await persistence.create({
      ...(await persistence.load(id))!, id: MatchId('recovery-error'),
    })
    const incompatible: unknown = 'incompatible'
    const driveFailure: unknown = 'drive failed'
    const validate = vi.fn()
      .mockRejectedValueOnce(incompatible)
      .mockRejectedValueOnce(new Error('incompatible error'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('still incompatible'))
    ctx.gameControllers.register('agent', {
      validate,
      drive: () => rejected(driveFailure),
      cancel: async () => undefined,
    })
    await vi.runAllTimersAsync()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without recovery'))
    ctx.gameDefinitions.register(definition)
    await vi.runAllTimersAsync()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('without resuming seat'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("controller 'ai' failed"))
    await (ctx.matches as unknown as { resumeControllers: (type?: string) => Promise<void> }).resumeControllers('agent')
    await ctx.fiber.dispose()
  })

  it('registers the in-memory persistence provider', async () => {
    const ctx = new Context()
    applyMemoryPersistence(ctx)
    expect(ctx.gamePersistence).toBeInstanceOf(MemoryGamePersistence)
    await ctx.fiber.dispose()
  })

  it('reports Error and non-Error failures while persisting controller blocks', async () => {
    const { ctx, engine, persistence } = await mounted()
    const created = await engine.create({ gameId: definition.id, config: {}, seats })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const originalAppend = persistence.append.bind(persistence)
    const internals = engine as unknown as {
      controllerTasks: Set<Promise<void>>
      trackController: (matchId: MatchId, task: Promise<void>, seatId: SeatId, windowId: ActionWindowId) => void
    }
    persistence.append = () => Promise.reject(new Error('append error'))
    internals.trackController(created.id, Promise.reject(new Error('controller error')), seats[1].id, created.window!.id)
    await Promise.allSettled([...internals.controllerTasks])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('append error'))

    const appendFailure: unknown = 'append string'
    persistence.append = () => rejected(appendFailure)
    const controllerFailure: unknown = 'controller string'
    internals.trackController(created.id, rejected(controllerFailure), seats[1].id, created.window!.id)
    await Promise.allSettled([...internals.controllerTasks])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('append string'))
    persistence.append = originalAppend
    await ctx.fiber.dispose()
  })

  it('filters targeted recovery and isolates teardown races', async () => {
    vi.useFakeTimers()
    const { ctx, engine, persistence } = await mounted()
    const id = MatchId('recovery-filters')
    await persistence.create({
      id, formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 1, config: {}, seats,
      createdAt: 1, events: [
        { seq: 0, time: 1, type: 'match/rule', data: { ruleType: 'started', ruleData: { seats: ['human', 'ai'] } } },
        { seq: 1, time: 1, type: 'unknown' as MatchEvent['type'], data: {} },
      ],
    })
    expect((await engine.get(id))?.status).toBe('active')
    const internals = engine as unknown as {
      recoveryDisposed: boolean
      resumeControllers: (type?: string, gameId?: string) => Promise<void>
      trackController: (matchId: MatchId, task: Promise<void>, seatId: SeatId, windowId: ActionWindowId) => void
      deferRecovery: (label: string, recover: () => Promise<void>) => void
    }
    await internals.resumeControllers(undefined, 'other')
    await internals.resumeControllers('other')
    const originalLoad = persistence.load.bind(persistence)
    persistence.load = () => rejected('load failed')
    await internals.resumeControllers()
    persistence.load = originalLoad
    internals.deferRecovery('failed matches', () => Promise.reject(new Error('recovery failed')))
    const recoveryFailure: unknown = 'string recovery failure'
    internals.deferRecovery('string failure', () => rejected(recoveryFailure))
    await vi.runAllTimersAsync()
    internals.trackController(id, Promise.reject(new Error('late error')), seats[1].id, ActionWindowId('late-error-window'))
    await Promise.resolve()
    internals.deferRecovery('disposed timer', async () => undefined)
    internals.recoveryDisposed = true
    await vi.runAllTimersAsync()
    const lateFailure: unknown = 'late failure'
    internals.trackController(id, rejected(lateFailure), seats[1].id, ActionWindowId('late-window'))
    await Promise.resolve()
    internals.deferRecovery('disposed recovery', async () => undefined)
    await ctx.fiber.dispose()
  })

  it('rejects every malformed durable event field at the persistence boundary', async () => {
    const { ctx, engine, persistence } = await mounted()
    const cases: Array<[string, MatchEvent, RegExp]> = [
      ['scalar', { seq: 0, time: 1, type: 'match/rule', data: null }, /event data/],
      ['rule-type', { seq: 0, time: 1, type: 'match/rule', data: { ruleType: '', ruleData: null } }, /ruleType/],
      ['required', { seq: 1, time: 1, type: 'match/action-opened', data: { windowId: 'w', key: 'k', requiredSeats: null, audience: 'public' } }, /requiredSeats/],
      ['audience', { seq: 1, time: 1, type: 'match/action-opened', data: { windowId: 'w', key: 'k', requiredSeats: [], audience: 'all' } }, /audience/],
      ['window-id', { seq: 1, time: 1, type: 'match/action-opened', data: { windowId: '', key: 'k', requiredSeats: [], audience: 'public' } }, /windowId/],
      ['key', { seq: 1, time: 1, type: 'match/action-opened', data: { windowId: 'w', key: '', requiredSeats: [], audience: 'public' } }, /key/],
      ['required-seat', { seq: 1, time: 1, type: 'match/action-opened', data: { windowId: 'w', key: 'k', requiredSeats: [''], audience: 'public' } }, /requiredSeats/],
      ['seat', { seq: 2, time: 1, type: 'match/action-submitted', data: { windowId: 'w', seatId: '', commandId: 'c' } }, /seatId/],
      ['command', { seq: 2, time: 1, type: 'match/action-submitted', data: { windowId: 'w', seatId: 's', commandId: '', input: null, action: null } }, /commandId/],
      ['input', { seq: 2, time: 1, type: 'match/action-submitted', data: { windowId: 'w', seatId: 's', commandId: 'c', action: null } }, /input/],
      ['blocked-window', { seq: 2, time: 1, type: 'match/controller-blocked', data: { windowId: 'other', seatId: 's', message: 'error' } }, /controller failure window/],
      ['retried-window', { seq: 2, time: 1, type: 'match/controller-retried', data: { windowId: 'other', seatId: 's' } }, /controller retry window/],
    ]
    const started: MatchEvent = {
      seq: 0, time: 1, type: 'match/rule',
      data: { ruleType: 'started', ruleData: { seats: ['human', 'ai'] } },
    }
    for (const [id, event, error] of cases) {
      const opened: MatchEvent = {
        seq: 1, time: 1, type: 'match/action-opened',
        data: { windowId: 'w', key: 'choice', requiredSeats: ['human', 'ai'], audience: 'public' },
      }
      const events = event.seq === 0 ? [event] : event.seq === 1 ? [started, event] : [started, opened, event]
      await persistence.create({
        id: MatchId(id), formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 1,
        config: {}, seats, createdAt: 1, events,
      })
      await expect(engine.get(MatchId(id))).rejects.toThrow(error)
    }
    const noStart = MatchId('no-start')
    await persistence.create({
      id: noStart, formatVersion: MATCH_FORMAT_VERSION, gameId: definition.id, rulesVersion: 1,
      config: {}, seats, createdAt: 1,
      events: [{ seq: 0, time: 1, type: 'match/abandoned', data: {} }],
    })
    await expect(engine.get(noStart)).rejects.toThrow(/no initial rule event/)
    await ctx.fiber.dispose()
  })
})
