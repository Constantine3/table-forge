// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameRemoteMatchView } from '@deepseek-ai/dsh-game/types'
import type { GameAppInjected } from '../src/client/GameApp.tsx'
import { apply, GameAppController } from '../src/client/index.ts'

const match: GameRemoteMatchView = {
  id: 'match-1', gameId: 'rps', revision: 2, status: 'active',
  seats: [{ id: 'human', displayName: 'You', controller: { type: 'human' } }],
  window: { id: 'window-1', requiredSeats: ['human'], submittedSeats: [] },
  blockedSeats: [],
  game: { roundCount: 1, rounds: [], scores: { human: 0 }, winner: null },
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
  const connection = {
    api: {
      llm: { models },
      sessions: { history: vi.fn(() => Promise.resolve({ result: ok({ events: [], hasMore: false }) })) },
    },
  }
  return { controller: new GameAppController({ matches } as never, connection as never), matches, models }
}

beforeEach(() => { localStorage.clear() })

describe('game table selection', () => {
  it('restores the selected durable match after a browser reload', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const bench = controller()
    await bench.controller.restore()
    expect(bench.matches.get).toHaveBeenCalledWith(match.id)
    expect(bench.controller.store.getSnapshot().match).toEqual(match)
  })

  it('drops a selection whose durable match is unavailable', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const bench = controller({ get: vi.fn(() => Promise.resolve(ok(undefined))) })
    await bench.controller.restore()
    expect(localStorage.getItem('table-forge.active-match')).toBeNull()
    expect(bench.controller.store.getSnapshot().match).toBeUndefined()
  })

  it('does nothing when this browser has no selected table', async () => {
    const bench = controller()
    await bench.controller.restore()
    expect(bench.matches.get).not.toHaveBeenCalled()
  })

  it('records a created match and abandons it before clearing the browser selection', async () => {
    const bench = controller()
    await bench.controller.create({ gameId: 'rps', config: { roundCount: 1 }, seats: [] })
    expect(localStorage.getItem('table-forge.active-match')).toBe(match.id)
    expect(bench.controller.store.getSnapshot().match).toEqual(match)
    await bench.controller.reset()
    expect(bench.matches.abandon).toHaveBeenCalledWith(match.id)
    expect(localStorage.getItem('table-forge.active-match')).toBeNull()
    expect(bench.controller.store.getSnapshot().match).toBeUndefined()
  })

  it('loads provider routes and deployment game limits', async () => {
    const bench = controller({ catalog: vi.fn(() => Promise.resolve(ok([{
      id: 'rps', configSchema: { properties: { roundCount: { default: 3, maximum: 99 } } },
    }]))) })
    await bench.controller.loadProviders()
    await bench.controller.loadGames()
    expect(bench.controller.store.getSnapshot()).toMatchObject({
      providers: [{ id: 'local', name: 'Local', model: 'model', available: true }],
      rpsSetup: { defaultRounds: 3, maxRounds: 99 },
    })
  })

  it('omits provider groups without a configured model', async () => {
    const models = vi.fn(() => Promise.resolve({
      result: ok({ groups: [{ id: 'empty', name: 'Empty', models: [] }] }),
    }))
    const bench = controller({}, models)
    await bench.controller.loadProviders()
    expect(bench.controller.store.getSnapshot().providers).toEqual([])
  })

  it('reports provider errors and rejects incomplete setup schemas', async () => {
    const failedModels = vi.fn(() => Promise.resolve({ result: { ok: false as const, error: { message: 'models failed' } } }))
    const bench = controller({ catalog: vi.fn(() => Promise.resolve(ok([]))) }, failedModels)
    await bench.controller.loadProviders()
    expect(bench.controller.store.getSnapshot().error).toBe('models failed')
    await expect(bench.controller.loadGames()).rejects.toThrow(/schema is unavailable/)
  })

  it('submits actions, skips terminal abandonment, and captures remote failures', async () => {
    const bench = controller()
    await bench.controller.submit({ matchId: match.id, windowId: 'window-1', commandId: 'c', action: {} })
    expect(bench.matches.submit).toHaveBeenCalledOnce()
    expect(bench.controller.store.getSnapshot().busy).toBe(false)
    const terminal = { ...match, status: 'finished' as const }
    const terminalBench = controller({ get: vi.fn(() => Promise.resolve(ok(terminal))) })
    localStorage.setItem('table-forge.active-match', terminal.id)
    await terminalBench.controller.restore()
    await terminalBench.controller.reset()
    expect(terminalBench.matches.abandon).not.toHaveBeenCalled()
    const failed = controller({ create: vi.fn(() => Promise.resolve({ ok: false, error: { message: 'create failed' } })) })
    await failed.controller.create({ gameId: 'rps', config: {}, seats: [] })
    expect(failed.controller.store.getSnapshot().error).toBe('create failed')
    const thrown = controller({ submit: vi.fn(() => Promise.reject(new Error('offline'))) })
    await thrown.controller.submit({ matchId: match.id, windowId: 'w', commandId: 'c', action: {} })
    expect(thrown.controller.store.getSnapshot().error).toBe('offline')
    const unknownFailure = controller({ submit: vi.fn(() => rejected('unknown offline')) })
    await unknownFailure.controller.submit({ matchId: match.id, windowId: 'w', commandId: 'c', action: {} })
    expect(unknownFailure.controller.store.getSnapshot().error).toBe('unknown offline')
  })

  it('refreshes only the selected match with a current revision', async () => {
    localStorage.setItem('table-forge.active-match', match.id)
    const newer = { ...match, revision: 3 }
    const bench = controller({ get: vi.fn(() => Promise.resolve(ok(match))) })
    await bench.controller.restore()
    await bench.controller.refresh('other')
    expect(bench.matches.get).toHaveBeenCalledOnce()
    bench.matches.get.mockResolvedValueOnce(ok({ ...match, revision: 1 }))
    await bench.controller.refresh(match.id)
    expect(bench.controller.store.getSnapshot().match?.revision).toBe(2)
    bench.matches.get.mockResolvedValueOnce(ok(newer))
    await bench.controller.refresh(match.id)
    expect(bench.controller.store.getSnapshot().match?.revision).toBe(3)
    bench.matches.get.mockResolvedValueOnce(ok(undefined))
    await bench.controller.refresh(match.id)
    expect(bench.controller.store.getSnapshot().match?.revision).toBe(3)
  })

  it('registers root rendering and match invalidation effects', async () => {
    let changed: ((id: string) => void) | undefined
    const disposers: Array<() => void> = []
    const register = vi.fn((_registration: unknown) => () => undefined)
    const ctx = {
      remote: {
        matches: {
          catalog: vi.fn(() => Promise.resolve(ok([{ id: 'rps', configSchema: { properties: { roundCount: { default: 3, maximum: 9 } } } }]))),
          get: vi.fn(() => Promise.resolve(ok(undefined))),
          create: vi.fn(() => Promise.resolve(ok(match))),
          submit: vi.fn(() => Promise.resolve(ok(match))),
          abandon: vi.fn(() => Promise.resolve(ok(match))),
        },
        $on: vi.fn((_event: string, listener: (id: string) => void) => { changed = listener; return () => undefined }),
      },
      connection: { api: { llm: { models: vi.fn(() => Promise.resolve({ result: ok({ groups: [] }) })) } } },
      slots: { register },
      effect: (install: () => () => void) => { disposers.push(install()) },
    }
    apply(ctx as never)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledOnce() })
    const injected = (register.mock.calls[0]![0] as { inject: () => GameAppInjected }).inject()
    expect(injected.hooks.game.getSnapshot().rpsSetup).toEqual({ defaultRounds: 3, maxRounds: 9 })
    await injected.createMatch({ gameId: 'rps', config: {}, seats: [] })
    await injected.submitAction({ matchId: match.id, windowId: 'w', commandId: 'c', action: {} })
    await injected.resetMatch()
    changed?.('other')
    disposers.forEach((dispose) => { dispose() })
  })

  it('isolates asynchronous startup and invalidation failures', async () => {
    let changed: ((id: string) => void) | undefined
    const register = vi.fn((_registration: unknown) => () => undefined)
    const ctx = {
      remote: {
        matches: {
          catalog: vi.fn(() => Promise.reject(new Error('catalog failed'))),
          get: vi.fn(() => Promise.reject(new Error('refresh failed'))),
        },
        $on: vi.fn((_event: string, listener: (id: string) => void) => { changed = listener; return () => undefined }),
      },
      connection: { api: { llm: { models: vi.fn(() => Promise.reject(new Error('models failed'))) } } },
      slots: { register },
      effect: (install: () => () => void) => { install() },
    }
    localStorage.setItem('table-forge.active-match', match.id)
    apply(ctx as never)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledOnce() })
    const injected = (register.mock.calls[0]![0] as { inject: () => GameAppInjected }).inject()
    await vi.waitFor(() => { expect(injected.hooks.game.getSnapshot().error).toBeDefined() })
    injected.hooks.game.update((state) => { state.match = match })
    changed?.(match.id)
    await vi.waitFor(() => { expect(injected.hooks.game.getSnapshot().error).toBe('refresh failed') })
  })

  it('normalizes unknown startup and invalidation rejection values', async () => {
    let changed: ((id: string) => void) | undefined
    const register = vi.fn((_registration: unknown) => () => undefined)
    const ctx = {
      remote: {
        matches: {
          catalog: vi.fn(() => rejected('catalog string')),
          get: vi.fn(() => rejected('refresh string')),
        },
        $on: vi.fn((_event: string, listener: (id: string) => void) => { changed = listener; return () => undefined }),
      },
      connection: { api: { llm: { models: vi.fn(() => rejected('models string')) } } },
      slots: { register },
      effect: (install: () => () => void) => { install() },
    }
    localStorage.setItem('table-forge.active-match', match.id)
    apply(ctx as never)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledOnce() })
    const injected = (register.mock.calls[0]![0] as { inject: () => GameAppInjected }).inject()
    injected.hooks.game.update((state) => { state.match = match })
    changed?.(match.id)
    await vi.waitFor(() => { expect(injected.hooks.game.getSnapshot().error).toBe('refresh string') })
  })
})
