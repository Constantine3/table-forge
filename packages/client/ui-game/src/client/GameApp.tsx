import { useEffect, useRef, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GameRemoteCreateRequest, GameRemoteGameInfo, GameRemoteMatchView, GameRemoteSubmitRequest, GameWireJson,
} from '@deepseek-ai/dsh-game/types'
import { GameAuditTimeline } from './GameAuditTimeline.tsx'
import css from './GameApp.module.css'

/** One configured provider and its game model. */
export interface GameProviderOption {
  id: string
  name: string
  model: string
  available: boolean
  message?: string
}

interface GameAuditEntryBase {
  readonly seatId: string
  readonly actionType: string | undefined
  readonly time: number
  readonly turn: number
  readonly eventSeq: number
}

/** One reasoning or natural-language output in the post-finish AI timeline. */
export interface GameAuditMessageEntry extends GameAuditEntryBase {
  readonly kind: 'reasoning' | 'answer'
  readonly text: string
}

/** One game action requested by an AI, paired with its tool outcome. */
export interface GameAuditActionEntry extends GameAuditEntryBase {
  readonly kind: 'action'
  readonly action: GameWireJson
  readonly accepted: boolean | undefined
}

/** One chronologically sortable entry in the post-finish AI timeline. */
export type GameAuditEntry = GameAuditMessageEntry | GameAuditActionEntry

/** Explicitly loaded AI audit state for one normally finished match. */
export interface GameAudit {
  readonly entries: readonly GameAuditEntry[]
  readonly unavailableSeatIds: readonly string[]
}

/** Observable state owned by the generic game application. */
export interface GameAppState {
  match: GameRemoteMatchView | undefined
  matches: readonly GameRemoteMatchView[]
  games: readonly GameRemoteGameInfo[]
  selectedGameId: string | undefined
  providers: readonly GameProviderOption[]
  audit: GameAudit | undefined
  busy: boolean
  error: string | undefined
}

/** Owner fields passed to each game catalog contribution. */
export interface GameCatalogItemOwnerProps {
  readonly selectedGameId: string | undefined
  readonly selectGame: (gameId: string) => void
}

/** Owner fields shared by every game-specific setup and board contribution. */
export interface GameSurfaceOwnerProps {
  readonly game: GameRemoteGameInfo
  readonly match: GameRemoteMatchView | undefined
  readonly providers: readonly GameProviderOption[]
  readonly busy: boolean
  readonly createMatch: (request: GameRemoteCreateRequest) => Promise<void>
  readonly submitAction: (request: GameRemoteSubmitRequest) => Promise<void>
  readonly resetMatch: () => Promise<void>
  readonly retryBlocked: () => Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Ordered setup choices contributed by installed game UI plugins. */
    'game.catalog.item': { kind: 'list'; scope: 'root'; owner: GameCatalogItemOwnerProps }
    /** Game-specific setup and board selected by the durable game id. */
    'game.surface': { kind: 'keyed'; scope: 'root'; owner: GameSurfaceOwnerProps }
  }
}

/** Registration-time game actions and observable state. */
export interface GameAppInjected {
  hooks: { game: SnapshotStore<GameAppState> }
  createMatch: (request: GameRemoteCreateRequest) => Promise<void>
  submitAction: (request: GameRemoteSubmitRequest) => Promise<void>
  resetMatch: () => Promise<void>
  openMatch: (id: string) => Promise<void>
  retryBlocked: () => Promise<void>
  loadAudit: () => Promise<void>
  selectGame: (gameId: string | undefined) => void
}

/** Root-slot props for the generic game shell. */
export type GameAppProps = PropsRuntime<'root'>
  & PropsRenderSlots<'game.catalog.item' | 'game.surface'>
  & InjectFace<GameAppInjected>

type TurnNotificationPermission = NotificationPermission | 'unsupported'

const currentTurnNotificationPermission = (): TurnNotificationPermission => (
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
)

const statusLabel = (status: GameRemoteMatchView['status']): string => {
  if (status === 'active') return '进行中'
  if (status === 'blocked') return '需要处理'
  if (status === 'finished') return '已完成'
  return '已结束'
}

/** Render the product shell and dispatch the selected game surface.
 * @param props - root runtime, child slots, and generic match operations.
 * @returns complete game product shell.
 */
export function GameApp({
  useGame, createMatch, submitAction, resetMatch, openMatch, retryBlocked, loadAudit, selectGame, renderSlot,
}: GameAppProps) {
  const { match, matches, games, selectedGameId, providers, audit, busy, error } = useGame(state => state)
  const [notificationPermission, setNotificationPermission] = useState<TurnNotificationPermission>(
    currentTurnNotificationPermission,
  )
  const notifiedWindow = useRef<string>()
  const activeGameId = match?.gameId ?? selectedGameId
  const game = games.find(candidate => candidate.id === activeGameId)
  const requestTurnNotificationPermission = (): void => {
    if (notificationPermission !== 'default' || typeof Notification === 'undefined') return
    void Notification.requestPermission().then(setNotificationPermission, () => {
      setNotificationPermission(currentTurnNotificationPermission())
    })
  }
  const createMatchWithNotifications = (request: GameRemoteCreateRequest): Promise<void> => {
    requestTurnNotificationPermission()
    return createMatch(request)
  }

  useEffect(() => {
    const refreshPermission = (): void => {
      setNotificationPermission(currentTurnNotificationPermission())
    }
    document.addEventListener('visibilitychange', refreshPermission)
    return () => { document.removeEventListener('visibilitychange', refreshPermission) }
  }, [])

  useEffect(() => {
    if (match?.status !== 'active' || match.window?.canAct !== true) return
    const key = `${match.id}:${match.window.id}`
    if (notifiedWindow.current === key) return
    if (document.visibilityState === 'visible') {
      notifiedWindow.current = key
      return
    }
    if (notificationPermission !== 'granted' || typeof Notification === 'undefined') return
    notifiedWindow.current = key
    const notification = new Notification('轮到你操作了', {
      body: '返回 Table Forge 完成当前操作。',
      tag: `table-forge-turn-${match.id}`,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }, [match?.id, match?.status, match?.window?.canAct, match?.window?.id, notificationPermission])

  return (
    <main className={css.app}>
      <header>
        <button className={css.brand} onClick={() => { if (match === undefined) selectGame(undefined) }}>TABLE FORGE</button>
        <div className={css.headerMeta}>
          <span className={css.tag}>LLM 原生游戏引擎</span>
          {notificationPermission === 'default' && <button
            className={css.notificationPermission}
            onClick={requestTurnNotificationPermission}
          >开启回合通知</button>}
          {notificationPermission === 'granted'
            && <span className={css.notificationStatus}>回合通知已开启</span>}
          {notificationPermission === 'denied' && <span
            className={css.notificationStatus}
            title="请在浏览器的网站设置中重新允许通知"
          >回合通知被阻止</span>}
        </div>
      </header>
      {game === undefined ? (
        <section className={css.landing}>
          <p className={css.eyebrow}>选择游戏</p>
          <h1>一张桌，多种推演</h1>
          <p className={css.lead}>模型负责决策，事件溯源规则引擎负责裁定、封存动作与恢复对局。</p>
          <div className={css.catalog}>
            {renderSlot('game.catalog.item', {
              selectedGameId,
              selectGame: (gameId) => { selectGame(gameId) },
            }, {
              fallback: <p>当前组合没有安装可用的游戏界面。</p>,
            })}
          </div>
          {matches.length > 0 && <div className={css.lobby}>
            <h2>历史牌桌</h2>
            {matches.map(item => <button key={item.id} onClick={() => { void openMatch(item.id) }}>
              <span>{statusLabel(item.status)} · {item.gameId}</span><strong>{item.id.slice(0, 8)}</strong>
            </button>)}
          </div>}
        </section>
      ) : (
        <>
          {match === undefined && <button className={css.back} onClick={() => { selectGame(undefined) }}>← 返回游戏列表</button>}
          {renderSlot('game.surface', {
            game, match, providers, busy, createMatch: createMatchWithNotifications,
            submitAction, resetMatch, retryBlocked,
          }, { entryKey: game.id, fallback: <section className={css.missing}>游戏 “{game.id}” 已注册规则，但没有安装浏览器界面。</section> })}
          {match?.status === 'finished' && <section className={css.auditArea}>
            {audit === undefined
              ? <button className={css.auditButton} disabled={busy} onClick={() => { void loadAudit() }}>载入 AI 审计记录</button>
              : <GameAuditTimeline audit={audit} seats={match.seats} />}
          </section>}
        </>
      )}
      {error !== undefined && <div className={css.error} role="alert">{error}</div>}
    </main>
  )
}
