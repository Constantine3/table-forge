import type { GameRemoteMatchView, GameWireJson } from '@deepseek-ai/dsh-game/types'
import type { GameAudit, GameAuditActionEntry, GameAuditEntry } from './GameApp.tsx'
import css from './GameAuditTimeline.module.css'

/** Fields needed to label one player in an audit timeline. */
export type GameAuditSeat = GameRemoteMatchView['seats'][number]

/** Props for the shared post-finish AI audit timeline. */
export interface GameAuditTimelineProps {
  readonly audit: GameAudit
  readonly seats: readonly GameAuditSeat[]
}

const asRecord = (value: GameWireJson): Readonly<Record<string, GameWireJson>> | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, GameWireJson>>
    : undefined
)

const seatName = (seats: readonly GameAuditSeat[], seatId: string): string => (
  seats.find(seat => seat.id === seatId)?.displayName ?? seatId
)

const stageLabel = (actionType: string | undefined): string => {
  if (actionType === 'propose-team') return '组队提案'
  if (actionType === 'make-statement') return '投票前发言'
  if (actionType === 'make-evil-statement') return '刺杀前密谈'
  if (actionType === 'vote-team') return '队伍投票'
  if (actionType === 'quest') return '任务行动'
  if (actionType === 'assassinate') return '刺杀决策'
  if (actionType === 'choice') return '猜拳决策'
  return '游戏决策'
}

const kindLabel = (entry: GameAuditEntry): string => {
  if (entry.kind === 'reasoning') return '分析'
  if (entry.kind !== 'action') return '自然语言输出'
  if (entry.accepted === true) return '已接受动作'
  if (entry.accepted === false) return '失败动作'
  return '动作状态未知'
}

const actionDescription = (entry: GameAuditActionEntry, seats: readonly GameAuditSeat[]): string => {
  const action = asRecord(entry.action)
  if (action?.['type'] === 'propose-team' && Array.isArray(action['team'])) {
    const team = action['team'].map(candidate => seatName(seats, String(candidate))).join('、')
    const direction = action['direction'] === 'clockwise' ? '顺时针' : '逆时针'
    return `提交队伍：${team}；发言方向：${direction}`
  }
  if (action?.['type'] === 'make-statement' && typeof action['statement'] === 'string') {
    if (Array.isArray(action['team'])) {
      const team = action['team'].map(candidate => seatName(seats, String(candidate))).join('、')
      return `归票发言：“${action['statement']}”；最终队伍：${team}`
    }
    return `公开发言：“${action['statement']}”`
  }
  if (action?.['type'] === 'make-evil-statement' && typeof action['statement'] === 'string') {
    return `邪方密谈：“${action['statement']}”`
  }
  if (action?.['type'] === 'vote-team') return '已提交匿名队伍投票；具体选择不进入审计展示'
  if (action?.['type'] === 'quest') return `任务动作：${action['outcome'] === 'success' ? '成功' : '失败'}`
  if (action?.['type'] === 'assassinate' && typeof action['target'] === 'string') {
    return `刺杀目标：${seatName(seats, action['target'])}`
  }
  if (action?.['choice'] === 'rock') return '选择：石头'
  if (action?.['choice'] === 'paper') return '选择：布'
  if (action?.['choice'] === 'scissors') return '选择：剪刀'
  return JSON.stringify(entry.action, null, 2)
}

const clock = (time: number): string => new Date(time).toLocaleTimeString('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

/** Render one cross-seat timeline with speaker, stage, model turn, and event time on every entry.
 * @param props - loaded audit entries and match seat labels.
 * @returns an expanded audit disclosure, including unavailable-session diagnostics.
 */
export function GameAuditTimeline({ audit, seats }: GameAuditTimelineProps) {
  return <details className={css.audit} open>
    <summary>AI 审计时间线（{audit.entries.length} 条）</summary>
    <p className={css.explainer}>按持久化事件时间排列；“分析”是模型私有推理，“动作”是模型调用游戏工具的参数，规则声明为匿名的决策内容会脱敏。</p>
    {audit.unavailableSeatIds.length > 0 && <p className={css.warning}>
      未能读取：{audit.unavailableSeatIds.map(seatId => seatName(seats, seatId)).join('、')}
    </p>}
    {audit.entries.length === 0
      ? <p className={css.empty}>没有可读取的 AI 审计条目。</p>
      : <ol className={css.timeline}>{audit.entries.map((entry, index) => <li
        key={`${entry.seatId}:${entry.eventSeq}:${entry.kind}:${index}`}
        data-kind={entry.kind}
      >
        <article>
          <header>
            <span className={css.sequence}>#{index + 1}</span>
            <strong>{seatName(seats, entry.seatId)}</strong>
            <span>{stageLabel(entry.actionType)}</span>
            <span>{kindLabel(entry)}</span>
            <time dateTime={new Date(entry.time).toISOString()}>{clock(entry.time)} · 模型回合 {entry.turn}</time>
          </header>
          {entry.kind === 'action'
            ? <p>{actionDescription(entry, seats)}</p>
            : <pre>{entry.text}</pre>}
        </article>
      </li>)}</ol>}
  </details>
}
