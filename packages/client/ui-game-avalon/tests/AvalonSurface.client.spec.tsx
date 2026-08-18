// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GameRemoteCreateRequest, GameRemoteGameInfo, GameRemoteMatchView, GameRemoteSubmitRequest,
} from '@deepseek-ai/dsh-game/types'
import { AVALON_RULES_VERSION } from '@deepseek-ai/dsh-game-avalon-rules'
import { apply, inject } from '../src/client/index.ts'
import { AvalonCatalogItem, AvalonSurface } from '../src/client/AvalonSurface.tsx'

const provider = { id: 'local', name: 'Local', model: 'model', available: true }
const seats = [
  { id: 'human', displayName: '你', controller: { type: 'human' as const } },
  ...[1, 2, 3, 4].map(index => ({
    id: `ai-${index}`, displayName: `AI ${index}`,
    controller: { type: 'agent' as const, provider: 'local', model: 'model' },
  })),
]
const publicGame = {
  phase: 'proposal', playerCount: 5, missionSizes: [2, 3, 2, 3, 3],
  rolePreset: 'basic',
  roleDeck: ['merlin', 'loyal-servant', 'loyal-servant', 'assassin', 'minion'],
  missionFailThresholds: [1, 1, 1, 1, 1],
  leader: 'human', missionNumber: 1, teamSize: 2, failThreshold: 1, rejectedTeams: 0,
  score: { good: 0, evil: 0 }, proposal: null, statements: [], teamVotes: [], missions: [],
} as const
const game = {
  ...publicGame,
  private: { role: 'merlin', alignment: 'good', knowledge: [{ kind: 'evil', seatId: 'ai-1' }] },
} as const
const operations = () => ({
  createMatch: vi.fn((_request: GameRemoteCreateRequest) => Promise.resolve()),
  submitAction: vi.fn((_request: GameRemoteSubmitRequest) => Promise.resolve()),
  resetMatch: vi.fn(() => Promise.resolve()), retryBlocked: vi.fn(() => Promise.resolve()),
  loadAudit: vi.fn(() => Promise.resolve()),
})
const gameInfo: GameRemoteGameInfo = {
  id: 'avalon', rulesVersion: AVALON_RULES_VERSION,
  configSchema: { properties: { playerCount: { enum: [5, 6, 7, 8] } } },
}
const props = (match: GameRemoteMatchView | undefined, actions = operations(), game: GameRemoteGameInfo = gameInfo) => ({
  game, match, providers: [provider], audit: undefined, busy: false, ...actions,
})

afterEach(cleanup)

describe('Avalon game UI contribution', () => {
  it('registers its catalog and keyed board slots until its plugin fiber unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const disposeHost = ctx.slots.register({
      name: 'root', children: {
        'game.catalog.item': { kind: 'list', scope: 'root' },
        'game.surface': { kind: 'keyed', scope: 'root' },
      },
    } as never, (() => null) as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(ctx.slots.entries('game.catalog.item')[0]?.options).toMatchObject({ id: 'avalon', order: 20, label: '阿瓦隆' })
    expect(ctx.slots.entries('game.surface')[0]?.options).toMatchObject({ key: 'avalon' })

    await fiber.dispose()
    expect(ctx.slots.entries('game.catalog.item')).toHaveLength(0)
    expect(ctx.slots.entries('game.surface')).toHaveLength(0)
    disposeHost()
  })

  it('selects Avalon and creates the default six-player table with five separately configured AI seats', () => {
    const selectGame = vi.fn()
    const view = render(<AvalonCatalogItem {...({ selectGame } as Parameters<typeof AvalonCatalogItem>[0])} />)
    fireEvent.click(view.getByRole('button', { name: /阿瓦隆/ }))
    expect(selectGame).toHaveBeenCalledWith('avalon')

    const actions = operations()
    view.rerender(<AvalonSurface {...props(undefined, actions)} />)
    expect(screen.getAllByRole('combobox')).toHaveLength(7)
    expect(screen.getByLabelText('游戏人数')).toHaveProperty('value', '6')
    expect(screen.getByText('梅林 × 1')).toBeTruthy()
    expect(screen.getByText('刺客 × 1')).toBeTruthy()
    expect(screen.getByText('派西维尔 × 1')).toBeTruthy()
    expect(screen.getByText('亚瑟的忠臣 × 2')).toBeTruthy()
    expect(screen.getByText('莫甘娜 × 1')).toBeTruthy()
    const merlinRole = screen.getByText('梅林 × 1')
    expect(merlinRole.getAttribute('tabindex')).toBe('0')
    expect(merlinRole.getAttribute('data-tooltip')).toBe('善方 · 知道除莫德雷德外的邪方，但必须隐藏自己。')
    expect(merlinRole.getAttribute('aria-label'))
      .toBe('梅林 × 1。善方。知道除莫德雷德外的邪方，但必须隐藏自己。')
    merlinRole.focus()
    expect(document.activeElement).toBe(merlinRole)
    fireEvent.change(screen.getByLabelText('你的角色'), { target: { value: 'assassin' } })
    fireEvent.click(screen.getByRole('button', { name: '进入圆桌' }))
    const request = actions.createMatch.mock.calls[0]![0]
    expect(request).toMatchObject({
      gameId: 'avalon',
      expectedRulesVersion: AVALON_RULES_VERSION,
      config: { playerCount: 6, rolePreset: 'percival-morgana', humanRole: 'assassin' },
    })
    expect(request.seats).toHaveLength(6)
    expect(request.seats.filter(seat => seat.controller.type === 'human')).toHaveLength(1)
    expect(request.seats.slice(1).map(seat => seat.controller)).toEqual(Array.from({ length: 5 }, () => ({
      type: 'agent', provider: 'local', model: 'model',
    })))
  })

  it('creates five- through eight-player all-AI tables without a human role', () => {
    const actions = operations()
    render(<AvalonSurface {...props(undefined, actions)} />)
    fireEvent.click(screen.getByRole('button', { name: '全 AI 对局' }))
    expect(screen.queryByLabelText('你的角色')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '你与 AI' }))
    expect(screen.getByLabelText('你的角色')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全 AI 对局' }))
    expect(screen.getAllByLabelText(/^AI 席位/)).toHaveLength(6)
    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '5' } })
    expect(screen.getAllByLabelText(/^AI 席位/)).toHaveLength(5)
    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '6' } })
    expect(screen.getAllByLabelText(/^AI 席位/)).toHaveLength(6)
    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '7' } })
    expect(screen.getAllByLabelText(/^AI 席位/)).toHaveLength(7)
    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '8' } })
    expect(screen.getAllByLabelText(/^AI 席位/)).toHaveLength(8)
    expect(screen.getByText('亚瑟的忠臣 × 3')).toBeTruthy()
    expect(screen.getByText('莫德雷德的爪牙 × 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '进入圆桌' }))

    const request = actions.createMatch.mock.calls[0]![0]
    expect(request).toMatchObject({
      gameId: 'avalon', expectedRulesVersion: AVALON_RULES_VERSION,
      config: { playerCount: 8, rolePreset: 'percival-morgana' },
    })
    expect(request.seats).toHaveLength(8)
    expect(request.seats.every(seat => seat.controller.type === 'agent')).toBe(true)
    expect(request.seats.map(seat => seat.id)).toEqual([
      'ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5', 'ai-6', 'ai-7', 'ai-8',
    ])
  })

  it('blocks setup when the browser and service rules differ or the service publishes no table sizes', () => {
    const staleActions = operations()
    const stale = render(<AvalonSurface {...props(undefined, staleActions, {
      id: 'avalon', configSchema: { properties: { playerCount: { enum: [5, 6, 7] } } },
    })} />)
    expect(screen.getByRole('alert').textContent).toContain('规则版本不一致')
    expect(within(screen.getByLabelText('游戏人数')).queryByRole('option', { name: '八人局' })).toBeNull()
    expect(screen.getByRole('button', { name: '进入圆桌' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '进入圆桌' }))
    expect(staleActions.createMatch).not.toHaveBeenCalled()
    stale.unmount()

    const limited = render(<AvalonSurface {...props(undefined, operations(), {
      id: 'avalon', rulesVersion: AVALON_RULES_VERSION,
      configSchema: { properties: { playerCount: { enum: [5, 7] } } },
    })} />)
    expect(screen.getByLabelText('游戏人数')).toHaveProperty('value', '5')
    limited.unmount()

    const missingActions = operations()
    render(<AvalonSurface {...props(undefined, missingActions, {
      id: 'avalon', rulesVersion: AVALON_RULES_VERSION, configSchema: null,
    })} />)
    expect(screen.getByRole('alert').textContent).toContain('没有公布可用的阿瓦隆人数')
    expect(screen.getByRole('button', { name: '进入圆桌' }).hasAttribute('disabled')).toBe(true)
    expect(missingActions.createMatch).not.toHaveBeenCalled()
  })

  it('offers only fair presets and falls back when a table size does not support the selection', () => {
    const actions = operations()
    render(<AvalonSurface {...props(undefined, actions)} />)
    expect(screen.queryByRole('button', { name: /莫德雷德与奥伯伦/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('你的角色'), { target: { value: 'morgana' } })
    fireEvent.click(screen.getByRole('button', { name: /莫德雷德与奥伯伦/ }))
    expect(screen.getByLabelText('你的角色')).toHaveProperty('value', '')
    expect(screen.getByText('莫德雷德 × 1')).toBeTruthy()
    expect(screen.getByText('奥伯伦 × 1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('你的角色'), { target: { value: 'merlin' } })
    fireEvent.click(screen.getByRole('button', { name: /基础身份/ }))
    expect(screen.getByLabelText('你的角色')).toHaveProperty('value', 'merlin')
    fireEvent.click(screen.getByRole('button', { name: /莫德雷德与奥伯伦/ }))
    expect(screen.getByLabelText('你的角色')).toHaveProperty('value', 'merlin')
    fireEvent.change(screen.getByLabelText('你的角色'), { target: { value: 'oberon' } })
    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '8' } })
    expect(screen.getByRole('button', { name: /莫德雷德与奥伯伦/ }).getAttribute('data-active')).toBe('true')
    expect(screen.getByLabelText('你的角色')).toHaveProperty('value', 'oberon')
    expect(screen.getByText('亚瑟的忠臣 × 4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '进入圆桌' }))
    expect(actions.createMatch.mock.calls[0]![0].config).toEqual({
      playerCount: 8, rolePreset: 'mordred-oberon', humanRole: 'oberon',
    })

    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '5' } })
    expect(screen.getByRole('button', { name: /派西维尔与莫甘娜/ }).getAttribute('data-active')).toBe('true')
    expect(within(screen.getByLabelText('你的角色')).queryByRole('option', { name: '奥伯伦' })).toBeNull()
    expect(screen.getByLabelText('你的角色')).toHaveProperty('value', '')
  })

  it('builds a proposal from the seat-scoped action schema', () => {
    const actions = operations()
    const match: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 1, status: 'active', seats,
      window: {
        id: 'w', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { team: { minItems: 2 } } },
      },
      blockedSeats: [], game,
    }
    const view = render(<AvalonSurface {...(props(match, actions) as Parameters<typeof AvalonSurface>[0])} />)
    expect(view.container.querySelector('[data-layout="circle"]')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-position]')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: /队长你/ }))
    fireEvent.click(screen.getByRole('button', { name: /圆桌成员AI 1/ }))
    fireEvent.click(screen.getByRole('button', { name: /圆桌成员AI 2/ }))
    fireEvent.click(screen.getByRole('button', { name: /队长你/ }))
    fireEvent.click(screen.getByRole('button', { name: /队长你/ }))
    fireEvent.click(screen.getByRole('button', { name: /逆时针/ }))
    fireEvent.click(screen.getByRole('button', { name: /顺时针/ }))
    fireEvent.click(screen.getByRole('button', { name: '提交队伍' }))
    expect(actions.submitAction).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'm', windowId: 'w',
      action: { type: 'propose-team', team: ['ai-1', 'human'], direction: 'clockwise' },
    }))
    fireEvent.click(screen.getByRole('button', { name: '结束对局' }))
    expect(actions.resetMatch).toHaveBeenCalledOnce()
  })

  it('selects each AI provider independently and disables setup when no route is usable', () => {
    const actions = operations()
    const alternate = { id: 'alternate', name: 'Alternate', model: 'other', available: true }
    const view = render(<AvalonSurface {...{
      ...props(undefined, actions), providers: [provider, alternate],
    }} />)
    fireEvent.change(screen.getByLabelText('游戏人数'), { target: { value: '5' } })
    expect(screen.getByText('亚瑟的忠臣 × 1')).toBeTruthy()
    const selectors = screen.getAllByLabelText(/^AI 席位/)
    expect(selectors).toHaveLength(4)
    for (const [index, selector] of selectors.entries()) {
      fireEvent.change(selector, { target: { value: index % 2 === 0 ? 'alternate' : 'local' } })
    }
    fireEvent.click(screen.getByRole('button', { name: '进入圆桌' }))
    expect(actions.createMatch.mock.calls[0]![0].config).toEqual({
      playerCount: 5, rolePreset: 'percival-morgana',
    })
    expect(actions.createMatch.mock.calls[0]![0].seats.slice(1).map(seat => seat.controller)).toEqual([
      { type: 'agent', provider: 'alternate', model: 'other' },
      { type: 'agent', provider: 'local', model: 'model' },
      { type: 'agent', provider: 'alternate', model: 'other' },
      { type: 'agent', provider: 'local', model: 'model' },
    ])

    view.rerender(<AvalonSurface {...{
      ...props(undefined, actions), providers: [{ ...provider, available: false }], busy: true,
    }} />)
    expect(screen.getByText('没有从当前游戏主机可达的提供方。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '正在分配身份…' }).hasAttribute('disabled')).toBe(true)
    const unavailableSelectors = screen.getAllByLabelText(/^AI 席位/)
    expect(unavailableSelectors.flatMap(selector => within(selector).getAllByRole('option'))
      .every(option => option.textContent?.includes('当前不可用') ?? false)).toBe(true)
  })

  it('renders all eight seats around the circle and labels the fourth mission threshold', () => {
    const eightPlayerSeats = [
      ...seats,
      { id: 'ai-5', displayName: 'AI 5', controller: { type: 'agent' as const, provider: 'local', model: 'model' } },
      { id: 'ai-6', displayName: 'AI 6', controller: { type: 'agent' as const, provider: 'local', model: 'model' } },
      { id: 'ai-7', displayName: 'AI 7', controller: { type: 'agent' as const, provider: 'local', model: 'model' } },
    ]
    const eightPlayerGame = {
      ...publicGame,
      playerCount: 8,
      roleDeck: [
        'merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'minion', 'minion',
      ],
      missionSizes: [3, 4, 4, 5, 5],
      missionFailThresholds: [1, 1, 1, 2, 1],
    } as const
    const match: GameRemoteMatchView = {
      id: 'eight', gameId: 'avalon', revision: 1, status: 'active', seats: eightPlayerSeats,
      window: { id: 'wait', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [],
      game: eightPlayerGame,
    }
    const view = render(<AvalonSurface {...(props(match) as Parameters<typeof AvalonSurface>[0])} />)
    const roundTable = view.container.querySelector('[data-layout="circle"]')!
    expect(roundTable.querySelectorAll('[data-position]')).toHaveLength(8)
    const roleComposition = screen.getByLabelText('角色构成')
    expect(within(roleComposition).getByText('梅林 × 1')).toBeTruthy()
    expect(within(roleComposition).getByText('亚瑟的忠臣 × 4')).toBeTruthy()
    expect(within(roleComposition).getByText('刺客 × 1')).toBeTruthy()
    expect(within(roleComposition).getByText('莫德雷德的爪牙 × 2')).toBeTruthy()
    expect(screen.getAllByText('5 人')).toHaveLength(2)
    expect(screen.getByText('需 2 票失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: /圆桌成员AI 7/ }).getAttribute('style')).toMatch(/left:|top:/)

    view.rerender(<AvalonSurface {...props({
      ...match,
      game: {
        ...eightPlayerGame,
        missions: [
          { number: 1, team: ['human', 'ai-1', 'ai-2'], failCount: 0, success: true },
          { number: 2, team: ['human', 'ai-1', 'ai-2', 'ai-3'], failCount: 0, success: true },
          { number: 3, team: ['human', 'ai-1', 'ai-2', 'ai-3'], failCount: 1, success: false },
          { number: 4, team: ['human', 'ai-1', 'ai-2', 'ai-3', 'ai-4'], failCount: 2, success: false },
        ],
      },
    })} />)
    expect(screen.getByText('失败 · 2 票 · 门槛 2 票')).toBeTruthy()
  })

  it('explains special-role abilities without resolving Percival candidates', () => {
    const match: GameRemoteMatchView = {
      id: 'knowledge', gameId: 'avalon', revision: 1, status: 'active', seats,
      window: { id: 'wait', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [],
      game: {
        ...publicGame,
        rolePreset: 'percival-morgana',
        roleDeck: ['merlin', 'percival', 'loyal-servant', 'assassin', 'morgana'],
        private: {
          role: 'percival', alignment: 'good',
          knowledge: [
            { kind: 'merlin-candidate', seatId: 'ai-1' },
            { kind: 'merlin-candidate', seatId: 'ai-2' },
          ],
        },
      },
    }
    const view = render(<AvalonSurface {...(props(match) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getByText('看到梅林与莫甘娜两名候选，但无法分辨。')).toBeTruthy()
    expect(screen.getByText('梅林候选（无法分辨）：AI 1、AI 2')).toBeTruthy()
    expect(screen.queryByText(/AI 1（梅林）/)).toBeNull()

    view.rerender(<AvalonSurface {...props({
      ...match,
      game: {
        ...publicGame,
        playerCount: 7,
        rolePreset: 'mordred-oberon',
        roleDeck: ['merlin', 'loyal-servant', 'loyal-servant', 'loyal-servant', 'assassin', 'mordred', 'oberon'],
        private: { role: 'oberon', alignment: 'evil', knowledge: [] },
      },
    })} />)
    expect(screen.getByText('属于邪方但不参与邪方互认与刺杀密谈，需独立判断。')).toBeTruthy()
    expect(screen.queryByText(/邪方同伴：/)).toBeNull()
  })

  it('rejects a projected board without all five mission failure thresholds', () => {
    const match: GameRemoteMatchView = {
      id: 'invalid', gameId: 'avalon', revision: 1, status: 'active', seats,
      window: { id: 'wait', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [],
      game: { ...publicGame, missionFailThresholds: [1, 1, 1, 1] },
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(() => render(<AvalonSurface {...(props(match) as Parameters<typeof AvalonSurface>[0])} />))
        .toThrow('Avalon mission 5 has no failure threshold')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('renders mission, identity, proposal, and anonymous vote patterns', () => {
    const actions = operations()
    const voteGame = {
      ...publicGame,
      phase: 'team-vote',
      missions: [
        { number: 1, team: ['human', 'ai-1'], failCount: 0, success: true },
        { number: 2, team: ['ai-2', 'ai-3', 'ai-4'], failCount: 1, success: false },
      ],
      proposal: { leader: 'human', team: ['human', 'missing'], direction: 'counterclockwise' },
      statements: [
        { seatId: 'human', statement: '公开理由' },
        { seatId: 'ai-1', statement: '我会继续观察。' },
        { seatId: 'missing', statement: '我还没有足够信息。' },
      ],
      private: {
        role: 'assassin', alignment: 'evil',
        knowledge: [
          { kind: 'evil-ally', seatId: 'ai-1', role: 'minion' },
          { kind: 'evil-ally', seatId: 'ai-2', role: 'morgana' },
          { kind: 'evil-ally', seatId: 'missing', role: 'assassin' },
        ],
      },
      roles: { human: 'merlin', 'ai-1': 'assassin', 'ai-2': 'minion', 'ai-3': 'loyal-servant', 'ai-4': 'unknown' },
      teamVotes: [
        {
          proposal: { leader: 'human', team: ['human', 'ai-1'], direction: 'clockwise' }, approved: true,
          statements: [{ seatId: 'human', statement: '赞成理由' }],
          approveCount: 3, rejectCount: 2,
        },
        {
          proposal: { leader: 'ai-1', team: ['ai-2', 'ai-3'], direction: 'counterclockwise' }, approved: false,
          statements: [{ seatId: 'missing', statement: '否决理由' }],
          approveCount: 2, rejectCount: 3,
        },
      ],
    } as const
    const match: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 2, status: 'active', seats,
      window: {
        id: 'vote', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { statement: { maxLength: 40 } } },
      },
      blockedSeats: [], game: voteGame,
    }
    render(<AvalonSurface {...(props(match, actions) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getAllByText('刺客')).toHaveLength(2)
    expect(screen.getAllByText('邪方').length).toBeGreaterThan(0)
    expect(screen.getByText(/邪方同伴：/).textContent).toContain('missing（刺客）')
    expect(screen.getAllByText('莫德雷德的爪牙').length).toBeGreaterThan(0)
    expect(screen.getAllByText('亚瑟的忠臣').length).toBeGreaterThan(0)
    expect(screen.getByText('投票前发言')).toBeTruthy()
    expect(screen.getAllByText(/顺时针/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/逆时针/).length).toBeGreaterThan(0)
    expect(screen.getByText('“公开理由”')).toBeTruthy()
    expect(screen.getByText('“我会继续观察。”')).toBeTruthy()
    expect(screen.getByText('“我还没有足够信息。”').parentElement?.textContent).toContain('missing')
    const approvedSummary = screen.getByText(/队伍通过 · 票型 3 赞成 \/ 2 否决/)
    const rejectedSummary = screen.getByText(/队伍否决 · 票型 2 赞成 \/ 3 否决/)
    expect(approvedSummary.tagName).toBe('SUMMARY')
    expect(rejectedSummary.tagName).toBe('SUMMARY')
    expect(screen.getByText(/赞成理由/)).toBeTruthy()
    expect(screen.getByText(/否决理由/)).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('失败 · 1 票')).toBeTruthy()
    expect(screen.queryByText('你 · 赞成')).toBeNull()
    expect(screen.getByRole('heading', { name: '提交匿名投票' })).toBeTruthy()
    expect(screen.getByText('5 名玩家已经完成公开发言。全部提交后只公开赞成与否决票数。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '否决' }))
    fireEvent.click(screen.getByRole('button', { name: '赞成' }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: { type: 'vote-team', approve: false },
    }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: { type: 'vote-team', approve: true },
    }))
  })

  it('collects one public statement before enabling the human vote', () => {
    const actions = operations()
    const discussion: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 2, status: 'active', seats,
      window: {
        id: 'discussion', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { statement: { maxLength: 40 } } },
      },
      blockedSeats: [],
      game: {
        ...publicGame, phase: 'discussion', leader: 'ai-4', proposal: { leader: 'ai-4', team: ['human', 'ai-1'], direction: 'clockwise' },
        statements: [],
      },
    }
    render(<AvalonSurface {...(props(discussion, actions) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getByText('队长轮换顺序（顺时针）')).toBeTruthy()
    expect(screen.getByRole('button', { name: /队长AI 4/ })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('在投票前公开发表看法'), { target: { value: '我需要听完所有人的判断。' } })
    fireEvent.click(screen.getByRole('button', { name: '发表发言' }))
    expect(actions.submitAction).toHaveBeenCalledWith(expect.objectContaining({
      action: { type: 'make-statement', statement: '我需要听完所有人的判断。' },
    }))
    expect(screen.queryByRole('button', { name: '赞成' })).toBeNull()
  })

  it('labels the leader as the final summary speaker', () => {
    const actions = operations()
    const discussion: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 6, status: 'active', seats,
      window: {
        id: 'discussion', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { statement: { maxLength: 40 } } },
      },
      blockedSeats: [],
      game: {
        ...publicGame, phase: 'discussion', proposal: { leader: 'human', team: ['human', 'ai-1'], direction: 'clockwise' },
        statements: [
          { seatId: 'ai-1', statement: '第一位发言。' },
          { seatId: 'ai-2', statement: '第二位发言。' },
          { seatId: 'ai-3', statement: '第三位发言。' },
          { seatId: 'ai-4', statement: '第四位发言。' },
        ],
      },
    }
    render(<AvalonSurface {...(props(discussion, actions) as Parameters<typeof AvalonSurface>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: /圆桌成员AI 1/ }))
    fireEvent.click(screen.getByRole('button', { name: /圆桌成员AI 2/ }))
    fireEvent.change(screen.getByPlaceholderText('总结本轮讨论并完成归票发言'), { target: { value: '我来总结并归票。' } })
    fireEvent.click(screen.getByRole('button', { name: '发表归票并确定队伍' }))
    expect(actions.submitAction).toHaveBeenCalledWith(expect.objectContaining({
      action: { type: 'make-statement', statement: '我来总结并归票。', team: ['human', 'ai-2'] },
    }))
  })

  it('offers only role-permitted quest actions and the private assassination targets', () => {
    const actions = operations()
    const quest: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 3, status: 'active', seats,
      window: {
        id: 'quest', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { outcome: { enum: ['success', 'fail'] } } },
      },
      blockedSeats: [], game: { ...publicGame, phase: 'quest', proposal: { leader: 'human', team: ['human', 'ai-1'], direction: 'clockwise' } },
    }
    const view = render(<AvalonSurface {...(props(quest, actions) as Parameters<typeof AvalonSurface>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: '令任务失败' }))
    fireEvent.click(screen.getByRole('button', { name: '令任务成功' }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: { type: 'quest', outcome: 'fail' } }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: { type: 'quest', outcome: 'success' } }))

    view.rerender(<AvalonSurface {...props({
      ...quest,
      window: {
        id: 'assassinate', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { target: { enum: ['human', 'missing'] } } },
      },
      game: { ...publicGame, phase: 'assassination', score: { good: 3, evil: 0 } },
    }, actions)} />)
    fireEvent.click(screen.getByRole('button', { name: /^你$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^missing$/ }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(3, expect.objectContaining({ action: { type: 'assassinate', target: 'human' } }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(4, expect.objectContaining({ action: { type: 'assassinate', target: 'missing' } }))
  })

  it('lets an evil human speak in order and gives the Assassin a final summary before targeting', () => {
    const actions = operations()
    const evilDiscussion: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 8, status: 'active', seats,
      window: {
        id: 'evil-discussion', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { statement: { maxLength: 40 } } },
      },
      blockedSeats: [],
      game: {
        ...publicGame, phase: 'evil-discussion', score: { good: 3, evil: 0 },
        evilSpeaker: 'human', evilDiscussion: [],
        private: {
          role: 'minion', alignment: 'evil',
          knowledge: [{ kind: 'evil-ally', seatId: 'ai-1', role: 'assassin' }],
        },
      },
    }
    const view = render(<AvalonSurface {...(props(evilDiscussion, actions) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getAllByText('刺杀前密谈').length).toBeGreaterThan(0)
    expect(screen.getByText('等待第一位邪方玩家发言。')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('私下向刺客提供判断'), { target: { value: 'AI 2 很可能是梅林。' } })
    fireEvent.click(screen.getByRole('button', { name: '提交邪方发言' }))
    expect(actions.submitAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { type: 'make-evil-statement', statement: 'AI 2 很可能是梅林。' },
    }))

    view.rerender(<AvalonSurface {...props({
      ...evilDiscussion,
      window: { id: 'evil-summary', requiredSeats: ['human'], submittedSeats: [], canAct: true,
        actionSchema: { properties: { statement: { maxLength: 40 } } } },
      game: {
        ...evilDiscussion.game as object,
        evilSpeaker: 'human',
        evilDiscussion: [{ seatId: 'ai-1', statement: '我怀疑 AI 2。' }],
        private: {
          role: 'assassin', alignment: 'evil',
          knowledge: [{ kind: 'evil-ally', seatId: 'ai-1', role: 'minion' }],
        },
      },
    }, actions)} />)
    expect(screen.getByText('“我怀疑 AI 2。”')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('总结讨论并说明刺杀判断'), { target: { value: '我将刺杀 AI 2。' } })
    fireEvent.click(screen.getByRole('button', { name: '提交刺客总结' }))
    expect(actions.submitAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { type: 'make-evil-statement', statement: '我将刺杀 AI 2。' },
    }))
  })

  it('hides evil turns from good players and labels each private waiting state for evil players', () => {
    const waiting: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 9, status: 'active', seats,
      window: { id: 'evil-discussion', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [],
      game: { ...publicGame, phase: 'evil-discussion', score: { good: 3, evil: 0 } },
    }
    const view = render(<AvalonSurface {...(props(waiting) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getByText('邪方正在私下讨论')).toBeTruthy()
    expect(screen.getByText('邪方正在私下轮流讨论。')).toBeTruthy()
    expect(screen.queryByText('等待第一位邪方玩家发言。')).toBeNull()

    view.rerender(<AvalonSurface {...props({
      ...waiting,
      game: {
        ...waiting.game as object,
        evilSpeaker: 'ai-1',
        private: {
          role: 'minion', alignment: 'evil',
          knowledge: [{ kind: 'evil-ally', seatId: 'ai-1', role: 'assassin' }],
        },
      },
    })} />)
    expect(screen.getByText('AI 1总结')).toBeTruthy()
    expect(screen.getByText('等待AI 1总结。')).toBeTruthy()
    expect(screen.getByText('等待第一位邪方玩家发言。')).toBeTruthy()

    view.rerender(<AvalonSurface {...props({
      ...waiting,
      game: {
        ...waiting.game as object,
        evilSpeaker: 'missing',
        evilDiscussion: [{ seatId: 'missing', statement: '私密判断。' }],
        private: {
          role: 'minion', alignment: 'evil',
          knowledge: [{ kind: 'evil-ally', seatId: 'ai-1', role: 'assassin' }],
        },
      },
    })} />)
    expect(screen.getByText('等待下一位邪方玩家发言。')).toBeTruthy()
    expect(screen.getByText('“私密判断。”').parentElement?.textContent).toContain('missing')

    view.rerender(<AvalonSurface {...props({
      ...waiting,
      game: {
        ...waiting.game as object,
        evilSpeaker: 'human', evilDiscussion: [],
        private: {
          role: 'assassin', alignment: 'evil',
          knowledge: [{ kind: 'evil-ally', seatId: 'ai-1', role: 'minion' }],
        },
      },
    })} />)
    expect(screen.getByText('你总结')).toBeTruthy()
    expect(screen.getByText('等待你总结。')).toBeTruthy()
  })

  it('renders ordinary waiting and both blocked recovery actions', () => {
    const actions = operations()
    const waiting: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 4, status: 'active', seats,
      window: { id: 'vote', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [], game: { ...publicGame, phase: 'team-vote' },
    }
    const view = render(<AvalonSurface {...(props(waiting, actions) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getByText(/等待其他圆桌成员行动/)).toBeTruthy()
    view.rerender(<AvalonSurface {...props({
      ...waiting,
      window: { id: 'discussion', requiredSeats: ['ai-1'], submittedSeats: [], canAct: false },
      game: { ...publicGame, phase: 'discussion' },
    }, actions)} />)
    expect(screen.getByText('等待AI 1发言。')).toBeTruthy()
    view.rerender(<AvalonSurface {...props({
      ...waiting,
      window: { id: 'discussion', requiredSeats: ['human'], submittedSeats: [], canAct: false },
      game: {
        ...publicGame, phase: 'discussion', proposal: { leader: 'human', team: ['human', 'ai-1'], direction: 'clockwise' },
        statements: [
          { seatId: 'ai-1', statement: '一' }, { seatId: 'ai-2', statement: '二' },
          { seatId: 'ai-3', statement: '三' }, { seatId: 'ai-4', statement: '四' },
        ],
      },
    }, actions)} />)
    expect(screen.getByText('等待队长归票发言。')).toBeTruthy()
    view.rerender(<AvalonSurface {...props({
      ...waiting,
      window: { id: 'discussion', requiredSeats: ['missing'], submittedSeats: [], canAct: false },
      game: {
        ...publicGame, phase: 'discussion', proposal: { leader: 'human', team: ['human', 'ai-1'], direction: 'clockwise' },
      },
    }, actions)} />)
    expect(screen.getByText('下一位成员发言')).toBeTruthy()
    const waitingWithoutWindow: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 4, status: 'active', seats, blockedSeats: [],
      game: { ...publicGame, phase: 'discussion' },
    }
    view.rerender(<AvalonSurface {...props(waitingWithoutWindow, actions)} />)
    expect(screen.getByText('等待下一位圆桌成员发言。')).toBeTruthy()
    view.rerender(<AvalonSurface {...props({ ...waiting, status: 'blocked' }, actions)} />)
    fireEvent.click(screen.getByRole('button', { name: '重试 AI' }))
    fireEvent.click(screen.getAllByRole('button', { name: '结束对局' })[1]!)
    expect(actions.retryBlocked).toHaveBeenCalledOnce()
    expect(actions.resetMatch).toHaveBeenCalledOnce()
  })

  it('does not reveal who owns the private assassination action', () => {
    const match: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 9, status: 'active', seats,
      window: { id: 'private', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [], game: { ...publicGame, phase: 'assassination', score: { good: 3, evil: 0 } },
    }
    render(<AvalonSurface {...(props(match) as Parameters<typeof AvalonSurface>[0])} />)
    expect(screen.getByText('最终抉择正在私下进行。')).toBeTruthy()
    expect(screen.getByText('刺客 × 1')).toBeTruthy()
    expect(screen.queryByText('刺杀梅林')).toBeNull()
    expect(screen.queryByText('你的身份')).toBeNull()
  })

  it('offers identity-free retry when a private controller is blocked', () => {
    const actions = operations()
    const match: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 9, status: 'blocked', seats,
      window: { id: 'private', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [], game: { ...publicGame, phase: 'assassination', score: { good: 3, evil: 0 } },
    }
    render(<AvalonSurface {...(props(match, actions) as Parameters<typeof AvalonSurface>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: '重试 AI' }))
    expect(actions.retryBlocked).toHaveBeenCalledOnce()
    expect(screen.getByText('私有阶段不会显示相关席位。').parentElement?.textContent).not.toMatch(/ai-\d|AI \d/)
  })

  it('keeps abandoned identities hidden after rendering a normal finish', () => {
    const actions = operations()
    const finished: GameRemoteMatchView = {
      id: 'm', gameId: 'avalon', revision: 10, status: 'finished', seats, blockedSeats: [],
      game: { ...game, phase: 'finished', winner: 'good', finishReason: 'merlin-survived', roles: { human: 'merlin' } },
    }
    const view = render(<AvalonSurface {...(props(finished, actions) as Parameters<typeof AvalonSurface>[0])} />)
    view.rerender(<AvalonSurface {...props({
      ...finished, status: 'abandoned', game: publicGame,
    })} />)
    expect(screen.getByText('对局已放弃；隐藏身份不会公开。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '载入 AI 审计记录' })).toBeNull()
  })

  it('labels every finish reason', () => {
    const actions = operations()
    const reasons = [
      ['merlin-assassinated', '刺客找到了梅林'],
      ['merlin-survived', '梅林避开了刺杀'],
      ['three-failed-quests', '三次任务失败'],
      ['five-rejected-teams', '连续五支队伍被否决'],
      [undefined, '对局结束'],
    ] as const
    let view: ReturnType<typeof render> | undefined
    for (const [index, [reason, label]] of reasons.entries()) {
      const winner: 'good' | 'evil' = index % 2 === 0 ? 'evil' : 'good'
      const match: GameRemoteMatchView = {
        id: 'm', gameId: 'avalon', revision: 10 + index, status: 'finished', seats, blockedSeats: [],
        game: {
          ...publicGame, phase: 'finished', winner,
          ...(reason === undefined ? {} : { finishReason: reason }),
          assassinationTarget: index === 0 ? 'human' : null,
        },
      }
      const element = <AvalonSurface {...props(match, actions)} />
      if (view === undefined) view = render(element); else view.rerender(element)
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(actions.loadAudit).not.toHaveBeenCalled()
  })
})
