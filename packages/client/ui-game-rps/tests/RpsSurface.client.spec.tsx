// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameRemoteCreateRequest, GameRemoteMatchView, GameRemoteSubmitRequest } from '@deepseek-ai/dsh-game/types'
import { apply, inject } from '../src/client/index.ts'
import { RpsCatalogItem, RpsSurface } from '../src/client/RpsSurface.tsx'

const provider = { id: 'local', name: 'Local', model: 'model', available: true }
const seats = [
  { id: 'human', displayName: '你', controller: { type: 'human' as const } },
  { id: 'ai', displayName: 'AI', controller: { type: 'agent' as const, provider: 'local', model: 'model' } },
]
const operations = () => ({
  createMatch: vi.fn((_request: GameRemoteCreateRequest) => Promise.resolve()),
  submitAction: vi.fn((_request: GameRemoteSubmitRequest) => Promise.resolve()),
  resetMatch: vi.fn(() => Promise.resolve()), retryBlocked: vi.fn(() => Promise.resolve()),
  loadAudit: vi.fn(() => Promise.resolve()),
})

afterEach(cleanup)

describe('RPS game UI contribution', () => {
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

    expect(ctx.slots.entries('game.catalog.item')[0]?.options).toMatchObject({ id: 'rps', order: 10, label: '剪刀石头布' })
    expect(ctx.slots.entries('game.surface')[0]?.options).toMatchObject({ key: 'rps' })

    await fiber.dispose()
    expect(ctx.slots.entries('game.catalog.item')).toHaveLength(0)
    expect(ctx.slots.entries('game.surface')).toHaveLength(0)
    disposeHost()
  })

  it('selects RPS from the catalog and creates a human versus AI match', () => {
    const selectGame = vi.fn()
    const view = render(<RpsCatalogItem {...({ selectGame } as Parameters<typeof RpsCatalogItem>[0])} />)
    fireEvent.click(view.getByRole('button', { name: /剪刀.*石头.*布/ }))
    expect(selectGame).toHaveBeenCalledWith('rps')

    const actions = operations()
    view.rerender(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: { properties: { roundCount: { default: 3, maximum: 9 } } } },
      match: undefined, providers: [provider], audit: undefined, busy: false, ...actions,
    } as unknown as Parameters<typeof RpsSurface>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))
    expect(actions.createMatch).toHaveBeenCalledWith({
      gameId: 'rps', expectedRulesVersion: 1, config: { roundCount: 3 },
      seats: [
        { id: 'human', displayName: '你', controller: { type: 'human' } },
        { id: 'ai-1', displayName: 'AI 一号', controller: { type: 'agent', provider: 'local', model: 'model' } },
      ],
    })
  })

  it('submits only through an actionable human window', () => {
    const actions = operations()
    const match: GameRemoteMatchView = {
      id: 'm', gameId: 'rps', revision: 1, status: 'active',
      seats,
      window: { id: 'w', requiredSeats: ['human'], submittedSeats: ['ai'], canAct: true, actionSchema: {} },
      blockedSeats: [], game: { roundCount: 1, rounds: [], scores: { human: 0, ai: 0 }, winner: null },
    }
    render(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: {} }, match, providers: [provider], audit: undefined, busy: false, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    for (const name of [/石头/, /布/, /剪刀/]) fireEvent.click(screen.getByRole('button', { name }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      matchId: 'm', windowId: 'w', action: { choice: 'rock' },
    }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: { choice: 'paper' } }))
    expect(actions.submitAction).toHaveBeenNthCalledWith(3, expect.objectContaining({ action: { choice: 'scissors' } }))
    expect(screen.getByText('已锁定选择')).toBeTruthy()
  })

  it('blocks setup when the Host predates the rules-version handshake', () => {
    const actions = operations()
    render(<RpsSurface {...({
      game: { id: 'rps', configSchema: { properties: { roundCount: { default: 3, maximum: 9 } } } },
      match: undefined, providers: [provider], audit: undefined, busy: false, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    expect(screen.getByRole('alert').textContent).toContain('服务版本不一致')
    expect(screen.getByRole('button', { name: '开始对局' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))
    expect(actions.createMatch).not.toHaveBeenCalled()
  })

  it('configures two independent AI seats and handles unavailable setup routes', () => {
    const actions = operations()
    const alternate = { id: 'alternate', name: 'Alternate', model: 'other', available: true }
    const view = render(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: { properties: { roundCount: { default: 3, maximum: 9 } } } },
      match: undefined, providers: [provider, alternate], audit: undefined, busy: false, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 对 AI' }))
    fireEvent.click(screen.getByRole('button', { name: '你对 AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 对 AI' }))
    const selectors = screen.getAllByRole('combobox')
    fireEvent.change(selectors[0]!, { target: { value: 'alternate' } })
    fireEvent.change(selectors[1]!, { target: { value: 'local' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))
    expect(actions.createMatch).toHaveBeenCalledWith({
      gameId: 'rps', expectedRulesVersion: 1, config: { roundCount: 5 },
      seats: [
        { id: 'ai-1', displayName: 'AI 一号', controller: { type: 'agent', provider: 'alternate', model: 'other' } },
        { id: 'ai-2', displayName: 'AI 二号', controller: { type: 'agent', provider: 'local', model: 'model' } },
      ],
    })

    view.rerender(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: {} }, match: undefined,
      providers: [{ ...provider, available: false }], audit: undefined, busy: true, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    expect(screen.getAllByText('没有从当前游戏主机可达的提供方。')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '正在开桌…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByRole('option').every(option => option.textContent?.includes('当前不可用') ?? false)).toBe(true)
  })

  it('renders waiting, blocked, and abandoned states without exposing sealed choices', () => {
    const actions = operations()
    const waiting: GameRemoteMatchView = {
      id: 'm', gameId: 'rps', revision: 2, status: 'active', seats,
      window: { id: 'w', requiredSeats: [], submittedSeats: [], canAct: false },
      blockedSeats: [], game: { roundCount: 1, rounds: [], scores: { human: 0 }, winner: null },
    }
    const view = render(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: {} }, match: waiting, providers: [provider], audit: undefined, busy: false, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    expect(screen.getByText(/AI 正在选择/)).toBeTruthy()
    expect(screen.getAllByText('正在选择…')).toHaveLength(2)
    expect(screen.getAllByText('0')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '新对局' }))
    expect(actions.resetMatch).toHaveBeenCalledOnce()

    view.rerender(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: {} },
      match: { ...waiting, status: 'blocked', blockedSeats: [{ seatId: 'ai', message: 'provider failed' }] },
      providers: [provider], audit: undefined, busy: false, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    expect(screen.getByText('provider failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试 AI' }))
    fireEvent.click(screen.getByRole('button', { name: '结束并新建' }))
    expect(actions.retryBlocked).toHaveBeenCalledOnce()
    expect(actions.resetMatch).toHaveBeenCalledTimes(2)

    view.rerender(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: {} }, match: { ...waiting, status: 'abandoned', window: undefined },
      providers: [provider], audit: undefined, busy: false, ...actions,
    } as unknown as Parameters<typeof RpsSurface>[0])} />)
    expect(screen.getByText('对局已结束')).toBeTruthy()
    expect(screen.getAllByText('已结束')).toHaveLength(2)
  })

  it('reveals completed rounds and terminal winners', () => {
    const actions = operations()
    const finished: GameRemoteMatchView = {
      id: 'm', gameId: 'rps', revision: 3, status: 'finished', seats, blockedSeats: [],
      game: {
        roundCount: 3,
        rounds: [
          { number: 1, choices: { human: 'rock', ai: 'paper' }, winner: 'ai' },
          { number: 2, choices: { human: 'scissors' }, winner: null },
          { number: 3, choices: { human: 'unknown', ai: 'rock' }, winner: 'missing' },
        ],
        scores: { human: 0, ai: 1 }, winner: null,
      },
    }
    const view = render(<RpsSurface {...({
      game: { id: 'rps', rulesVersion: 1, configSchema: {} }, match: finished, providers: [provider], audit: undefined, busy: false, ...actions,
    } as Parameters<typeof RpsSurface>[0])} />)
    expect(screen.getByText('本场平局')).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.textContent === '你：—')).toBeTruthy()
    expect(screen.getByText((_text, element) => element?.textContent === 'AI：—')).toBeTruthy()
    expect(screen.getByText('AI胜')).toBeTruthy()
    expect(screen.getByText('胜者胜')).toBeTruthy()
    view.rerender(<RpsSurface {...{
      game: { id: 'rps', rulesVersion: 1, configSchema: {} },
      match: { ...finished, game: { ...(finished.game as object), winner: 'missing' } },
      providers: [provider], busy: false, ...actions,
    }} />)
    expect(screen.getByText('胜者获胜')).toBeTruthy()
  })
})
