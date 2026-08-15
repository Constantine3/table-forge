/** Game product root registration and remote-backed match controller. */

import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {
  GameRemoteCreateRequest, GameRemoteMatchView, GameRemoteSubmitRequest,
} from '@deepseek-ai/dsh-game/types'
import { GameApp, type GameAppInjected, type GameProviderOption, type RpsSetup } from './GameApp.tsx'

interface GameAppState {
  match: GameRemoteMatchView | undefined
  matches: readonly GameRemoteMatchView[]
  providers: readonly GameProviderOption[]
  audit: readonly { readonly seatId: string; readonly entries: readonly { readonly kind: 'reasoning' | 'answer'; readonly text: string }[] }[]
  rpsSetup: RpsSetup | undefined
  busy: boolean
  error: string | undefined
}

const ACTIVE_MATCH_KEY = 'table-forge.active-match'

/** Owns remote effects while the React view consumes an observable snapshot. */
export class GameAppController {
  /** Observable browser view of setup, selection, and the active table. */
  readonly store: SnapshotStore<GameAppState> = createSnapshotStore({
    match: undefined,
    matches: [],
    providers: [],
    audit: [],
    rpsSetup: undefined,
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

  /** Load deployment-resolved game setup limits. */
  async loadGames(): Promise<void> {
    const games = this.value(await this.remote.matches.catalog())
    const schema = games.find(game => game.id === 'rps')?.configSchema as {
      properties?: { roundCount?: { default?: unknown; maximum?: unknown } }
    } | undefined
    const defaultRounds = schema?.properties?.roundCount?.default
    const maxRounds = schema?.properties?.roundCount?.maximum
    if (!Number.isInteger(defaultRounds) || !Number.isInteger(maxRounds)) throw new Error('RPS setup schema is unavailable')
    this.store.update((state) => { state.rpsSetup = { defaultRounds: defaultRounds as number, maxRounds: maxRounds as number } })
  }

  /** Restore the table selected by this browser before the application reload. */
  async restore(): Promise<void> {
    const id = localStorage.getItem(ACTIVE_MATCH_KEY)
    if (id === null) return
    const match = this.value(await this.remote.matches.get(id))
    if (match === undefined) {
      localStorage.removeItem(ACTIVE_MATCH_KEY)
      return
    }
    this.store.update((state) => { state.match = match })
    await this.loadAudit(match)
  }

  /**
   * Create and display a match.
   * @param request - validated match setup fields.
   */
  async create(request: GameRemoteCreateRequest): Promise<void> {
    await this.run(async () => {
      const match = this.value(await this.remote.matches.create(request))
      localStorage.setItem(ACTIVE_MATCH_KEY, match.id)
      this.store.update((state) => { state.match = match })
      await this.loadMatches()
    })
  }

  /**
   * Submit a human action and display the resulting revision.
   * @param request - action submission fields.
   */
  async submit(request: GameRemoteSubmitRequest): Promise<void> {
    await this.run(async () => {
      const match = this.value(await this.remote.matches.submit(request))
      this.store.update((state) => { state.match = match })
      await this.loadMatches()
    })
  }

  /** Abandon the active table before returning to setup. */
  async reset(): Promise<void> {
    await this.run(async () => {
      const match = this.store.getSnapshot().match
      if (match?.status === 'active' || match?.status === 'blocked') this.value(await this.remote.matches.abandon(match.id))
      localStorage.removeItem(ACTIVE_MATCH_KEY)
      this.store.update((state) => {
        state.match = undefined
        state.audit = []
        state.error = undefined
      })
    })
  }

  /** Select a durable table from the lobby.
   * @param id - match id to select.
   */
  async open(id: string): Promise<void> {
    await this.run(async () => {
      const match = this.value(await this.remote.matches.get(id))
      if (match === undefined) throw new Error(`Match '${id}' is unavailable`)
      localStorage.setItem(ACTIVE_MATCH_KEY, id)
      this.store.update((state) => { state.match = match })
      await this.loadAudit(match)
    })
  }

  /** Retry one blocked AI seat.
   * @param seatId - blocked seat to dispatch again.
   */
  async retry(seatId: string): Promise<void> {
    const match = this.store.getSnapshot().match
    if (match === undefined) return
    await this.run(async () => {
      const next = this.value(await this.remote.matches.retry(match.id, seatId))
      this.store.update((state) => { state.match = next })
    })
  }

  /** Load reasoning and final text from each AI seat's isolated Session.
   * @param match - match whose AI Session ids should be read.
   */
  async loadAudit(match: GameRemoteMatchView): Promise<void> {
    const audit = await Promise.all(match.seats.flatMap(seat => seat.controller.type === 'human' ? [] : [seat]).map(async (seat) => {
      const response = await this.connection.api.sessions.history({
        sessionId: `game:${match.id}:${seat.id}` as SessionId,
        maxMessages: 100,
      })
      const result = response.result
      if (!result.ok) return { seatId: seat.id, entries: [] }
      const entries: Array<{ kind: 'reasoning' | 'answer'; text: string }> = result.value.events.flatMap(({ event }) => {
        if (event.type !== 'assistant/message') return []
        return event.data.message.content.flatMap((block): Array<{ kind: 'reasoning' | 'answer'; text: string }> => {
          if (block.type === 'reasoning') return [{ kind: 'reasoning', text: block.text }]
          if (block.type === 'text') return [{ kind: 'answer', text: block.text }]
          return []
        })
      })
      return { seatId: seat.id, entries }
    }))
    this.store.update((state) => { state.audit = audit })
  }

  /**
   * Refresh the active match after its durable log changes.
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
      await this.loadAudit(next)
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

/**
 * Register the game application as the product root.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext & { connection: ConnectionHandle }): void {
  const controller = new GameAppController(ctx.remote, ctx.connection)
  void controller.loadProviders().catch((cause: unknown) => {
    controller.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
  })
  void controller.restore().catch((cause: unknown) => {
    controller.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
  })
  void controller.loadGames().catch((cause: unknown) => {
    controller.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
  })
  void controller.loadMatches().catch((cause: unknown) => {
    controller.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
  })
  const injected = (): GameAppInjected => ({
    hooks: { game: controller.store },
    createMatch: request => controller.create(request),
    submitAction: request => controller.submit(request),
    resetMatch: () => controller.reset(),
    openMatch: id => controller.open(id),
    retrySeat: seatId => controller.retry(seatId),
  })
  ctx.effect(() => ctx.remote.$on('match/changed', (id) => {
    void controller.refresh(id).catch((cause: unknown) => {
      controller.store.update((state) => { state.error = cause instanceof Error ? cause.message : String(cause) })
    })
  }), 'ui-game: match invalidations')
  ctx.effect(() => ctx.slots.register({ name: 'root', inject: injected }, GameApp), 'ui-game: root slot')
}
