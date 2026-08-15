// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GameRemoteCreateRequest, GameRemoteSubmitRequest } from '@deepseek-ai/dsh-game/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameApp, type GameAppProps } from '../src/client/GameApp.tsx'

const provider = { id: 'local', name: 'Local', model: 'deepseek-v4-flash-vision', available: true }
const secondProvider = { id: 'cloud', name: 'Cloud', model: 'hy3', available: true }
const baseState = {
  match: undefined,
  providers: [provider],
  matches: [],
  audit: [],
  rpsSetup: { defaultRounds: 3, maxRounds: 9 },
  busy: false,
  error: undefined,
}

const mount = (state: Record<string, unknown>, actions = {
  createMatch: vi.fn((_request: GameRemoteCreateRequest) => Promise.resolve()),
  submitAction: vi.fn((_request: GameRemoteSubmitRequest) => Promise.resolve()),
  resetMatch: vi.fn(() => Promise.resolve()),
  openMatch: vi.fn((_id: string) => Promise.resolve()),
  retrySeat: vi.fn((_id: string) => Promise.resolve()),
}) => {
  const props = {
    useGame: (select: (value: unknown) => unknown) => select(state),
    ...actions,
  }
  return { ...render(<GameApp {...props as unknown as GameAppProps} />), actions }
}

afterEach(cleanup)

describe('game product view', () => {
  it('creates human-AI and AI-AI tables from deployment choices', () => {
    const first = mount(baseState)
    fireEvent.change(screen.getByLabelText('总局数'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))
    expect(first.actions.createMatch.mock.calls[0]![0].config).toEqual({ roundCount: 5 })
    expect(first.actions.createMatch.mock.calls[0]![0].seats.map(seat => seat.id)).toEqual(['human', 'ai-1'])
    first.unmount()

    const second = mount({ ...baseState, providers: [provider, secondProvider] })
    fireEvent.click(screen.getByRole('button', { name: 'AI 对 AI' }))
    const providerInputs = screen.getAllByLabelText('提供方')
    expect(providerInputs).toHaveLength(2)
    fireEvent.change(providerInputs[0]!, { target: { value: 'cloud' } })
    fireEvent.change(providerInputs[1]!, { target: { value: 'local' } })
    fireEvent.click(screen.getByRole('button', { name: '你对 AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 对 AI' }))
    fireEvent.click(screen.getByRole('button', { name: '开始对局' }))
    expect(second.actions.createMatch).toHaveBeenCalledWith(expect.objectContaining({
      seats: [expect.objectContaining({ id: 'ai-1' }), expect.objectContaining({ id: 'ai-2' })],
    }))
  })

  it('renders unavailable, loading, busy, and error setup states', () => {
    const { rerender } = mount({ ...baseState, providers: [], rpsSetup: undefined })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '没有可达的提供方' }).disabled).toBe(true)
    rerender(<GameApp {...({
      useGame: (select: (value: unknown) => unknown) => select({ ...baseState, rpsSetup: undefined }),
      createMatch: vi.fn(), submitAction: vi.fn(), resetMatch: vi.fn(),
    } as unknown as GameAppProps)} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在加载游戏…' }).disabled).toBe(true)
    rerender(<GameApp {...({
      useGame: (select: (value: unknown) => unknown) => select({ ...baseState, busy: true, error: 'failed' }),
      createMatch: vi.fn(), submitAction: vi.fn(), resetMatch: vi.fn(),
    } as unknown as GameAppProps)} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在开桌…' }).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('failed')
  })

  it('submits choices and renders completed round history', () => {
    const state = {
      ...baseState,
      match: {
        id: 'match', gameId: 'rps', revision: 4, status: 'active',
        seats: [
          { id: 'human', displayName: '你', controller: { type: 'human' } },
          { id: 'ai-1', displayName: 'AI 一号', controller: { type: 'agent', provider: 'local', model: 'm' } },
        ],
        window: { id: 'window', requiredSeats: ['human', 'ai-1'], submittedSeats: ['ai-1'] },
        blockedSeats: [],
        game: {
          scores: { human: 1, 'ai-1': 0 }, winner: null,
          rounds: [
            { number: 1, choices: { human: 'rock', 'ai-1': 'scissors' }, winner: 'human' },
            { number: 2, choices: { human: 'paper', 'ai-1': 'paper' }, winner: null },
          ],
        },
      },
    }
    const bench = mount(state)
    fireEvent.click(screen.getByRole('button', { name: /石头/ }))
    expect(bench.actions.submitAction).toHaveBeenCalledWith(expect.objectContaining({
      matchId: 'match', windowId: 'window', action: { choice: 'rock' },
    }))
    expect(screen.getByText('你：石头')).toBeTruthy()
    expect(screen.getByText('AI 一号：剪刀')).toBeTruthy()
    expect(screen.getAllByText('你：布')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '新对局' }))
    expect(bench.actions.resetMatch).toHaveBeenCalledOnce()
  })

  it.each([
    ['active', undefined, 'AI 正在选择；本轮结束前，所有已提交动作都会保持封存。'],
    ['abandoned', undefined, '对局已结束'],
    ['finished', null, '本场平局'],
    ['finished', 'ai-1', 'AI 一号获胜'],
  ])('renders the %s board outcome', (status, winner, expected) => {
    mount({
      ...baseState,
      match: {
        id: 'match', gameId: 'rps', revision: 5, status,
        seats: [{ id: 'ai-1', displayName: 'AI 一号', controller: { type: 'agent', provider: 'local', model: 'm' } }],
        blockedSeats: [],
        game: { scores: {}, rounds: [{ number: 1, choices: {}, winner: null }], winner },
      },
    })
    expect(screen.getByText(expected)).toBeTruthy()
    expect(screen.getByText('AI 一号：—')).toBeTruthy()
  })

  it('uses neutral winner labels when a persisted seat is unavailable', () => {
    mount({
      ...baseState,
      match: {
        id: 'match', gameId: 'rps', revision: 5, status: 'finished', seats: [], blockedSeats: [],
        game: { scores: {}, rounds: [{ number: 1, choices: {}, winner: 'removed' }], winner: 'removed' },
      },
    })
    expect(screen.getByText('胜者获胜')).toBeTruthy()
    expect(screen.getByText('胜者胜')).toBeTruthy()
  })

  it('renders a terminal board before optional game details arrive', () => {
    mount({
      ...baseState,
      match: { id: 'match', gameId: 'rps', revision: 1, status: 'abandoned', seats: [], blockedSeats: [], game: null },
    })
    expect(screen.getByText('对局已结束')).toBeTruthy()
  })
})
