import { useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GameCatalogItemOwnerProps, GameProviderOption, GameSurfaceOwnerProps,
} from '@deepseek-ai/dsh-client-ui-game/client'
import type { GameWireJson } from '@deepseek-ai/dsh-game/types'
import css from './AvalonSurface.module.css'

type CatalogProps = PropsRuntime<'game.catalog.item'> & GameCatalogItemOwnerProps
type SurfaceProps = GameSurfaceOwnerProps

type AvalonSpeechDirection = 'clockwise' | 'counterclockwise'
type AvalonRole = 'merlin' | 'loyal-servant' | 'assassin' | 'minion'
type AvalonPlayerCount = 5 | 6
type AvalonMode = 'human-ai' | 'ai-only'

interface AvalonProposal { leader: string; team: string[]; direction: AvalonSpeechDirection }
interface AvalonStatement { seatId: string; statement: string }
interface AvalonVoteRecord {
  proposal: AvalonProposal
  statements: AvalonStatement[]
  approveCount: number
  rejectCount: number
  approved: boolean
}
interface AvalonMission { number: number; team: string[]; failCount: number; success: boolean }
interface AvalonView {
  phase: 'proposal' | 'discussion' | 'team-vote' | 'quest' | 'evil-discussion' | 'assassination' | 'finished'
  playerCount: AvalonPlayerCount
  missionSizes: [number, number, number, number, number]
  leader: string
  missionNumber: number
  teamSize: number
  rejectedTeams: number
  score: { good: number; evil: number }
  proposal: AvalonProposal | null
  statements: AvalonStatement[]
  evilDiscussion?: AvalonStatement[]
  evilSpeaker?: string
  teamVotes: AvalonVoteRecord[]
  missions: AvalonMission[]
  private?: { role: string; alignment: 'good' | 'evil'; knownPlayers: Array<{ seatId: string; alignment?: string; role?: string }> }
  winner?: 'good' | 'evil'
  finishReason?: string
  roles?: Record<string, string>
  assassinationTarget?: string | null
}

interface ActionSchema {
  properties?: {
    team?: { minItems?: number }
    statement?: { maxLength?: number }
    outcome?: { enum?: string[] }
    target?: { enum?: string[] }
  }
}

const roleLabel = (role: string | undefined): string => {
  if (role === 'merlin') return '梅林'
  if (role === 'assassin') return '刺客'
  if (role === 'minion') return '莫德雷德的爪牙'
  if (role === 'loyal-servant') return '亚瑟的忠臣'
  return '未知角色'
}

const finishLabel = (reason: string | undefined): string => {
  if (reason === 'merlin-assassinated') return '刺客找到了梅林'
  if (reason === 'merlin-survived') return '梅林避开了刺杀'
  if (reason === 'three-failed-quests') return '三次任务失败'
  if (reason === 'five-rejected-teams') return '连续五支队伍被否决'
  return '对局结束'
}

const directionLabel = (direction: AvalonSpeechDirection): string => (
  direction === 'clockwise' ? '顺时针' : '逆时针'
)

const providerAt = (
  providers: readonly GameProviderOption[],
  selected: string,
): GameProviderOption | undefined => (
  providers.find(provider => provider.id === selected && provider.available)
    ?? providers.find(provider => provider.available)
)

const seatPosition = (index: number, count: number): { left: string; top: string } => {
  const angle = Math.PI / 2 + index * 2 * Math.PI / count
  return {
    left: `${50 + Math.cos(angle) * 38}%`,
    top: `${50 + Math.sin(angle) * 38}%`,
  }
}

/** Render the Avalon choice in the game catalog. */
export function AvalonCatalogItem({ selectGame }: CatalogProps) {
  return <button className={css.catalogCard} onClick={() => { selectGame('avalon') }}>
    <span>五至六人 · 隐藏身份</span><strong>阿瓦隆</strong><small>亲自参与，或观看 AI 在任务与谎言中推演</small>
  </button>
}

/** Render five- or six-player Avalon setup and the active board. */
export function AvalonSurface({
  match,
  providers,
  busy,
  createMatch,
  submitAction,
  resetMatch,
  retryBlocked,
}: SurfaceProps) {
  const [mode, setMode] = useState<AvalonMode>('human-ai')
  const [playerCount, setPlayerCount] = useState<AvalonPlayerCount>(6)
  const [providerIds, setProviderIds] = useState<string[]>(['', '', '', '', '', ''])
  const [humanRole, setHumanRole] = useState<AvalonRole | ''>('')
  const [team, setTeam] = useState<string[]>([])
  const [finalTeam, setFinalTeam] = useState<string[] | undefined>()
  const [direction, setDirection] = useState<AvalonSpeechDirection | ''>('')
  const [statement, setStatement] = useState('')
  const aiSeatCount = playerCount - (mode === 'human-ai' ? 1 : 0)
  const selectedProviders = providerIds.slice(0, aiSeatCount).map(id => providerAt(providers, id))
  const create = (): void => {
    /* v8 ignore next -- the setup button is disabled while any AI provider is unavailable. */
    if (selectedProviders.some(provider => provider === undefined)) return
    const availableProviders = selectedProviders.filter(
      (provider): provider is GameProviderOption => provider !== undefined,
    )
    const aiSeats = availableProviders.map((provider, index) => ({
      id: `ai-${index + 1}`,
      displayName: `AI ${index + 1}`,
      controller: { type: 'agent' as const, provider: provider.id, model: provider.model },
    }))
    void createMatch({
      gameId: 'avalon',
      config: { playerCount, ...(mode === 'human-ai' && humanRole !== '' ? { humanRole } : {}) },
      seats: mode === 'human-ai'
        ? [{ id: 'human', displayName: '你', controller: { type: 'human' } }, ...aiSeats]
        : aiSeats,
    })
  }
  const submit = (action: Record<string, GameWireJson>): void => {
    /* v8 ignore next -- action controls render only while an actionable window exists. */
    if (match?.window === undefined) return
    void submitAction({ matchId: match.id, windowId: match.window.id, commandId: crypto.randomUUID(), action })
    setStatement('')
    setTeam([])
    setFinalTeam(undefined)
    setDirection('')
  }

  if (match === undefined) return <section className={css.setup}>
    <p className={css.eyebrow}>五至六人基础局</p><h1>阿瓦隆</h1>
    <p className={css.lead}>选择参与方式和圆桌人数，并为每名 AI 分别选择模型提供方。</p>
    <div className={css.segmented}>
      <button data-active={mode === 'human-ai'} onClick={() => { setMode('human-ai') }}>你与 AI</button>
      <button data-active={mode === 'ai-only'} onClick={() => { setMode('ai-only') }}>全 AI 对局</button>
    </div>
    <label>游戏人数
      <select aria-label="游戏人数" value={playerCount} onChange={(event) => {
        setPlayerCount(Number(event.target.value) as AvalonPlayerCount)
      }}>
        <option value={5}>五人局</option>
        <option value={6}>六人局</option>
      </select>
    </label>
    <div className={css.roles}>
      <span>梅林</span><span>刺客</span><span>忠臣 × {playerCount - 3}</span><span>爪牙</span>
    </div>
    {mode === 'human-ai' && <label>你的角色
      <select aria-label="你的角色" value={humanRole} onChange={(event) => {
        setHumanRole(event.target.value as AvalonRole | '')
      }}>
        <option value="">随机分配</option>
        <option value="merlin">梅林</option>
        <option value="loyal-servant">亚瑟的忠臣</option>
        <option value="assassin">刺客</option>
        <option value="minion">莫德雷德的爪牙</option>
      </select>
    </label>}
    <div className={css.providerGrid}>{providerIds.slice(0, aiSeatCount).map((selected, index) => <label key={index}>
      AI 席位 {index + 1}
      <select
        aria-label={`AI 席位 ${index + 1}`}
        value={providerAt(providers, selected)?.id ?? ''}
        onChange={(event) => {
          setProviderIds(current => current.map((value, position) => (
            position === index ? event.target.value : value
          )))
        }}
      >
        {providers.map(provider => <option key={provider.id} value={provider.id} disabled={!provider.available}>
          {provider.name}{provider.available ? '' : '（当前不可用）'}
        </option>)}
      </select>
    </label>)}</div>
    {!providers.some(provider => provider.available) && <p className={css.warning}>没有从当前游戏主机可达的提供方。</p>}
    <button
      className={css.primary}
      disabled={busy || selectedProviders.some(provider => provider === undefined)}
      onClick={create}
    >{busy ? '正在分配身份…' : '进入圆桌'}</button>
  </section>

  const game = match.game as unknown as AvalonView
  const schema = match.window?.actionSchema as ActionSchema | undefined
  const canAct = match.status === 'active' && match.window?.canAct === true
  const teamSize = schema?.properties?.team?.minItems ?? game.teamSize
  const statementLimit = schema?.properties?.statement?.maxLength ?? 280
  const currentSpeakerId = game.phase === 'discussion'
    ? match.window?.requiredSeats[0]
    : game.phase === 'evil-discussion' ? game.evilSpeaker : undefined
  const currentSpeakerName = match.seats.find(seat => seat.id === currentSpeakerId)?.displayName
  const humanSeatId = match.seats.find(seat => seat.controller.type === 'human')?.id
  const leaderIsCurrentSpeaker = game.phase === 'discussion' && currentSpeakerId === game.leader
  const assassinSeatId = game.private?.role === 'assassin'
    ? humanSeatId
    : game.private?.knownPlayers.find(player => player.role === 'assassin')?.seatId
  const assassinIsCurrentSpeaker = game.phase === 'evil-discussion'
    && currentSpeakerId === assassinSeatId
  const selectedTeam = leaderIsCurrentSpeaker ? finalTeam ?? (game.proposal as AvalonProposal).team : team
  const updatedTeam = (current: readonly string[], seatId: string): string[] => (
    current.includes(seatId)
      ? current.filter(id => id !== seatId)
      : current.length < teamSize ? [...current, seatId] : [...current]
  )
  const toggleTeam = (seatId: string): void => {
    if (leaderIsCurrentSpeaker) {
      setFinalTeam(current => updatedTeam(current ?? (game.proposal as AvalonProposal).team, seatId))
      return
    }
    setTeam(current => updatedTeam(current, seatId))
  }

  return <section className={css.board}>
    <div className={css.boardHead}>
      <div><p className={css.eyebrow}>第 {game.missionNumber} 次任务</p><h1>阿瓦隆</h1></div>
      <button type="button" className={css.quiet} disabled={busy} onClick={() => { void resetMatch() }}>结束对局</button>
    </div>
    {game.private !== undefined && <aside className={css.identity}>
      <span>你的身份</span><strong>{roleLabel(game.private.role)}</strong>
      <small>{game.private.alignment === 'good' ? '善方' : '邪方'}</small>
      {game.private.knownPlayers.length > 0 && <p>你知道：{game.private.knownPlayers.map((known) => {
        const name = match.seats.find(seat => seat.id === known.seatId)?.displayName ?? known.seatId
        return `${name}${known.role === undefined ? '' : `（${roleLabel(known.role)}）`}`
      }).join('、')}</p>}
    </aside>}
    <div className={css.tableLayout}>
      <div className={css.missions} aria-label="任务进度">{game.missionSizes.map((missionSize, index) => <div
        key={index}
        data-result={game.missions[index]?.success === true
          ? 'success'
          : game.missions[index]?.success === false ? 'fail' : 'pending'}
      ><span>{index + 1}</span><strong>{missionSize} 人</strong>
        {game.missions[index] !== undefined && <small>{game.missions[index].success
          ? '成功'
          : `失败 · ${game.missions[index].failCount} 票`}</small>}
      </div>)}</div>
      <div className={css.tableColumn}>
        <p className={css.rotationHint}>队长轮换顺序（顺时针）</p>
        <div className={css.seats} data-layout="circle">{match.seats.map((seat, index) => <button
          type="button"
          key={seat.id}
          data-position={index}
          style={seatPosition(index, match.seats.length)}
          data-leader={seat.id === game.leader}
          data-speaking={seat.id === currentSpeakerId}
          data-selected={selectedTeam.includes(seat.id)}
          disabled={!canAct || (game.phase !== 'proposal' && !leaderIsCurrentSpeaker)}
          onClick={() => { toggleTeam(seat.id) }}
        >
          <span>{seat.id === game.leader ? '队长' : seat.id === currentSpeakerId ? '正在发言' : '圆桌成员'}</span>
          <strong>{seat.displayName}</strong>
          {game.roles?.[seat.id] !== undefined && <small>{roleLabel(game.roles[seat.id])}</small>}
        </button>)}
        <div className={css.tableCenter}>
          {game.phase === 'evil-discussion'
            ? <><strong>刺杀前密谈</strong><span>{currentSpeakerName === undefined
              ? '邪方正在私下讨论'
              : `${currentSpeakerName}${assassinIsCurrentSpeaker ? '总结' : '发言'}`}</span></>
            : game.phase === 'assassination'
              ? <><strong>最终抉择</strong><span>目标正在私下选择</span></>
              : game.phase === 'finished'
                ? <><strong>身份揭晓</strong><span>全部角色已经公开</span></>
                : game.proposal === null
                  ? <><strong>圆桌</strong><span>队长组队中</span></>
                  : <>
                    <strong>{directionLabel(game.proposal.direction)} <span aria-hidden="true">
                      {game.proposal.direction === 'clockwise' ? '↻' : '↺'}
                    </span></strong>
                    <span>{game.phase === 'discussion'
                      ? leaderIsCurrentSpeaker ? '队长归票发言' : `${currentSpeakerName ?? '下一位成员'}发言`
                      : game.phase === 'team-vote' ? '公开发言完成' : '本轮发言方向'}</span>
                  </>}
        </div>
        </div>
      </div>
    </div>
    {game.proposal !== null && <article className={css.proposal}>
      <strong>{game.phase === 'discussion'
        ? `${match.seats.find(seat => seat.id === game.proposal?.leader)?.displayName} 初选`
        : '最终队伍'}</strong>
      <span>{game.proposal.team.map(id => match.seats.find(seat => seat.id === id)?.displayName).join('、')}
        {' · '}{directionLabel(game.proposal.direction)}发言</span>
    </article>}
    {(game.phase === 'discussion' || game.phase === 'team-vote') && <section className={css.discussion}>
      <h2>投票前发言</h2>
      {game.statements.length === 0 && <p className={css.emptyStatement}>等待第一位圆桌成员发言。</p>}
      {game.statements.map(item => <p key={item.seatId}>
        <strong>{match.seats.find(seat => seat.id === item.seatId)?.displayName ?? item.seatId}</strong>
        <span>“{item.statement}”</span>
      </p>)}
    </section>}
    {(game.evilDiscussion !== undefined || game.evilSpeaker !== undefined) && <section className={css.discussion}>
      <h2>刺杀前密谈</h2>
      {(game.evilDiscussion?.length ?? 0) === 0
        && <p className={css.emptyStatement}>等待第一位邪方玩家发言。</p>}
      {game.evilDiscussion?.map(item => <p key={item.seatId}>
        <strong>{match.seats.find(seat => seat.id === item.seatId)?.displayName ?? item.seatId}</strong>
        <span>“{item.statement}”</span>
      </p>)}
    </section>}
    {canAct && game.phase === 'proposal' && <div className={css.action}>
      <h2>组建 {teamSize} 人任务队</h2>
      <p>指定相邻席位开始发言的方向；其他成员依次发言后，你最后归票。</p>
      <div className={css.directionButtons}>
        <button type="button" aria-pressed={direction === 'clockwise'} onClick={() => { setDirection('clockwise') }}>
          <span aria-hidden="true">↻</span> 顺时针
        </button>
        <button type="button" aria-pressed={direction === 'counterclockwise'} onClick={() => { setDirection('counterclockwise') }}>
          <span aria-hidden="true">↺</span> 逆时针
        </button>
      </div>
      <button
        className={css.primary}
        disabled={busy || team.length !== teamSize || direction === ''}
        onClick={() => { submit({ type: 'propose-team', team, direction }) }}
      >提交队伍</button>
    </div>}
    {canAct && game.phase === 'discussion' && <div className={css.action}>
      <h2>{leaderIsCurrentSpeaker ? '队长归票发言' : '轮到你发言'}</h2>
      {leaderIsCurrentSpeaker && <p>可根据其他 {game.playerCount - 1} 名玩家的发言保留或调整初选队伍；当前选中的席位会成为最终投票队伍。</p>}
      <textarea
        maxLength={statementLimit}
        value={statement}
        placeholder={leaderIsCurrentSpeaker ? '总结本轮讨论并完成归票发言' : '在投票前公开发表看法'}
        onChange={(event) => { setStatement(event.target.value) }}
      />
      <button
        className={css.primary}
        disabled={busy || statement.trim().length === 0 || (leaderIsCurrentSpeaker && selectedTeam.length !== teamSize)}
        onClick={() => { submit(leaderIsCurrentSpeaker
          ? { type: 'make-statement', statement, team: selectedTeam }
          : { type: 'make-statement', statement }) }}
      >{leaderIsCurrentSpeaker ? '发表归票并确定队伍' : '发表发言'}</button>
    </div>}
    {canAct && game.phase === 'evil-discussion' && <div className={css.action}>
      <h2>{assassinIsCurrentSpeaker ? '刺客总结' : '邪方发言'}</h2>
      <p>{assassinIsCurrentSpeaker ? '总结邪方判断；提交后再选择刺杀目标。' : '向刺客说明你判断的梅林候选。'}</p>
      <textarea
        maxLength={statementLimit}
        value={statement}
        placeholder={assassinIsCurrentSpeaker ? '总结讨论并说明刺杀判断' : '私下向刺客提供判断'}
        onChange={(event) => { setStatement(event.target.value) }}
      />
      <button
        className={css.primary}
        disabled={busy || statement.trim().length === 0}
        onClick={() => { submit({ type: 'make-evil-statement', statement }) }}
      >{assassinIsCurrentSpeaker ? '提交刺客总结' : '提交邪方发言'}</button>
    </div>}
    {canAct && game.phase === 'team-vote' && <div className={css.action}>
      <h2>提交匿名投票</h2><p>{game.playerCount} 名玩家已经完成公开发言。全部提交后只公开赞成与否决票数。</p>
      <div className={css.voteButtons}>
        <button
          disabled={busy}
          onClick={() => { submit({ type: 'vote-team', approve: false }) }}
        >否决</button>
        <button
          disabled={busy}
          onClick={() => { submit({ type: 'vote-team', approve: true }) }}
        >赞成</button>
      </div>
    </div>}
    {canAct && game.phase === 'quest' && <div className={css.action}>
      <h2>执行任务</h2><p>任务动作会保持封存，结算只公开失败票数量。</p>
      <div className={css.voteButtons}>
        {schema?.properties?.outcome?.enum?.includes('fail') === true
          && <button disabled={busy} onClick={() => { submit({ type: 'quest', outcome: 'fail' }) }}>令任务失败</button>}
        <button disabled={busy} onClick={() => { submit({ type: 'quest', outcome: 'success' }) }}>令任务成功</button>
      </div>
    </div>}
    {canAct && game.phase === 'assassination' && <div className={css.action}>
      <h2>刺杀梅林</h2><p>只有你的私有界面知道谁在选择目标。</p>
      <div className={css.targets}>{schema?.properties?.target?.enum?.map(target => <button
        key={target}
        disabled={busy}
        onClick={() => { submit({ type: 'assassinate', target }) }}
      >{match.seats.find(seat => seat.id === target)?.displayName ?? target}</button>)}</div>
    </div>}
    {!canAct && match.status === 'active' && match.blockedSeats.length === 0
      && <div className={css.waiting}>{game.phase === 'assassination'
        ? '最终抉择正在私下进行。'
        : game.phase === 'evil-discussion'
          ? game.evilSpeaker === undefined
            ? '邪方正在私下轮流讨论。'
            : `等待${currentSpeakerName ?? '下一位邪方玩家'}${assassinIsCurrentSpeaker ? '总结。' : '发言。'}`
          : game.phase === 'discussion'
            ? leaderIsCurrentSpeaker
              ? '等待队长归票发言。'
              : `等待${currentSpeakerName ?? '下一位圆桌成员'}发言。`
            : '等待其他圆桌成员行动；已提交动作保持封存。'}</div>}
    {match.status === 'blocked' && <div className={css.blocked}>
      <strong>一名 AI 无法继续</strong><p>私有阶段不会显示相关席位。</p>
      <button disabled={busy} onClick={() => { void retryBlocked() }}>重试 AI</button>
      <button disabled={busy} onClick={() => { void resetMatch() }}>结束对局</button>
    </div>}
    {match.status === 'abandoned' && <div className={css.result}>对局已放弃；隐藏身份不会公开。</div>}
    {match.status === 'finished' && <div className={css.result} data-winner={game.winner}>
      <strong>{game.winner === 'good' ? '善方胜利' : '邪方胜利'}</strong>
      <span>{finishLabel(game.finishReason)}</span>
    </div>}
    {game.teamVotes.length > 0 && <div className={css.history}>
      <h2>圆桌记录</h2>
      {[...game.teamVotes].reverse().map((record, index) => <details key={`${record.proposal.leader}-${index}`}>
        <summary>{record.approved ? '队伍通过' : '队伍否决'} · 票型 {record.approveCount} 赞成 / {record.rejectCount} 否决 · {record.proposal.team
          .map(id => match.seats.find(seat => seat.id === id)?.displayName).join('、')}
        {' · '}{directionLabel(record.proposal.direction)}</summary>
        {record.statements.map(item => <p key={`statement-${item.seatId}`}>
          <strong>{match.seats.find(seat => seat.id === item.seatId)?.displayName ?? item.seatId}</strong>
          “{item.statement}”
        </p>)}
      </details>)}
    </div>}
  </section>
}
