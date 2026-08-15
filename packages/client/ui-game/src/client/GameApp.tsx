import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GameRemoteCreateRequest, GameRemoteMatchView,
  GameRemoteSubmitRequest,
} from '@deepseek-ai/dsh-game/types'
import css from './GameApp.module.css'

interface GameAppState {
  match: GameRemoteMatchView | undefined
  matches: readonly GameRemoteMatchView[]
  providers: readonly GameProviderOption[]
  audit: readonly { readonly seatId: string; readonly entries: readonly { readonly kind: 'reasoning' | 'answer'; readonly text: string }[] }[]
  rpsSetup: RpsSetup | undefined
  busy: boolean
  error: string | undefined
}

/** Deployment-resolved RPS setup limits. */
export interface RpsSetup {
  defaultRounds: number
  maxRounds: number
}

/** One configured provider and its game model. */
export interface GameProviderOption {
  id: string
  name: string
  model: string
  available: boolean
  message?: string
}

/** Registration-time game actions and observable state. */
export interface GameAppInjected {
  hooks: { game: SnapshotStore<GameAppState> }
  createMatch: (request: GameRemoteCreateRequest) => Promise<void>
  submitAction: (request: GameRemoteSubmitRequest) => Promise<void>
  resetMatch: () => Promise<void>
  openMatch: (id: string) => Promise<void>
  retrySeat: (seatId: string) => Promise<void>
}

/** Root-slot runtime props plus the game plugin's injected face. */
export type GameAppProps = PropsRuntime<'root'> & InjectFace<GameAppInjected>

interface RpsRound { number: number; choices: Record<string, string>; winner: string | null }
interface RpsView { roundCount: number; rounds: RpsRound[]; scores: Record<string, number>; winner: string | null }

const AGENT_NAMES = ['AI 一号', 'AI 二号'] as const

const agentSeat = (id: string, index: 0 | 1, provider: GameProviderOption) => ({
  id,
  displayName: AGENT_NAMES[index],
  controller: {
    type: 'agent' as const,
    provider: provider.id,
    model: provider.model,
  },
})

const choiceLabel = (choice: string | undefined): string => {
  if (choice === 'rock') return '石头'
  if (choice === 'paper') return '布'
  if (choice === 'scissors') return '剪刀'
  return '—'
}

/**
 * Render match setup and the rock-paper-scissors table.
 * @param props - root runtime and injected game operations.
 * @returns the complete game product view.
 */
export function GameApp({ useGame, createMatch, submitAction, resetMatch, openMatch, retrySeat }: GameAppProps) {
  const { match, matches, providers, audit, rpsSetup, busy, error } = useGame(state => state)
  const [mode, setMode] = useState<'human-ai' | 'ai-ai'>('human-ai')
  const [roundCount, setRoundCount] = useState<number>()
  const [providerIds, setProviderIds] = useState<[string, string]>(['', ''])

  const providerFor = (index: 0 | 1): GameProviderOption | undefined => {
    return providers.find(provider => provider.id === providerIds[index] && provider.available)
      ?? providers.find(provider => provider.available)
  }
  const updateProvider = (index: 0 | 1, provider: string): void => {
    setProviderIds(current => current.map((value, position) => position === index ? provider : value) as [string, string])
  }
  const create = (): void => {
    const first = providerFor(0)
    const second = providerFor(1)
    /* v8 ignore next -- the disabled setup button prevents stale incomplete setup from invoking this handler. */
    if (first === undefined || (mode === 'ai-ai' && second === undefined)) return
    /* v8 ignore next -- AI-AI setup requires both providers above; human-AI does not evaluate the second arm. */
    const seats = mode === 'human-ai'
      ? [{ id: 'human', displayName: '你', controller: { type: 'human' as const } }, agentSeat('ai-1', 0, first)]
      : [agentSeat('ai-1', 0, first), agentSeat('ai-2', 1, second ?? first)]
    /* v8 ignore next -- the disabled setup button prevents stale unresolved setup from invoking this handler. */
    if (rpsSetup === undefined) return
    void createMatch({ gameId: 'rps', config: { roundCount: roundCount ?? rpsSetup.defaultRounds }, seats })
  }
  const choose = (choice: string): void => {
    /* v8 ignore next -- choice controls render only while the selected match has an open window. */
    if (match?.window === undefined) return
    void submitAction({
      matchId: match.id,
      windowId: match.window.id,
      commandId: crypto.randomUUID(),
      action: { choice },
    })
  }

  const game = match?.game as unknown as RpsView | undefined
  const humanCanAct = match?.status === 'active' && match.window?.requiredSeats.includes('human') === true
    && !match.window.submittedSeats.includes('human')

  return (
    <main className={css.app}>
      <header><span className={css.brand}>TABLE FORGE</span><span className={css.tag}>LLM 原生游戏引擎</span></header>
      {match === undefined ? (
        <section className={css.setup}>
          <p className={css.eyebrow}>首个游戏</p>
          <h1>剪刀 · 石头 · 布</h1>
          <p className={css.lead}>配置牌桌与 AI 席位；模型只负责决策，确定性的规则引擎负责裁定。</p>
          <div className={css.segmented}>
            <button data-active={mode === 'human-ai'} onClick={() => { setMode('human-ai') }}>你对 AI</button>
            <button data-active={mode === 'ai-ai'} onClick={() => { setMode('ai-ai') }}>AI 对 AI</button>
          </div>
          <label>总局数<input type="number" min={1} max={rpsSetup?.maxRounds} value={roundCount ?? rpsSetup?.defaultRounds ?? ''} onChange={(event) => { setRoundCount(Number(event.target.value)) }} /></label>
          {AGENT_NAMES.slice(0, mode === 'human-ai' ? 1 : 2).map((_agent, rawIndex) => {
            const index = rawIndex as 0 | 1
            return <fieldset key={index}><legend>{mode === 'human-ai' ? 'AI 对手' : `AI 席位 ${index + 1}`}</legend>
              <label>提供方<select value={providerFor(index)?.id ?? ''} onChange={(event) => { updateProvider(index, event.target.value) }}>
                {providers.map(provider => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.name}{provider.available ? '' : '（当前不可用）'}</option>)}
              </select></label>
              {providerFor(index) === undefined && <p className={css.providerWarning}>没有从当前游戏主机可达的提供方。请连接局域网，或选择可用的云端提供方。</p>}
            </fieldset>
          })}
          <button className={css.primary} disabled={busy || !providers.some(provider => provider.available) || rpsSetup === undefined} onClick={create}>{busy ? '正在开桌…' : !providers.some(provider => provider.available) ? '没有可达的提供方' : rpsSetup === undefined ? '正在加载游戏…' : '开始对局'}</button>
          {matches.length > 0 && <div className={css.lobby}><h2>历史牌桌</h2>{matches.map(item => <button key={item.id} onClick={() => { void openMatch(item.id) }}><span>{item.status === 'active' ? '进行中' : item.status === 'blocked' ? '需要处理' : item.status === 'finished' ? '已完成' : '已结束'}</span><strong>{item.id.slice(0, 8)}</strong></button>)}</div>}
        </section>
      ) : (
        <section className={css.board}>
          <div className={css.boardHead}>
            <div><p className={css.eyebrow}>当前对局</p><h1>剪刀 · 石头 · 布</h1></div>
            <button className={css.quiet} disabled={busy} onClick={() => { void resetMatch() }}>新对局</button>
          </div>
          <div className={css.score}>{match.seats.map(seat => <div key={seat.id}><span>{seat.displayName}</span><strong>{game?.scores[seat.id] ?? 0}</strong><small>{match.window?.submittedSeats.includes(seat.id) ? '已锁定选择' : match.status === 'active' ? '正在选择…' : '已结束'}</small></div>)}</div>
          {humanCanAct && <div className={css.choices}>{([['rock', '石头', '●'], ['paper', '布', '▰'], ['scissors', '剪刀', '✦']] as const).map(([choice, label, symbol]) => <button key={choice} disabled={busy} onClick={() => { choose(choice) }}><span>{symbol}</span>{label}</button>)}</div>}
          {!humanCanAct && match.status === 'active' && match.blockedSeats.length === 0 && <div className={css.waiting}>AI 正在选择；本轮结束前，所有已提交动作都会保持封存。</div>}
          {match.blockedSeats.map(blocked => <div className={css.blocked} key={blocked.seatId}>
            <strong>{match.seats.find(seat => seat.id === blocked.seatId)?.displayName ?? blocked.seatId} 无法继续</strong>
            <p>{blocked.message}</p>
            <button disabled={busy} onClick={() => { void retrySeat(blocked.seatId) }}>重试该席位</button>
            <button disabled={busy} onClick={() => { void resetMatch() }}>结束并新建</button>
          </div>)}
          {match.status === 'abandoned' && <div className={css.result}>对局已结束</div>}
          {match.status === 'finished' && <div className={css.result}>{game?.winner === null ? '本场平局' : `${match.seats.find(seat => seat.id === game?.winner)?.displayName ?? '胜者'}获胜`}</div>}
          <div className={css.history}>{[...(game?.rounds ?? [])].reverse().map(round => <div key={round.number}><strong>第 {round.number} 局</strong>{match.seats.map(seat => <span key={seat.id}>{seat.displayName}：{choiceLabel(round.choices[seat.id])}</span>)}<em>{round.winner === null ? '平局' : `${match.seats.find(seat => seat.id === round.winner)?.displayName ?? '胜者'}胜`}</em></div>)}</div>
          {audit.length > 0 && <details className={css.audit}><summary>AI 审计记录</summary>{audit.map(seat => <section key={seat.seatId}><h3>{match.seats.find(item => item.id === seat.seatId)?.displayName ?? seat.seatId}</h3>{seat.entries.length === 0 ? <p>暂无模型记录</p> : seat.entries.map((entry, index) => <article key={index} data-kind={entry.kind}><strong>{entry.kind === 'reasoning' ? '分析' : '提交前回答'}</strong><pre>{entry.text}</pre></article>)}</section>)}</details>}
        </section>
      )}
      {error !== undefined && <div className={css.error} role="alert">{error}</div>}
    </main>
  )
}
