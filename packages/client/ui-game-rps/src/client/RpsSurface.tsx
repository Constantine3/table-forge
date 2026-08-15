import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GameCatalogItemOwnerProps, GameProviderOption, GameSurfaceOwnerProps,
} from '@deepseek-ai/dsh-client-ui-game/client'
import css from './RpsSurface.module.css'

interface RpsRound { number: number; choices: Record<string, string>; winner: string | null }
interface RpsView { roundCount: number; rounds: RpsRound[]; scores: Record<string, number>; winner: string | null }

type CatalogProps = PropsRuntime<'game.catalog.item'> & GameCatalogItemOwnerProps
type SurfaceProps = GameSurfaceOwnerProps

const AGENT_NAMES = ['AI 一号', 'AI 二号'] as const

const agentSeat = (id: string, index: 0 | 1, provider: GameProviderOption) => ({
  id,
  displayName: AGENT_NAMES[index],
  controller: { type: 'agent' as const, provider: provider.id, model: provider.model },
})

const choiceLabel = (choice: string | undefined): string => {
  if (choice === 'rock') return '石头'
  if (choice === 'paper') return '布'
  if (choice === 'scissors') return '剪刀'
  return '—'
}

/** Render the RPS choice in the game catalog. */
export function RpsCatalogItem({ selectGame }: CatalogProps) {
  return <button className={css.catalogCard} onClick={() => { selectGame('rps') }}>
    <span>经典 · 同时行动</span><strong>剪刀 · 石头 · 布</strong><small>你对 AI，或观看两名 AI 对决</small>
  </button>
}

/** Render RPS setup and the active board. */
export function RpsSurface({
  game: gameInfo,
  match,
  providers,
  busy,
  createMatch,
  submitAction,
  resetMatch,
  retryBlocked,
}: SurfaceProps) {
  const [mode, setMode] = useState<'human-ai' | 'ai-ai'>('human-ai')
  const schema = gameInfo.configSchema as { properties?: { roundCount?: { default?: unknown; maximum?: unknown } } }
  const defaultRounds = Number(schema.properties?.roundCount?.default)
  const maxRounds = Number(schema.properties?.roundCount?.maximum)
  const [roundCount, setRoundCount] = useState(Number.isInteger(defaultRounds) ? defaultRounds : 3)
  const [providerIds, setProviderIds] = useState<[string, string]>(['', ''])
  const providerFor = (index: 0 | 1): GameProviderOption | undefined => (
    providers.find(provider => provider.id === providerIds[index] && provider.available)
      ?? providers.find(provider => provider.available)
  )
  const updateProvider = (index: 0 | 1, provider: string): void => {
    setProviderIds(current => current.map((value, position) => position === index ? provider : value) as [string, string])
  }
  const create = (): void => {
    const first = providerFor(0)
    const second = providerFor(1)
    /* v8 ignore next -- the start button is disabled while a required provider is unavailable. */
    if (first === undefined || (mode === 'ai-ai' && second === undefined)) return
    const seats = mode === 'human-ai'
      ? [{ id: 'human', displayName: '你', controller: { type: 'human' as const } }, agentSeat('ai-1', 0, first)]
      : [agentSeat('ai-1', 0, first), agentSeat('ai-2', 1, second as GameProviderOption)]
    void createMatch({ gameId: 'rps', config: { roundCount }, seats })
  }
  const choose = (choice: string): void => {
    /* v8 ignore next -- choice buttons render only for an actionable window. */
    if (match?.window === undefined) return
    void submitAction({ matchId: match.id, windowId: match.window.id, commandId: crypto.randomUUID(), action: { choice } })
  }
  const humanCanAct = match?.status === 'active' && match.window?.canAct === true

  if (match === undefined) return <section className={css.setup}>
    <p className={css.eyebrow}>经典同时行动</p><h1>剪刀 · 石头 · 布</h1>
    <p className={css.lead}>每轮动作会封存到两边都已选择，再由规则引擎同时揭晓。</p>
    <div className={css.segmented}>
      <button data-active={mode === 'human-ai'} onClick={() => { setMode('human-ai') }}>你对 AI</button>
      <button data-active={mode === 'ai-ai'} onClick={() => { setMode('ai-ai') }}>AI 对 AI</button>
    </div>
    <label>总局数<input
      type="number"
      min={1}
      max={Number.isInteger(maxRounds) ? maxRounds : undefined}
      value={roundCount}
      onChange={(event) => { setRoundCount(Number(event.target.value)) }}
    /></label>
    {AGENT_NAMES.slice(0, mode === 'human-ai' ? 1 : 2).map((_agent, rawIndex) => {
      const index = rawIndex as 0 | 1
      return <fieldset key={index}><legend>{mode === 'human-ai' ? 'AI 对手' : `AI 席位 ${index + 1}`}</legend>
        <label>提供方<select
          value={providerFor(index)?.id ?? ''}
          onChange={(event) => { updateProvider(index, event.target.value) }}
        >
          {providers.map(provider => <option key={provider.id} value={provider.id} disabled={!provider.available}>
            {provider.name}{provider.available ? '' : '（当前不可用）'}
          </option>)}
        </select></label>
        {providerFor(index) === undefined && <p className={css.warning}>没有从当前游戏主机可达的提供方。</p>}
      </fieldset>
    })}
    <button
      className={css.primary}
      disabled={busy || !Number.isInteger(maxRounds) || providerFor(0) === undefined
        || (mode === 'ai-ai' && providerFor(1) === undefined)}
      onClick={create}
    >{busy ? '正在开桌…' : '开始对局'}</button>
  </section>

  const game = match.game as unknown as RpsView
  return <section className={css.board}>
    <div className={css.boardHead}>
      <div><p className={css.eyebrow}>当前对局</p><h1>剪刀 · 石头 · 布</h1></div>
      <button className={css.quiet} disabled={busy} onClick={() => { void resetMatch() }}>新对局</button>
    </div>
    <div className={css.score}>{match.seats.map(seat => <div key={seat.id}>
      <span>{seat.displayName}</span><strong>{game.scores[seat.id] ?? 0}</strong>
      <small>{match.window?.submittedSeats.includes(seat.id)
        ? '已锁定选择'
        : match.status === 'active' ? '正在选择…' : '已结束'}</small>
    </div>)}</div>
    {humanCanAct && <div className={css.choices}>{([
      ['rock', '石头', '●'], ['paper', '布', '▰'], ['scissors', '剪刀', '✦'],
    ] as const).map(([choice, label, symbol]) => <button
      key={choice}
      disabled={busy}
      onClick={() => { choose(choice) }}
    ><span>{symbol}</span>{label}</button>)}</div>}
    {!humanCanAct && match.status === 'active' && match.blockedSeats.length === 0
      && <div className={css.waiting}>AI 正在选择；本轮结束前，已提交动作保持封存。</div>}
    {match.blockedSeats.length > 0 && <div className={css.blocked}>
      <strong>AI 无法继续</strong><p>{match.blockedSeats.map(item => item.message).join('；')}</p>
      <button disabled={busy} onClick={() => { void retryBlocked() }}>重试 AI</button>
      <button disabled={busy} onClick={() => { void resetMatch() }}>结束并新建</button>
    </div>}
    {match.status === 'abandoned' && <div className={css.result}>对局已结束</div>}
    {match.status === 'finished' && <>
      <div className={css.result}>{game.winner === null
        ? '本场平局'
        : `${match.seats.find(seat => seat.id === game.winner)?.displayName ?? '胜者'}获胜`}</div>
    </>}
    <div className={css.history}>{[...game.rounds].reverse().map(round => <div key={round.number}>
      <strong>第 {round.number} 局</strong>
      {match.seats.map(seat => <span key={seat.id}>
        {seat.displayName}：{choiceLabel(round.choices[seat.id])}
      </span>)}
      <em>{round.winner === null
        ? '平局'
        : `${match.seats.find(seat => seat.id === round.winner)?.displayName ?? '胜者'}胜`}</em>
    </div>)}</div>
  </section>
}
