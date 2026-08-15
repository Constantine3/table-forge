/** Generic game root registration and remote-backed match controller. */

import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { GameRemoteCreateRequest, GameRemoteSubmitRequest, GameWireJson } from '@deepseek-ai/dsh-game/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  GameApp,
  type GameAudit,
  type GameAuditEntry,
  type GameAppInjected,
  type GameAppState,
} from './GameApp.tsx'

export {
  GameApp,
  type GameAppInjected,
  type GameAppProps,
  type GameAppState,
  type GameAudit,
  type GameAuditActionEntry,
  type GameAuditEntry,
  type GameAuditMessageEntry,
  type GameCatalogItemOwnerProps,
  type GameProviderOption,
  type GameSurfaceOwnerProps,
} from './GameApp.tsx'

const ACTIVE_MATCH_KEY = 'table-forge.active-match'
const AUDIT_PAGE_MESSAGES = 100

interface AuditTurnContext {
  readonly actionType: string | undefined
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
)

const sourceActionType = (source: unknown): string | undefined => {
  const sourceRecord = asRecord(source)
  if (sourceRecord?.['kind'] !== 'game') return undefined
  const schema = asRecord(sourceRecord['actionSchema'])
  const properties = asRecord(schema?.['properties'])
  const type = asRecord(properties?.['type'])?.['const']
  if (typeof type === 'string') return type
  return properties !== undefined && Object.hasOwn(properties, 'choice') ? 'choice' : undefined
}

const actionType = (action: GameWireJson, context: AuditTurnContext | undefined): string | undefined => {
  const record = asRecord(action)
  if (typeof record?.['type'] === 'string') return record['type']
  if (record !== undefined && Object.hasOwn(record, 'choice')) return 'choice'
  return context?.actionType
}

const auditText = (kind: 'reasoning' | 'answer', text: string, context: AuditTurnContext | undefined): string => {
  if (context?.actionType !== 'vote-team') return text
  return kind === 'reasoning'
    ? '匿名队伍投票的分析已隐藏。'
    : '匿名队伍投票的自然语言输出已隐藏。'
}

const auditEntriesForSeat = (
  seatId: string,
  events: readonly SessionEvent[],
): GameAuditEntry[] => {
  const contexts = new Map<number, AuditTurnContext>()
  const outcomes = new Map<string, boolean>()
  let currentTurn: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') currentTurn = event.data.turn
    if (event.type === 'user/message' && currentTurn !== undefined) {
      const type = sourceActionType(event.data.source)
      if (type !== undefined) contexts.set(currentTurn, { actionType: type })
    }
    if (event.type === 'tool/result') {
      outcomes.set(String(event.data.message.source.callId), event.data.error === undefined)
    }
  }

  return events.flatMap((event): GameAuditEntry[] => {
    if (event.type === 'assistant/message') {
      const context = contexts.get(event.data.turn)
      return event.data.message.content.flatMap((block): GameAuditEntry[] => {
        if (block.type !== 'reasoning' && block.type !== 'text') return []
        const kind = block.type === 'reasoning' ? 'reasoning' : 'answer'
        return [{
          seatId,
          actionType: context?.actionType,
          time: event.time,
          turn: event.data.turn,
          eventSeq: event.seq,
          kind,
          text: auditText(kind, block.text, context),
        }]
      })
    }
    if (event.type !== 'tool/call' || event.data.name !== 'submit_game_action') return []
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data.arguments)
    } catch {
      return []
    }
    const wrapper = asRecord(parsed)
    if (wrapper === undefined || !Object.hasOwn(wrapper, 'action')) return []
    const action = wrapper['action'] as GameWireJson
    const context = contexts.get(event.data.turn)
    const type = actionType(action, context)
    return [{
      seatId,
      actionType: type,
      time: event.time,
      turn: event.data.turn,
      eventSeq: event.seq,
      kind: 'action',
      action: type === 'vote-team' ? { type: 'vote-team' } : action,
      accepted: outcomes.get(String(event.data.callId)),
    }]
  })
}

/** Owns generic game remote effects while game-specific views consume a shared snapshot. */
export class GameAppController {
  /** Observable browser view of catalog, selection, and the active table. */
  readonly store: SnapshotStore<GameAppState> = createSnapshotStore({
    match: undefined,
    matches: [],
    games: [],
    selectedGameId: undefined,
    providers: [],
    audit: undefined,
    busy: false,
    error: undefined,
  })

  constructor(
    private readonly remote: ClientContext['remote'],
    private readonly connection: ConnectionHandle,
  ) {}

  /** Load active provider routes and their configured game model. */
  async loadProviders(): Promise<void> {
    const response = await this.connection.api.llm.models({})
    const result = response.result
    if (!result.ok) {
      this.store.update((state) => { state.error = result.error.message })
      return
    }
    const candidates = result.value.groups.flatMap((group) => {
      const model = group.models[0]
      return model === undefined ? [] : [{ id: group.id, name: group.name, model: model.id }]
    })
    const availability = this.value(await this.remote.matches.providerAvailability(
      candidates.map(candidate => ({ provider: candidate.id, model: candidate.model })),
    ))
    const providers = candidates.map((candidate) => {
      const current = availability.find(item => item.provider === candidate.id && item.model === candidate.model)
      return {
        ...candidate,
        available: current?.available === true,
        ...(current?.message === undefined ? {} : { message: current.message }),
      }
    })
    this.store.update((state) => { state.providers = providers })
  }

  /** Load durable tables for the lobby. */
  async loadMatches(): Promise<void> {
    const matches = this.value(await this.remote.matches.list())
    this.store.update((state) => { state.matches = matches })
  }

  /** Load registered games and their deployment-resolved setup schemas. */
  async loadGames(): Promise<void> {
    const games = this.value(await this.remote.matches.catalog())
    this.store.update((state) => { state.games = games })
  }

  /** Restore the table selected by this browser without reading AI sessions. */
  async restore(): Promise<void> {
    const id = localStorage.getItem(ACTIVE_MATCH_KEY)
    if (id === null) return
    const match = this.value(await this.remote.matches.get(id))
    if (match === undefined) {
      localStorage.removeItem(ACTIVE_MATCH_KEY)
      return
    }
    this.store.update((state) => {
      state.match = match
      state.selectedGameId = match.gameId
      state.audit = undefined
    })
  }

  /** Select a registered game while no match is open.
   * @param gameId - selected id, or `undefined` for the catalog.
   */
  select(gameId: string | undefined): void {
    if (this.store.getSnapshot().match !== undefined) return
    this.store.update((state) => { state.selectedGameId = gameId; state.error = undefined })
  }

  /** Create and display a match.
   * @param request - validated match setup fields.
   */
  async create(request: GameRemoteCreateRequest): Promise<void> {
    await this.run(async () => {
      const match = this.value(await this.remote.matches.create(request))
      localStorage.setItem(ACTIVE_MATCH_KEY, match.id)
      this.store.update((state) => {
        state.match = match
        state.selectedGameId = match.gameId
        state.audit = undefined
      })
      await this.loadMatches()
    })
  }

  /** Submit a human action and display the resulting revision.
   * @param request - action submission fields.
   */
  async submit(request: GameRemoteSubmitRequest): Promise<void> {
    await this.run(async () => {
      const match = this.value(await this.remote.matches.submit(request))
      this.store.update((state) => { state.match = match })
      await this.loadMatches()
    })
  }

  /** Abandon an unfinished table before returning to the selected game's setup. */
  async reset(): Promise<void> {
    await this.run(async () => {
      const match = this.store.getSnapshot().match
      if (match?.status === 'active' || match?.status === 'blocked') this.value(await this.remote.matches.abandon(match.id))
      localStorage.removeItem(ACTIVE_MATCH_KEY)
      this.store.update((state) => {
        state.match = undefined
        state.audit = undefined
        state.error = undefined
      })
    })
  }

  /** Select a durable table from the lobby without reading AI sessions.
   * @param id - match id to select.
   */
  async open(id: string): Promise<void> {
    await this.run(async () => {
      const match = this.value(await this.remote.matches.get(id))
      if (match === undefined) throw new Error(`Match '${id}' is unavailable`)
      localStorage.setItem(ACTIVE_MATCH_KEY, id)
      this.store.update((state) => {
        state.match = match
        state.selectedGameId = match.gameId
        state.audit = undefined
      })
    })
  }

  /** Retry every blocked controller without exposing private seat ownership. */
  async retry(): Promise<void> {
    const match = this.store.getSnapshot().match
    if (match === undefined) return
    await this.run(async () => {
      const next = this.value(await this.remote.matches.retry(match.id))
      this.store.update((state) => { state.match = next })
    })
  }

  /** Explicitly load AI sessions for a normally finished match. */
  async loadAudit(): Promise<void> {
    await this.run(async () => {
      const match = this.store.getSnapshot().match
      if (match?.status !== 'finished') throw new Error('AI audit is available only after a finished match')
      const seatResults = await Promise.all(match.seats.flatMap(
        seat => seat.controller.type === 'human' ? [] : [seat],
      ).map(async (seat): Promise<{ seatId: string; events: SessionEvent[] } | undefined> => {
        let response = await this.connection.api.sessions.history({
          sessionId: `game:${match.id}:${seat.id}` as SessionId,
          maxMessages: AUDIT_PAGE_MESSAGES,
        })
        if (!response.result.ok) return undefined
        let events = response.result.value.events.map(entry => entry.event)
        let hasMore = response.result.value.hasMore
        while (hasMore) {
          const beforeSeq = events[0]?.seq
          if (beforeSeq === undefined) return undefined
          response = await this.connection.api.sessions.history({
            sessionId: `game:${match.id}:${seat.id}` as SessionId,
            beforeSeq,
            maxMessages: AUDIT_PAGE_MESSAGES,
          })
          if (!response.result.ok || response.result.value.events.length === 0) return undefined
          events = [...response.result.value.events.map(entry => entry.event), ...events]
          hasMore = response.result.value.hasMore
        }
        return { seatId: seat.id, events }
      }))
      const seatOrder = new Map(match.seats.map((seat, index) => [seat.id, index]))
      const entries = seatResults.flatMap(result => result === undefined
        ? []
        : auditEntriesForSeat(result.seatId, result.events))
      entries.sort((left, right) => left.time - right.time
        || (seatOrder.get(left.seatId) ?? Number.MAX_SAFE_INTEGER) - (seatOrder.get(right.seatId) ?? Number.MAX_SAFE_INTEGER)
        || left.eventSeq - right.eventSeq)
      const audit: GameAudit = {
        entries,
        unavailableSeatIds: match.seats.flatMap(seat => (
          seat.controller.type !== 'human' && !seatResults.some(result => result?.seatId === seat.id) ? [seat.id] : []
        )),
      }
      this.store.update((state) => { state.audit = audit })
    })
  }

  /** Refresh the active match after its durable log changes.
   * @param id - changed match identifier.
   */
  async refresh(id: string): Promise<void> {
    const current = this.store.getSnapshot().match
    if (current?.id !== id) return
    const next = this.value(await this.remote.matches.get(id))
    const selected = this.store.getSnapshot().match
    if (selected?.id === id && next !== undefined && next.revision >= selected.revision) {
      this.store.update((state) => { state.match = next })
      await this.loadMatches()
    }
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    this.store.update((state) => { state.busy = true; state.error = undefined })
    try {
      await operation()
    } catch (cause) {
      this.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
    } finally {
      this.store.update((state) => { state.busy = false })
    }
  }

  private value<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
}

/** Required client services. */
export const inject = ['slots', 'connection', 'remote', 'remote.matches']

/** Register the generic game application as the product root.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext & { connection: ConnectionHandle }): void {
  const controller = new GameAppController(ctx.remote, ctx.connection)
  const report = (cause: unknown): void => {
    controller.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
  }
  void controller.loadProviders().catch(report)
  void controller.restore().catch(report)
  void controller.loadGames().catch(report)
  void controller.loadMatches().catch(report)
  const injected = (): GameAppInjected => ({
    hooks: { game: controller.store },
    createMatch: request => controller.create(request),
    submitAction: request => controller.submit(request),
    resetMatch: () => controller.reset(),
    openMatch: id => controller.open(id),
    retryBlocked: () => controller.retry(),
    loadAudit: () => controller.loadAudit(),
    selectGame: (gameId) => { controller.select(gameId) },
  })
  ctx.effect(() => ctx.remote.$on('match/changed', (id) => { void controller.refresh(id).catch(report) }), 'ui-game: match invalidations')
  ctx.effect(() => ctx.slots.register({
    name: 'root',
    inject: injected,
    children: {
      'game.catalog.item': { kind: 'list', scope: 'root' },
      'game.surface': { kind: 'keyed', scope: 'root' },
    },
  }, GameApp), 'ui-game: root slot')
}
