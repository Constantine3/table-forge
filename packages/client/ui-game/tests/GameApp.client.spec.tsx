// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GameApp, type GameAppInjected, type GameAppProps, type GameAppState,
} from '../src/client/GameApp.tsx'

const baseState: GameAppState = {
  match: undefined,
  matches: [],
  games: [{ id: 'rps', rulesVersion: 1, configSchema: {} }, { id: 'avalon', rulesVersion: 12, configSchema: {} }],
  selectedGameId: undefined,
  providers: [],
  audit: undefined,
  busy: false,
  error: undefined,
}

const mount = (state: GameAppState) => {
  let currentState = state
  const selectGame = vi.fn()
  const openMatch = vi.fn(() => Promise.resolve())
  const loadAudit = vi.fn(() => Promise.resolve())
  const renderSlot = vi.fn((key: string, owner: { selectGame?: (id: string) => void }, options?: { entryKey?: string }) => {
    if (key === 'game.catalog.item') return <button onClick={() => owner.selectGame?.('avalon')}>阿瓦隆目录卡</button>
    return <div>界面：{options?.entryKey}</div>
  })
  const createMatch = vi.fn(() => Promise.resolve())
  const props = {
    useGame: (select: (value: GameAppState) => unknown) => select(currentState),
    createMatch, submitAction: vi.fn(), resetMatch: vi.fn(), retryBlocked: vi.fn(), loadAudit,
    selectGame, openMatch, renderSlot,
  }
  const rendered = render(<GameApp {...props as unknown as GameAppProps} />)
  return {
    ...rendered, selectGame, openMatch, loadAudit, renderSlot, createMatch,
    updateState(next: GameAppState) {
      currentState = next
      rendered.rerender(<GameApp {...props as unknown as GameAppProps} />)
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('generic game product shell', () => {
  it('renders contributed catalog items and durable match history', () => {
    const bench = mount({
      ...baseState,
      matches: [
        { id: 'active-123456', gameId: 'rps', revision: 1, status: 'active', seats: [], blockedSeats: [], game: null },
        { id: 'blocked-1234', gameId: 'rps', revision: 1, status: 'blocked', seats: [], blockedSeats: [], game: null },
        { id: 'finished-123', gameId: 'rps', revision: 1, status: 'finished', seats: [], blockedSeats: [], game: null },
        { id: 'abandon-1234', gameId: 'rps', revision: 1, status: 'abandoned', seats: [], blockedSeats: [], game: null },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'TABLE FORGE' }))
    expect(bench.selectGame).toHaveBeenCalledWith(undefined)
    fireEvent.click(screen.getByRole('button', { name: '阿瓦隆目录卡' }))
    expect(bench.selectGame).toHaveBeenCalledWith('avalon')
    expect(screen.getByText(/进行中 · rps/)).toBeTruthy()
    expect(screen.getByText(/需要处理 · rps/)).toBeTruthy()
    expect(screen.getByText(/已结束 · rps/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /已完成 · rps/ }))
    expect(bench.openMatch).toHaveBeenCalledWith('finished-123')
    expect(bench.renderSlot).toHaveBeenCalledWith('game.catalog.item', expect.any(Object), expect.any(Object))
  })

  it('dispatches the selected game through the keyed surface', () => {
    const bench = mount({ ...baseState, selectedGameId: 'avalon' })
    expect(screen.getByText('界面：avalon')).toBeTruthy()
    expect(bench.renderSlot).toHaveBeenCalledWith(
      'game.surface', expect.objectContaining({
        game: { id: 'avalon', rulesVersion: 12, configSchema: {} }, match: undefined,
      }),
      expect.objectContaining({ entryKey: 'avalon' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /返回游戏列表/ }))
    expect(bench.selectGame).toHaveBeenCalledWith(undefined)
  })

  it('uses the durable match game id and presents controller errors', () => {
    const bench = mount({
      ...baseState,
      error: '连接失败',
      match: { id: 'm', gameId: 'rps', revision: 1, status: 'active', seats: [], blockedSeats: [], game: null },
    })
    expect(screen.getByText('界面：rps')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('连接失败')
    fireEvent.click(screen.getByRole('button', { name: 'TABLE FORGE' }))
    expect(bench.selectGame).not.toHaveBeenCalled()
  })

  it('owns explicit post-finish audit loading and the shared timeline outside game surfaces', () => {
    const finished = {
      id: 'finished', gameId: 'avalon', revision: 9, status: 'finished' as const,
      seats: [{
        id: 'assassin', displayName: '刺客玩家',
        controller: { type: 'agent' as const, provider: 'p', model: 'm' },
      }],
      blockedSeats: [], game: {},
    }
    const pending = mount({ ...baseState, match: finished })
    fireEvent.click(screen.getByRole('button', { name: '载入 AI 审计记录' }))
    expect(pending.loadAudit).toHaveBeenCalledOnce()
    pending.unmount()

    mount({
      ...baseState,
      match: finished,
      audit: { entries: [{
        seatId: 'assassin', actionType: 'assassinate', time: Date.UTC(2026, 7, 15, 8),
        turn: 12, eventSeq: 40, kind: 'action', action: { type: 'assassinate', target: 'human' }, accepted: true,
      }], unavailableSeatIds: [] },
    })
    expect(screen.getByText('AI 审计时间线（1 条）')).toBeTruthy()
    expect(screen.getByText('刺客玩家')).toBeTruthy()
    expect(screen.getByText('刺杀决策')).toBeTruthy()
    expect(screen.getByText('刺杀目标：human')).toBeTruthy()
  })

  it('requests notification permission from an explicit browser gesture and before match creation', async () => {
    const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
    vi.stubGlobal('Notification', {
      permission: 'default' as NotificationPermission,
      requestPermission,
    })
    const bench = mount({ ...baseState, selectedGameId: 'avalon' })
    fireEvent.click(screen.getByRole('button', { name: '开启后台回合通知' }))
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(await screen.findByText('后台回合通知已开启')).toBeTruthy()
    bench.unmount()

    requestPermission.mockClear()
    const pendingPermission = new Promise<NotificationPermission>(() => undefined)
    requestPermission.mockReturnValue(pendingPermission)
    const creation = mount({ ...baseState, selectedGameId: 'avalon' })
    const surfaceOwner = creation.renderSlot.mock.calls.find(call => call[0] === 'game.surface')?.[1] as {
      createMatch: GameAppInjected['createMatch']
    }
    await surfaceOwner.createMatch({ gameId: 'avalon', expectedRulesVersion: 12, config: {}, seats: [] })
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(creation.createMatch).toHaveBeenCalledWith({
      gameId: 'avalon', expectedRulesVersion: 12, config: {}, seats: [],
    })
  })

  it('notifies an unattended human action window once even when it first appeared in the foreground', () => {
    const notifications: Array<{
      title: string
      options: NotificationOptions | undefined
      onclick: (() => void) | null
      close: ReturnType<typeof vi.fn>
    }> = []
    vi.stubGlobal('Notification', class {
      static permission: NotificationPermission = 'granted'
      static requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
      onclick: (() => void) | null = null
      close = vi.fn()
      readonly title: string
      readonly options: NotificationOptions | undefined

      constructor(title: string, options?: NotificationOptions) {
        this.title = title
        this.options = options
        notifications.push(this)
      }
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)
    const waitingMatch: NonNullable<GameAppState['match']> = {
      id: 'turn-match', gameId: 'avalon', revision: 1, status: 'active',
      seats: [{ id: 'human', displayName: '你', controller: { type: 'human' } }],
      window: { id: 'ai-window', requiredSeats: ['ai-1'], submittedSeats: [], canAct: false },
      blockedSeats: [], game: {},
    }
    const bench = mount({ ...baseState, match: waitingMatch })
    bench.updateState({
      ...baseState,
      match: {
        ...waitingMatch, revision: 2,
        window: { id: 'human-window', requiredSeats: ['human'], submittedSeats: [], canAct: true },
      },
    })
    expect(notifications).toHaveLength(0)

    hasFocus.mockReturnValue(false)
    fireEvent(window, new Event('blur'))
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      title: '轮到你操作了',
      options: { body: '返回 Table Forge 完成当前操作。', tag: 'table-forge-turn-turn-match' },
    })
    bench.updateState({
      ...baseState,
      match: {
        ...waitingMatch, revision: 3,
        window: { id: 'human-window', requiredSeats: ['human'], submittedSeats: [], canAct: true },
      },
    })
    expect(notifications).toHaveLength(1)
    notifications[0]!.onclick?.()
    expect(focus).toHaveBeenCalledOnce()
    expect(notifications[0]!.close).toHaveBeenCalledOnce()
  })

  it('reports browsers without the Notification API', () => {
    vi.stubGlobal('Notification', undefined)
    mount(baseState)
    expect(screen.getByText('当前浏览器不支持回合通知')).toBeTruthy()
  })

  it('reports a browser that grants permission but rejects notification construction', async () => {
    vi.stubGlobal('Notification', class {
      static permission: NotificationPermission = 'granted'
      static requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))

      constructor() {
        throw new Error('notification delivery unavailable')
      }
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    mount({
      ...baseState,
      match: {
        id: 'delivery-failure', gameId: 'avalon', revision: 1, status: 'active',
        seats: [{ id: 'human', displayName: '你', controller: { type: 'human' } }],
        window: { id: 'human-window', requiredSeats: ['human'], submittedSeats: [], canAct: true },
        blockedSeats: [], game: {},
      },
    })
    expect(await screen.findByText('浏览器未能显示回合通知')).toBeTruthy()
  })
})
