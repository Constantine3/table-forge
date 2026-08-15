/**
 * Deterministic game definitions and the durable match service.
 * @module @deepseek-ai/dsh-game
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque durable match identity. */
export type MatchId = Branded<'MatchId'>
/** Construct a match identity.
 * @param value - raw identity.
 * @returns branded identity.
 */
export const MatchId = (value: string): MatchId => value as MatchId
/** Opaque seat identity within a match. */
export type SeatId = Branded<'SeatId'>
/** Construct a seat identity.
 * @param value - raw identity.
 * @returns branded identity.
 */
export const SeatId = (value: string): SeatId => value as SeatId
/** Opaque identity of one currently actionable window. */
export type ActionWindowId = Branded<'ActionWindowId'>
/** Construct an action-window identity.
 * @param value - raw identity.
 * @returns branded identity.
 */
export const ActionWindowId = (value: string): ActionWindowId => value as ActionWindowId
/** Opaque idempotency identity supplied with a match command. */
export type GameCommandId = Branded<'GameCommandId'>
/** Construct a command identity.
 * @param value - raw identity.
 * @returns branded identity.
 */
export const GameCommandId = (value: string): GameCommandId => value as GameCommandId

/** Lossless JSON accepted by match persistence and public views. */
export type GameJson = null | boolean | number | string | readonly GameJson[] | { readonly [key: string]: GameJson }

/** Controller selected for one seat. */
export type SeatControllerSpec =
  | { readonly type: 'human' }
  | {
    readonly type: 'agent'
    readonly provider: string
    readonly model: string
  }

/** Seat creation request stored in the match header. */
export interface MatchSeatSpec {
  readonly id: SeatId
  readonly displayName: string
  readonly controller: SeatControllerSpec
}

/** A durable game-specific event. */
export interface GameRuleEvent {
  readonly type: string
  readonly data: GameJson
}

/** A pending action whose submissions remain hidden until resolution. */
export interface GameActionWindow {
  readonly key: string
  readonly requiredSeats: readonly SeatId[]
}

/** Input supplied when a definition creates its initial events. */
export interface GameInitialInput {
  readonly config: GameJson
  readonly seats: readonly MatchSeatSpec[]
}

/** Input supplied when a definition resolves a complete action window. */
export interface GameResolveInput<State> {
  readonly state: State
  readonly window: GameActionWindow
  readonly actions: ReadonlyMap<SeatId, GameJson>
}

/**
 * A versioned deterministic rules plugin. Reducers and projections must be pure;
 * the engine persists returned events and owns all lifecycle effects.
 */
export interface GameDefinition<State = unknown> {
  readonly id: string
  readonly rulesVersion: number
  /** JSON Schema object describing deployment-resolved match configuration. */
  readonly configSchema: GameJson
  /** JSON Schema object used for the AI action tool's `action` field. */
  readonly actionSchema: Readonly<Record<string, unknown>>
  /** Validate and detach game configuration. */
  validateConfig(value: unknown): GameJson
  /** Validate and detach a submitted action. */
  validateAction(value: unknown): GameJson
  /** Create the initial rule events. */
  initial(input: GameInitialInput): readonly GameRuleEvent[]
  /** Reduce one event into the next deterministic state. */
  reduce(state: State | undefined, event: GameRuleEvent): State
  /** Return the sole active window, or `undefined` after completion. */
  pending(state: State): GameActionWindow | undefined
  /** Resolve a fully submitted window into durable rule events. */
  resolve(input: GameResolveInput<State>): readonly GameRuleEvent[]
  /** Project a public or seat-scoped JSON view. */
  view(state: State, seat?: SeatId): GameJson
  /** Render the complete rules and current seat observation for an AI player. */
  modelPrompt(state: State, seat: SeatId): string
}

/** Generic durable match event envelope. */
export interface MatchEvent {
  readonly seq: number
  readonly time: number
  readonly type: 'match/created' | 'match/action-opened' | 'match/action-submitted' | 'match/action-closed'
    | 'match/controller-blocked' | 'match/controller-retried' | 'match/abandoned' | 'match/rule'
  readonly data: GameJson
}

/** Persisted match header. */
export interface MatchRecord {
  readonly id: MatchId
  readonly formatVersion: 0
  readonly gameId: string
  readonly rulesVersion: number
  readonly config: GameJson
  readonly seats: readonly MatchSeatSpec[]
  readonly createdAt: number
  readonly events: readonly MatchEvent[]
}

/** Atomic persistence operations required by the match engine. */
export interface GamePersistence {
  /** Atomically create one durable record and its initial events; duplicate ids reject.
   * @param record - complete header and initial event batch.
   */
  create(record: MatchRecord): Promise<void>
  /** Append a contiguous batch at `expectedRevision`; conflicts reject.
   * @param matchId - target match.
   * @param expectedRevision - required current event count.
   * @param events - contiguous event batch to commit.
   */
  append(matchId: MatchId, expectedRevision: number, events: readonly MatchEvent[]): Promise<void>
  /** Load one match, or return `undefined` when absent.
   * @param matchId - target match.
   * @returns stored record, when present.
   */
  load(matchId: MatchId): Promise<MatchRecord | undefined>
  /** List match headers without exposing raw events.
   * @returns stored headers.
   */
  list(): Promise<readonly Omit<MatchRecord, 'events'>[]>
}

/** Create-match request accepted by {@link MatchService.create}. */
export interface CreateMatchRequest {
  readonly gameId: string
  readonly config: unknown
  readonly seats: readonly MatchSeatSpec[]
}

/** Action command accepted by {@link MatchService.submit}. */
export interface SubmitActionRequest {
  readonly matchId: MatchId
  readonly windowId: ActionWindowId
  readonly commandId: GameCommandId
  readonly seatId: SeatId
  readonly action: unknown
}

/** Public match state returned to product consumers. */
export interface MatchView {
  readonly id: MatchId
  readonly gameId: string
  readonly revision: number
  readonly status: 'active' | 'blocked' | 'abandoned' | 'finished'
  readonly seats: readonly MatchSeatSpec[]
  readonly window?: { readonly id: ActionWindowId; readonly requiredSeats: readonly SeatId[]; readonly submittedSeats: readonly SeatId[] }
  /** Controller failures for seats that require an operator retry. */
  readonly blockedSeats: readonly { readonly seatId: SeatId; readonly message: string }[]
  readonly game: GameJson
}

/** Runtime match operations supplied by the concrete engine provider. */
export interface MatchService {
  /** Create and initialize one match.
   * @param request - validated game, configuration, and seats.
   * @returns committed initial view.
   */
  create(request: CreateMatchRequest): Promise<MatchView>
  /** Read one match view.
   * @param matchId - target match.
   * @param humanSeat - optional seat used for human-safe projection.
   * @returns current view, when present.
   */
  get(matchId: MatchId, humanSeat?: SeatId): Promise<MatchView | undefined>
  /** List current public match views.
   * @returns views ordered by the provider.
   */
  list(): Promise<readonly MatchView[]>
  /** Submit one action to an open window.
   * @param request - idempotent seat action command.
   * @returns committed resulting view.
   */
  submit(request: SubmitActionRequest): Promise<MatchView>
  /** Abandon an active match and stop its controller work.
   * @param matchId - target match.
   * @returns committed terminal view.
   */
  abandon(matchId: MatchId): Promise<MatchView>
  /** Retry one blocked controller seat in its current action window.
   * @param matchId - target match.
   * @param seatId - blocked seat to reschedule.
   * @returns committed active view.
   */
  retry(matchId: MatchId, seatId: SeatId): Promise<MatchView>
}

/** One request from the engine to a controller provider. */
export interface GameControllerRequest {
  readonly matchId: MatchId
  readonly seat: MatchSeatSpec
  readonly windowId: ActionWindowId
  readonly prompt: string
  readonly actionSchema: Readonly<Record<string, unknown>>
}

/** Provider that drives one configured controller type. */
export interface GameControllerProvider {
  /** Validate one controller specification before a remotely requested match is persisted. */
  validate(controller: SeatControllerSpec): Promise<void>
  /** Resolve configuration and verify that the provider endpoint is currently reachable.
   * @param controller - proposed controller specification.
   * @returns availability and an operator-facing failure when unavailable.
   */
  availability?(controller: SeatControllerSpec): Promise<{ readonly available: boolean; readonly message?: string }>
  /** Start an outstanding action without blocking the match command that opened it. */
  drive(request: GameControllerRequest): Promise<void>
  /** Stop and drain controller work owned by one match.
   * @param matchId - match whose controller work must quiesce.
   */
  cancel(matchId: MatchId): Promise<void>
}

/** Effect-owned registry of controller providers. */
export class GameControllerRegistry extends Service {
  private readonly entries = new Map<string, GameControllerProvider>()
  private readonly listeners = new Set<(type: string) => void>()

  constructor(ctx: Context) {
    super(ctx, 'gameControllers')
  }

  /** Register one controller type.
   * @param type - discriminator.
   * @param provider - implementation.
   * @returns stale-safe disposer.
   */
  register(type: string, provider: GameControllerProvider): () => void {
    if (this.entries.has(type)) throw new Error(`game controller '${type}' is already registered`)
    this.entries.set(type, provider)
    this.notify(type)
    return () => {
      if (this.entries.get(type) === provider) this.entries.delete(type)
    }
  }

  /** Dispatch a controller request.
   * @param type - discriminator.
   * @param request - active request.
   * @returns provider completion.
   */
  drive(type: string, request: GameControllerRequest): Promise<void> {
    const provider = this.entries.get(type)
    if (provider === undefined) return Promise.reject(new Error(`game controller '${type}' is unavailable`))
    return provider.drive(request)
  }

  /** Stop controller work for one match through every registered provider.
   * @param matchId - match whose work must quiesce.
   * @returns completion after all providers settle.
   */
  async cancel(matchId: MatchId): Promise<void> {
    await Promise.all([...this.entries.values()].map(provider => provider.cancel(matchId)))
  }

  /** Validate one controller specification through its owning provider.
   * @param type - controller discriminator.
   * @param controller - unpersisted specification.
   * @returns validation completion.
   */
  validate(type: string, controller: SeatControllerSpec): Promise<void> {
    const provider = this.entries.get(type)
    if (provider === undefined) return Promise.reject(new Error(`game controller '${type}' is unavailable`))
    return provider.validate(controller)
  }

  /** Check current endpoint availability through the owning provider.
   * @param type - controller discriminator.
   * @param controller - controller specification to check.
   * @returns current reachability and an optional diagnostic.
   */
  availability(type: string, controller: SeatControllerSpec): Promise<{ readonly available: boolean; readonly message?: string }> {
    const provider = this.entries.get(type)
    if (provider === undefined) return Promise.resolve({ available: false, message: `game controller '${type}' is unavailable` })
    if (provider.availability === undefined) {
      return provider.validate(controller).then(() => ({ available: true }), (error: unknown) => ({
        available: false, message: error instanceof Error ? error.message : String(error),
      }))
    }
    return provider.availability(controller)
  }

  /** Test whether a controller type is currently available.
   * @param type - controller discriminator.
   * @returns whether a provider owns the type.
   */
  has(type: string): boolean {
    return this.entries.has(type)
  }

  /** Observe current and future successful controller registrations.
   * @param listener - callback invoked for available providers and later registrations.
   * @returns stale-safe disposer.
   */
  onRegister(listener: (type: string) => void): () => void {
    this.listeners.add(listener)
    for (const type of this.entries.keys()) this.callListener(listener, type)
    return () => { this.listeners.delete(listener) }
  }

  private notify(type: string): void {
    for (const listener of this.listeners) this.callListener(listener, type)
  }

  private callListener(listener: (type: string) => void, type: string): void {
    try {
      listener(type)
    } catch (error) {
      this.ctx.logger.warn(`game controller registration listener failed for '${type}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Effect-owned registry of versioned game definitions. */
export class GameDefinitionRegistry extends Service {
  private readonly entries = new Map<string, GameDefinition>()
  private readonly listeners = new Set<(gameId: string) => void>()

  constructor(ctx: Context) {
    super(ctx, 'gameDefinitions')
  }

  /** Register one definition.
   * @param definition - rules definition.
   * @returns stale-safe disposer.
   */
  register(definition: GameDefinition): () => void {
    if (this.entries.has(definition.id)) throw new Error(`game definition '${definition.id}' is already registered`)
    this.entries.set(definition.id, definition)
    this.notify(definition.id)
    return () => {
      if (this.entries.get(definition.id) === definition) this.entries.delete(definition.id)
    }
  }

  /** Resolve a definition.
   * @param id - game id.
   * @returns matching definition.
   */
  require(id: string): GameDefinition {
    const definition = this.entries.get(id)
    if (definition === undefined) throw new Error(`unknown game definition '${id}'`)
    return definition
  }

  /** List registered definitions.
   * @returns definitions in stable id order.
   */
  list(): readonly GameDefinition[] {
    return [...this.entries.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  /** Observe current and future successful definition registrations.
   * @param listener - callback invoked for available definitions and later registrations.
   * @returns stale-safe disposer.
   */
  onRegister(listener: (gameId: string) => void): () => void {
    this.listeners.add(listener)
    for (const gameId of this.entries.keys()) this.callListener(listener, gameId)
    return () => { this.listeners.delete(listener) }
  }

  private notify(gameId: string): void {
    for (const listener of this.listeners) this.callListener(listener, gameId)
  }

  private callListener(listener: (gameId: string) => void, gameId: string): void {
    try {
      listener(gameId)
    } catch (error) {
      this.ctx.logger.warn(`game definition registration listener failed for '${gameId}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    gameDefinitions: GameDefinitionRegistry
    gameControllers: GameControllerRegistry
    gamePersistence: GamePersistence
    matches: MatchService
  }
  interface Events {
    /**
     * Notify consumers that a committed match revision is available.
     * @mode parallel
     * @param matchId - changed match.
     * @param revision - committed revision.
     */
    'match/changed'(matchId: MatchId, revision: number): void
  }
}

export default GameDefinitionRegistry
