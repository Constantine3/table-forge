// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { GameAudit, GameAuditEntry } from '../src/client/GameApp.tsx'
import { GameAuditTimeline } from '../src/client/GameAuditTimeline.tsx'

const seats = [
  { id: 'ai-1', displayName: 'AI 一号', controller: { type: 'agent' as const, provider: 'p', model: 'm' } },
  { id: 'human', displayName: '你', controller: { type: 'human' as const } },
]

const base = (eventSeq: number, actionType: string | undefined) => ({
  seatId: 'ai-1', actionType, time: Date.UTC(2026, 7, 15, 8, 9, eventSeq), turn: 4, eventSeq,
})

afterEach(cleanup)

describe('shared game AI audit timeline', () => {
  it('labels speakers, stages, outcomes, actions, time, and model turns in one ordered list', () => {
    const entries: GameAuditEntry[] = [
      { ...base(1, 'propose-team'), kind: 'reasoning', text: '先分析队伍。' },
      { ...base(2, undefined), seatId: 'missing', kind: 'answer', text: '未知阶段输出。' },
      {
        ...base(3, 'propose-team'), kind: 'action', accepted: true,
        action: { type: 'propose-team', team: ['human', 'missing'], direction: 'clockwise' },
      },
      {
        ...base(4, 'propose-team'), kind: 'action', accepted: false,
        action: { type: 'propose-team', team: [], direction: 'counterclockwise' },
      },
      {
        ...base(5, 'make-statement'), kind: 'action', accepted: true,
        action: { type: 'make-statement', statement: '我赞成这支队伍。' },
      },
      { ...base(6, 'vote-team'), kind: 'action', accepted: true, action: { type: 'vote-team', approve: true } },
      { ...base(7, 'vote-team'), kind: 'action', accepted: true, action: { type: 'vote-team', approve: false } },
      { ...base(8, 'quest'), kind: 'action', accepted: true, action: { type: 'quest', outcome: 'success' } },
      { ...base(9, 'quest'), kind: 'action', accepted: true, action: { type: 'quest', outcome: 'fail' } },
      {
        ...base(10, 'assassinate'), kind: 'action', accepted: true,
        action: { type: 'assassinate', target: 'human' },
      },
      { ...base(11, 'choice'), kind: 'action', accepted: true, action: { choice: 'rock' } },
      { ...base(12, 'choice'), kind: 'action', accepted: true, action: { choice: 'paper' } },
      { ...base(13, 'choice'), kind: 'action', accepted: true, action: { choice: 'scissors' } },
      { ...base(14, 'custom'), kind: 'action', accepted: undefined, action: null },
      {
        ...base(15, 'make-statement'), kind: 'action', accepted: false,
        action: { type: 'make-statement', statement: { invalid: true } },
      },
      {
        ...base(16, 'assassinate'), kind: 'action', accepted: false,
        action: { type: 'assassinate', target: null },
      },
      {
        ...base(17, 'make-evil-statement'), kind: 'action', accepted: true,
        action: { type: 'make-evil-statement', statement: '我认为二号更像梅林。' },
      },
      {
        ...base(18, 'make-evil-statement'), kind: 'action', accepted: false,
        action: { type: 'make-evil-statement', statement: null },
      },
      {
        ...base(19, 'make-statement'), kind: 'action', accepted: true,
        action: { type: 'make-statement', statement: '我调整最终队伍。', team: ['human', 'missing'] },
      },
    ]
    const audit: GameAudit = { entries, unavailableSeatIds: ['ai-1', 'unavailable'] }
    const view = render(<GameAuditTimeline audit={audit} seats={seats} />)

    expect(screen.getByText('AI 审计时间线（19 条）')).toBeTruthy()
    expect(screen.getAllByText('AI 一号').length).toBeGreaterThan(1)
    expect(screen.getByText('missing')).toBeTruthy()
    expect(screen.getByText('未能读取：AI 一号、unavailable')).toBeTruthy()
    for (const label of ['组队提案', '投票前发言', '刺杀前密谈', '队伍投票', '任务行动', '刺杀决策', '猜拳决策', '游戏决策']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    for (const label of ['分析', '自然语言输出', '已接受动作', '失败动作', '动作状态未知']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('提交队伍：你、missing；发言方向：顺时针')).toBeTruthy()
    expect(screen.getByText('提交队伍：；发言方向：逆时针')).toBeTruthy()
    expect(screen.getByText('公开发言：“我赞成这支队伍。”')).toBeTruthy()
    expect(screen.getByText('归票发言：“我调整最终队伍。”；最终队伍：你、missing')).toBeTruthy()
    expect(screen.getByText('邪方密谈：“我认为二号更像梅林。”')).toBeTruthy()
    expect(screen.getAllByText('已提交匿名队伍投票；具体选择不进入审计展示')).toHaveLength(2)
    expect(screen.queryByText('队伍投票：赞成')).toBeNull()
    expect(screen.queryByText('队伍投票：否决')).toBeNull()
    expect(screen.getByText('任务动作：成功')).toBeTruthy()
    expect(screen.getByText('任务动作：失败')).toBeTruthy()
    expect(screen.getByText('刺杀目标：你')).toBeTruthy()
    expect(screen.getByText('选择：石头')).toBeTruthy()
    expect(screen.getByText('选择：布')).toBeTruthy()
    expect(screen.getByText('选择：剪刀')).toBeTruthy()
    expect(screen.getByText('null')).toBeTruthy()
    expect(screen.getAllByText(/模型回合 4/)).toHaveLength(entries.length)
    expect(view.container.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-15T08:09:01.000Z')
  })

  it('shows a loaded empty state without asking the user to load again', () => {
    render(<GameAuditTimeline audit={{ entries: [], unavailableSeatIds: [] }} seats={seats} />)
    expect(screen.getByText('AI 审计时间线（0 条）')).toBeTruthy()
    expect(screen.getByText('没有可读取的 AI 审计条目。')).toBeTruthy()
  })
})
