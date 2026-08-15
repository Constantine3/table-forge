// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameRemoteMatchView } from '@deepseek-ai/dsh-game/types'
import type { GameAppInjected } from '../src/client/GameApp.tsx'
import { apply, GameAppController } from '../src/client/index.ts'

const match: GameRemoteMatchView = {
  id: 'match-1', gameId: 'rps', revision: 2, status: 'active',
  seats: [
    { id: 'human', displayName: 'You', controller: { type: 'human' } },
    { id: 'agent', displayName: 'Agent', controller: { type: 'agent', provider: 'local', model: 'model' } },
  ],
  window: {
    id: 'window-1', requiredSeats: ['human'], submittedSeats: [], canAct: true,
    actionSchema: { type: 'object', properties: { gesture: { enum: ['rock', 'paper', 'scissors'] } } },
  },
  blockedSeats: [],
  game: { roundCount: 1, rounds: [], scores: { human: 0, agent: 0 }, winner: null },
}

const ok = <T>(value: T) => ({ ok: true as const, value })

// Remote and plugin promises can carry unknown JavaScript rejection values.
// oxlint-disable-next-line typescript/prefer-promise-reject-errors
const rejected = <T = never>(cause: unknown): Promise<T> => new Promise((_resolve, reject) => { reject(cause) })

function controller(overrides: Record<string, unknown> = {}, models: () => Promise<unknown> = vi.fn(() => Promise.resolve({
  result: ok({ groups: [{ id: 'local', name: 'Local', models: [{ id: 'model' }] }] }),
}))) {
  const matches = {
    get: vi.fn<() => Promise<ReturnType<typeof ok<GameRemoteMatchView | undefined>>>>(() => Promise.resolve(ok(match))),
    create: vi.fn(() => Promise.resolve(ok(match))),
    submit: vi.fn(() => Promise.resolve(ok(match))),
    abandon: vi.fn(() => Promise.resolve(ok({ ...match, status: 'abandoned' as const }))),
    retry: vi.fn(() => Promise.resolve(ok(match))),
    list: vi.fn(() => Promise.resolve(ok([match]))),
    providerAvailability: vi.fn((candidates: readonly { provider: string; model: string }[]) => Promise.resolve(ok(
      candidates.map(candidate => ({ ...candidate, available: true })),
    ))),
    catalog: vi.fn(() => Promise.resolve(ok([]))),
    ...overrides,
  }
  const history = vi.fn((
    _request: { sessionId: string; beforeSeq?: number; maxMessages?: number },
  ) => Promise.resolve({ result: ok({ events: [
    { event: { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } } },
    { event: {
      type: 'user/message', seq: 1, time: 11,
      data: { source: { kind: 'game', actionSchema: { properties: { choice: { enum: ['paper'] } } } } },
    } },
    { event: { type: 'assistant/message', seq: 2, time: 12, data: { turn: 1, message: { content: [
      { type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'public action' }, { type: 'tool-call' },
    ] } } } },
    { event: {
      type: 'tool/call', seq: 3, time: 13,
      data: { turn: 1, callId: 'call-1', name: 'submit_game_action', arguments: '{"action":{"choice":"paper"}}' },
    } },
    { event: {
      type: 'tool/result', seq: 4, time: 14,
      data: { message: { source: { kind: 'tool', callId: 'call-1' } } },
    } },
  ], hasMore: false }) }))
  const connection = { api: { llm: { models }, sessions: { history } } }
  return { controller: new GameAppController({ matches } as never, connection as never), matches, models, history }
}

beforeEach(() => { localStorage.clear() })

describe('generic game controller', () => {
  it('restores durable selection without reading any AI session', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const bench = controller()
    await bench.controller.restore()
    expect(bench.matches.get).toHaveBeenCalledWith(match.id)
    expect(bench.controller.store.getSnapshot()).toMatchObject({ match, selectedGameId: 'rps', audit: undefined })
    expect(bench.history).not.toHaveBeenCalled()
  })

  it('drops unavailable selection and leaves an empty browser alone', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const unavailable = controller({ get: vi.fn(() => Promise.resolve(ok(undefined))) })
    await unavailable.controller.restore()
    expect(localStorage.getItem('table-forge.active-match')).toBeNull()
    expect(unavailable.controller.store.getSnapshot().match).toBeUndefined()
    await unavailable.controller.restore()
    expect(unavailable.matches.get).toHaveBeenCalledOnce()
  })

  it('loads provider availability, game metadata, and durable tables', async () => {
    const games = [{ id: 'rps', configSchema: { type: 'object' } }, { id: 'avalon', configSchema: { type: 'object' } }]
    const bench = controller({ catalog: vi.fn(() => Promise.resolve(ok(games))) })
    await bench.controller.loadProviders()
    await bench.controller.loadGames()
    await bench.controller.loadMatches()
    expect(bench.controller.store.getSnapshot()).toMatchObject({
      providers: [{ id: 'local', name: 'Local', model: 'model', available: true }], games, matches: [match],
    })
  })

  it('reports model discovery failures and omits groups without a model', async () => {
    const failed = controller({}, vi.fn(() => Promise.resolve({
      result: { ok: false as const, error: { message: 'model discovery failed' } },
    })))
    await failed.controller.loadProviders()
    expect(failed.controller.store.getSnapshot().error).toBe('model discovery failed')

    const empty = controller({}, vi.fn(() => Promise.resolve({
      result: ok({ groups: [{ id: 'empty', name: 'Empty', models: [] }] }),
    })))
    await empty.controller.loadProviders()
    expect(empty.matches.providerAvailability).toHaveBeenCalledWith([])
    expect(empty.controller.store.getSnapshot().providers).toEqual([])
  })

  it('retains provider route diagnostics and marks unmatched routes unavailable', async () => {
    const unavailable = controller({
      providerAvailability: vi.fn(() => Promise.resolve(ok([
        { provider: 'local', model: 'model', available: false, message: 'host cannot reach route' },
      ]))),
    })
    await unavailable.controller.loadProviders()
    expect(unavailable.controller.store.getSnapshot().providers).toEqual([{
      id: 'local', name: 'Local', model: 'model', available: false, message: 'host cannot reach route',
    }])

    const unmatched = controller({ providerAvailability: vi.fn(() => Promise.resolve(ok([]))) })
    await unmatched.controller.loadProviders()
    expect(unmatched.controller.store.getSnapshot().providers[0]).toMatchObject({ available: false })
  })

  it('creates, opens, submits, retries all blocked seats, and resets matches', async () => {
    const bench = controller()
    bench.controller.select('rps')
    await bench.controller.create({ gameId: 'rps', config: { roundCount: 1 }, seats: match.seats })
    expect(localStorage.getItem('table-forge.active-match')).toBe(match.id)
    await bench.controller.submit({ matchId: match.id, windowId: 'window-1', commandId: 'command', action: { gesture: 'rock' } })
    await bench.controller.retry()
    expect(bench.matches.retry).toHaveBeenCalledWith(match.id)
    await bench.controller.reset()
    expect(bench.matches.abandon).toHaveBeenCalledWith(match.id)
    expect(bench.controller.store.getSnapshot().match).toBeUndefined()
    await bench.controller.open(match.id)
    expect(bench.controller.store.getSnapshot().selectedGameId).toBe('rps')
  })

  it('guards selection and match operations when their prerequisites are absent', async () => {
    const bench = controller({ get: vi.fn(() => Promise.resolve(ok(undefined))) })
    bench.controller.store.update((state) => { state.match = match; state.selectedGameId = 'rps' })
    bench.controller.select('avalon')
    expect(bench.controller.store.getSnapshot().selectedGameId).toBe('rps')

    bench.controller.store.update((state) => { state.match = undefined })
    await bench.controller.retry()
    expect(bench.matches.retry).not.toHaveBeenCalled()
    await bench.controller.open('missing')
    expect(bench.controller.store.getSnapshot().error).toContain("Match 'missing' is unavailable")
  })

  it('abandons a blocked match but only clears a normally finished match locally', async () => {
    const blocked = controller()
    blocked.controller.store.update((state) => { state.match = { ...match, status: 'blocked' } })
    await blocked.controller.reset()
    expect(blocked.matches.abandon).toHaveBeenCalledWith(match.id)

    const finished = controller()
    finished.controller.store.update((state) => { state.match = { ...match, status: 'finished' } })
    await finished.controller.reset()
    expect(finished.matches.abandon).not.toHaveBeenCalled()
  })

  it('does not load AI sessions until a normally finished match is explicitly audited', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const finished: GameRemoteMatchView = {
      id: match.id, gameId: match.gameId, revision: 3, status: 'finished', seats: match.seats,
      blockedSeats: match.blockedSeats, game: match.game,
    }
    const bench = controller({ get: vi.fn(() => Promise.resolve(ok(match))) })
    await bench.controller.restore()
    bench.matches.get.mockResolvedValueOnce(ok(finished))
    await bench.controller.refresh(match.id)
    expect(bench.history).not.toHaveBeenCalled()
    await bench.controller.loadAudit()
    expect(bench.history).toHaveBeenCalledWith({ sessionId: 'game:match-1:agent', maxMessages: 100 })
    expect(bench.controller.store.getSnapshot().audit).toEqual({ entries: [
      {
        seatId: 'agent', actionType: 'choice', time: 12, turn: 1, eventSeq: 2,
        kind: 'reasoning', text: 'private reasoning',
      },
      {
        seatId: 'agent', actionType: 'choice', time: 12, turn: 1, eventSeq: 2,
        kind: 'answer', text: 'public action',
      },
      {
        seatId: 'agent', actionType: 'choice', time: 13, turn: 1, eventSeq: 3,
        kind: 'action', action: { choice: 'paper' }, accepted: true,
      },
    ], unavailableSeatIds: [] })
  })

  it('loads every history page and retains assassination reasoning, target, and failed action outcomes', async () => {
    const finished = { ...match, status: 'finished' as const }
    const bench = controller()
    bench.controller.store.update((state) => { state.match = finished })
    bench.history
      .mockResolvedValueOnce({ result: ok({ events: [
        { event: {
          type: 'assistant/message', seq: 10, time: 30,
          data: { turn: 8, message: { content: [{ type: 'text', text: '我决定刺杀这个目标。' }] } },
        } },
        { event: {
          type: 'tool/call', seq: 11, time: 31,
          data: {
            turn: 8, callId: 'assassination', name: 'submit_game_action',
            arguments: '{"action":{"type":"assassinate","target":"human"}}',
          },
        } },
        { event: {
          type: 'tool/result', seq: 12, time: 32,
          data: { message: { source: { kind: 'tool', callId: 'assassination' } }, error: { code: 'rejected' } },
        } },
      ], hasMore: true }) })
      .mockResolvedValueOnce({ result: ok({ events: [
        { event: { type: 'turn/start', seq: 0, time: 20, data: { turn: 8 } } },
        { event: {
          type: 'user/message', seq: 1, time: 21,
          data: { source: {
            kind: 'game', actionSchema: { properties: { type: { const: 'assassinate' } } },
          } },
        } },
        { event: {
          type: 'assistant/message', seq: 2, time: 22,
          data: { turn: 8, message: { content: [{ type: 'reasoning', text: '我正在排查梅林。' }] } },
        } },
      ], hasMore: false }) } as never)

    await bench.controller.loadAudit()

    expect(bench.history).toHaveBeenNthCalledWith(2, {
      sessionId: 'game:match-1:agent', beforeSeq: 10, maxMessages: 100,
    })
    expect(bench.controller.store.getSnapshot().audit).toEqual({ entries: [
      {
        seatId: 'agent', actionType: 'assassinate', time: 22, turn: 8, eventSeq: 2,
        kind: 'reasoning', text: '我正在排查梅林。',
      },
      {
        seatId: 'agent', actionType: 'assassinate', time: 30, turn: 8, eventSeq: 10,
        kind: 'answer', text: '我决定刺杀这个目标。',
      },
      {
        seatId: 'agent', actionType: 'assassinate', time: 31, turn: 8, eventSeq: 11,
        kind: 'action', action: { type: 'assassinate', target: 'human' }, accepted: false,
      },
    ], unavailableSeatIds: [] })
  })

  it('removes an anonymous vote choice from its reasoning, answer, and stored audit action', async () => {
    const finished = { ...match, status: 'finished' as const }
    const bench = controller()
    bench.controller.store.update((state) => { state.match = finished })
    bench.history.mockResolvedValueOnce({ result: ok({ events: [
      { event: { type: 'turn/start', seq: 0, time: 40, data: { turn: 2 } } },
      { event: {
        type: 'user/message', seq: 1, time: 41,
        data: { source: { kind: 'game', actionSchema: {
          properties: { type: { const: 'vote-team' }, approve: { type: 'boolean' } },
        } } },
      } },
      { event: {
        type: 'assistant/message', seq: 2, time: 42,
        data: { turn: 2, message: { content: [
          { type: 'reasoning', text: '我准备投赞成票。' },
          { type: 'text', text: '我最终选择赞成。' },
        ] } },
      } },
      { event: {
        type: 'tool/call', seq: 3, time: 43,
        data: {
          turn: 2, callId: 'vote', name: 'submit_game_action',
          arguments: '{"action":{"type":"vote-team","approve":true}}',
        },
      } },
    ], hasMore: false }) } as never)

    await bench.controller.loadAudit()

    expect(bench.controller.store.getSnapshot().audit).toEqual({ entries: [
      {
        seatId: 'agent', actionType: 'vote-team', time: 42, turn: 2, eventSeq: 2,
        kind: 'reasoning', text: '匿名队伍投票的分析已隐藏。',
      },
      {
        seatId: 'agent', actionType: 'vote-team', time: 42, turn: 2, eventSeq: 2,
        kind: 'answer', text: '匿名队伍投票的自然语言输出已隐藏。',
      },
      {
        seatId: 'agent', actionType: 'vote-team', time: 43, turn: 2, eventSeq: 3,
        kind: 'action', action: { type: 'vote-team' }, accepted: undefined,
      },
    ], unavailableSeatIds: [] })
  })

  it('sorts simultaneous seat histories by match seat order and keeps an unpaired action auditable', async () => {
    const secondAgent = {
      id: 'agent-2', displayName: 'Agent 2',
      controller: { type: 'agent' as const, provider: 'local', model: 'model' },
    }
    const finished = { ...match, status: 'finished' as const, seats: [...match.seats, secondAgent] }
    const bench = controller()
    bench.controller.store.update((state) => { state.match = finished })
    bench.history.mockImplementation((request: { sessionId: string }) => Promise.resolve({ result: ok({ events: [{ event: {
      type: 'tool/call', seq: 3, time: 50,
      data: {
        turn: 2, callId: request.sessionId, name: 'submit_game_action',
        arguments: request.sessionId.endsWith('agent-2')
          ? '{"action":{"type":"vote-team","approve":true}}'
          : '{"action":{"custom":true}}',
      },
    } }], hasMore: false }) }))

    await bench.controller.loadAudit()

    expect(bench.controller.store.getSnapshot().audit?.entries).toEqual([
      {
        seatId: 'agent', actionType: undefined, time: 50, turn: 2, eventSeq: 3,
        kind: 'action', action: { custom: true }, accepted: undefined,
      },
      {
        seatId: 'agent-2', actionType: 'vote-team', time: 50, turn: 2, eventSeq: 3,
        kind: 'action', action: { type: 'vote-team' }, accepted: undefined,
      },
    ])
  })

  it('rejects active and abandoned audit requests without touching session history', async () => {
    const active = controller()
    active.controller.store.update((state) => { state.match = match })
    await active.controller.loadAudit()
    expect(active.controller.store.getSnapshot().error).toMatch(/only after a finished match/)
    expect(active.history).not.toHaveBeenCalled()

    const abandoned = controller()
    abandoned.controller.store.update((state) => { state.match = { ...match, status: 'abandoned' } })
    await abandoned.controller.loadAudit()
    expect(abandoned.controller.store.getSnapshot().error).toMatch(/only after a finished match/)
    expect(abandoned.history).not.toHaveBeenCalled()
  })

  it('reports unavailable sessions and ignores unrelated or malformed audit events', async () => {
    const finished = { ...match, status: 'finished' as const }
    const unavailable = controller()
    unavailable.controller.store.update((state) => { state.match = finished })
    unavailable.history.mockResolvedValueOnce({
      result: { ok: false as const, error: { message: 'session unavailable' } },
    } as never)
    await unavailable.controller.loadAudit()
    expect(unavailable.controller.store.getSnapshot().audit).toEqual({ entries: [], unavailableSeatIds: ['agent'] })

    const filtered = controller()
    filtered.controller.store.update((state) => { state.match = finished })
    filtered.history.mockResolvedValueOnce({ result: ok({ events: [
      { event: { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } },
      { event: { type: 'user/message', seq: 1, time: 2, data: { source: { kind: 'user' } } } },
      { event: {
        type: 'user/message', seq: 2, time: 2,
        data: { source: { kind: 'game', actionSchema: {} } },
      } },
      { event: { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, name: 'other', arguments: '{}' } } },
      { event: {
        type: 'tool/call', seq: 4, time: 4,
        data: { turn: 1, name: 'submit_game_action', arguments: 'not-json' },
      } },
      { event: {
        type: 'tool/call', seq: 5, time: 5,
        data: { turn: 1, name: 'submit_game_action', arguments: '{}' },
      } },
      { event: {
        type: 'assistant/message', seq: 6, time: 6,
        data: { turn: 1, message: { content: [{ type: 'tool-call' }] } },
      } },
    ], hasMore: false }) } as never)
    await filtered.controller.loadAudit()
    expect(filtered.controller.store.getSnapshot().audit).toEqual({ entries: [], unavailableSeatIds: [] })

    const emptyPage = controller()
    emptyPage.controller.store.update((state) => { state.match = finished })
    emptyPage.history.mockResolvedValueOnce({ result: ok({ events: [], hasMore: true }) })
    await emptyPage.controller.loadAudit()
    expect(emptyPage.controller.store.getSnapshot().audit).toEqual({ entries: [], unavailableSeatIds: ['agent'] })

    for (const olderResult of [
      { ok: false as const, error: { message: 'older page unavailable' } },
      ok({ events: [], hasMore: false }),
    ]) {
      const brokenPage = controller()
      brokenPage.controller.store.update((state) => { state.match = finished })
      brokenPage.history
        .mockResolvedValueOnce({ result: ok({ events: [
          { event: { type: 'turn/start', seq: 10, time: 1, data: { turn: 1 } } },
        ], hasMore: true }) })
        .mockResolvedValueOnce({ result: olderResult } as never)
      await brokenPage.controller.loadAudit()
      expect(brokenPage.controller.store.getSnapshot().audit).toEqual({ entries: [], unavailableSeatIds: ['agent'] })
    }
  })

  it('rejects failed match responses at direct loading entry points', async () => {
    const bench = controller({
      list: vi.fn(() => Promise.resolve({ ok: false as const, error: { message: 'list failed' } })),
    })
    await expect(bench.controller.loadMatches()).rejects.toThrow('list failed')
  })

  it('keeps the newest selected revision and normalizes remote failures', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const bench = controller()
    await bench.controller.restore()
    bench.matches.get.mockResolvedValueOnce(ok({ ...match, revision: 1 }))
    await bench.controller.refresh(match.id)
    expect(bench.controller.store.getSnapshot().match?.revision).toBe(2)
    await bench.controller.refresh('another-match')
    expect(bench.matches.get).toHaveBeenCalledTimes(2)

    const failure = controller({ submit: vi.fn(() => rejected('offline')) })
    await failure.controller.submit({ matchId: match.id, windowId: 'w', commandId: 'c', action: {} })
    expect(failure.controller.store.getSnapshot()).toMatchObject({ error: 'offline', busy: false })
  })

  it('registers the root slots and refreshes the active match on invalidation', async () => {
    let changed: ((id: string) => void) | undefined
    const register = vi.fn((_registration: unknown) => () => undefined)
    const remoteMatches = {
      catalog: vi.fn(() => Promise.resolve(ok([{ id: 'rps', configSchema: {} }]))),
      list: vi.fn(() => Promise.resolve(ok([]))),
      providerAvailability: vi.fn(() => Promise.resolve(ok([]))),
      get: vi.fn(() => Promise.resolve(ok({ ...match, revision: 3 }))),
      create: vi.fn(() => Promise.resolve(ok(match))), submit: vi.fn(() => Promise.resolve(ok(match))),
      abandon: vi.fn(() => Promise.resolve(ok(match))), retry: vi.fn(() => Promise.resolve(ok(match))),
    }
    const ctx = {
      remote: {
        matches: remoteMatches,
        $on: vi.fn((_event: string, listener: (id: string) => void) => { changed = listener; return () => undefined }),
      },
      connection: { api: {
        llm: { models: vi.fn(() => Promise.resolve({ result: ok({ groups: [] }) })) },
        sessions: { history: vi.fn() },
      } },
      slots: { register },
      effect: (install: () => () => void) => { install() },
    }
    localStorage.setItem('table-forge.active-match', match.id)
    apply(ctx as never)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledOnce() })
    const registration = register.mock.calls[0]![0] as {
      children: Record<string, { kind: string; scope: string }>
      inject: () => GameAppInjected
    }
    expect(registration.children).toEqual({
      'game.catalog.item': { kind: 'list', scope: 'root' },
      'game.surface': { kind: 'keyed', scope: 'root' },
    })
    const injected = registration.inject()
    await vi.waitFor(() => { expect(injected.hooks.game.getSnapshot().match?.revision).toBe(3) })
    changed?.(match.id)
    await vi.waitFor(() => { expect(remoteMatches.get).toHaveBeenCalledTimes(2) })

    injected.selectGame('avalon')
    await injected.createMatch({ gameId: 'rps', config: {}, seats: match.seats })
    await injected.submitAction({ matchId: match.id, windowId: 'w', commandId: 'c', action: {} })
    await injected.retryBlocked()
    await injected.resetMatch()
    await injected.openMatch(match.id)
    await injected.loadAudit()
  })

  it('reports asynchronous plugin startup and invalidation failures', async () => {
    let changed: ((id: string) => void) | undefined
    let registration: { inject: () => GameAppInjected } | undefined
    const ctx = {
      remote: {
        matches: {
          catalog: vi.fn(() => Promise.resolve(ok([]))),
          list: vi.fn(() => Promise.resolve(ok([]))),
          providerAvailability: vi.fn(() => Promise.resolve(ok([]))),
          get: vi.fn()
            .mockResolvedValueOnce(ok(match))
            .mockImplementation(() => rejected('refresh failed')),
        },
        $on: vi.fn((_event: string, listener: (id: string) => void) => { changed = listener; return () => undefined }),
      },
      connection: { api: {
        llm: { models: vi.fn(() => rejected(new Error('models failed'))) },
        sessions: { history: vi.fn() },
      } },
      slots: { register: vi.fn((value: { inject: () => GameAppInjected }) => { registration = value; return () => undefined }) },
      effect: (install: () => () => void) => { install() },
    }
    localStorage.setItem('table-forge.active-match', match.id)
    apply(ctx as never)
    await vi.waitFor(() => { expect(registration?.inject().hooks.game.getSnapshot().error).toBe('models failed') })
    registration!.inject().hooks.game.update((state) => { state.match = match })
    changed?.(match.id)
    await vi.waitFor(() => { expect(registration?.inject().hooks.game.getSnapshot().error).toBe('refresh failed') })
  })
})
