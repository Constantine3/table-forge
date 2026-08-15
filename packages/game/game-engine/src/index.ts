/** Event-sourced match driver for deterministic game definitions. @module @deepseek-ai/dsh-game-engine */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ActionWindowId,
  GameCommandId,
  MatchId,
  SeatId,
  type CreateMatchRequest,
  type GameActionWindow,
  type GameDefinition,
  type GameJson,
  type GamePersistence,
  type GameRuleEvent,
  type MatchEvent,
  type MatchRecord,
  type MatchService,
  type MatchView,
  type SubmitActionRequest,
} from '@deepseek-ai/dsh-game'
import type {
  GameRemoteCreateRequest, GameRemoteGameInfo, GameRemoteMatchView, GameRemoteProviderAvailability, GameRemoteSubmitRequest,
} from '@deepseek-ai/dsh-game/types'

interface OpenWindow {
  readonly id: ActionWindowId
  readonly window: GameActionWindow
  readonly submissions: ReadonlyMap<SeatId, GameJson>
}

interface DerivedMatch {
  readonly state: unknown
  readonly window?: OpenWindow
  readonly commands: ReadonlyMap<GameCommandId, { readonly windowId: ActionWindowId; readonly seatId: SeatId; readonly action: GameJson }>
  readonly abandoned: boolean
  readonly blockedSeats: ReadonlyMap<SeatId, string>
}

const asObject = (value: GameJson): Readonly<Record<string, GameJson>> => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('corrupt match event data')
  return value as Readonly<Record<string, GameJson>>
}

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`corrupt match event ${field}`)
  return value
}

/** In-memory persistence provider intended for tests and ephemeral compositions. */
export class MemoryGamePersistence implements GamePersistence {
  private readonly records = new Map<MatchId, MatchRecord>()

  create(record: MatchRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error(`match '${record.id}' already exists`)
    record.events.forEach((event, index) => {
      if (event.seq !== index) throw new Error(`match '${record.id}' initial events are not contiguous`)
    })
    this.records.set(record.id, { ...record, events: [...record.events] })
    return Promise.resolve()
  }

  append(matchId: MatchId, expectedRevision: number, events: readonly MatchEvent[]): Promise<void> {
    const record = this.records.get(matchId)
    if (record === undefined) throw new Error(`unknown match '${matchId}'`)
    if (record.events.length !== expectedRevision) throw new Error(`match '${matchId}' revision conflict`)
    events.forEach((event, index) => {
      if (event.seq !== expectedRevision + index) throw new Error(`match '${matchId}' append is not contiguous`)
    })
    this.records.set(matchId, { ...record, events: [...record.events, ...events] })
    return Promise.resolve()
  }

  load(matchId: MatchId): Promise<MatchRecord | undefined> {
    return Promise.resolve(this.records.get(matchId))
  }

  list(): Promise<readonly Omit<MatchRecord, 'events'>[]> {
    return Promise.resolve([...this.records.values()].map(({ events: _events, ...header }) => header))
  }
}

/** Concrete serialized match service. */
export class GameEngine extends TypertRemoteService implements MatchService {
  static inject = ['gameControllers', 'gameDefinitions', 'gamePersistence']

  private readonly tails = new Map<MatchId, Promise<void>>()
  private readonly incompatibleRecoveries = new Set<string>()
  private readonly recoveryTimers = new Set<ReturnType<typeof setTimeout>>()
  private readonly controllerTasks = new Set<Promise<void>>()
  private recoveryDisposed = false

  constructor(ctx: Context) {
    super(ctx, 'matches')
    ctx.effect(() => ctx.gameControllers.onRegister((type) => {
      this.deferRecovery(`'${type}' controllers`, () => this.resumeControllers(type))
    }), 'game-engine.controller-registrations')
    ctx.effect(() => ctx.gameDefinitions.onRegister((gameId) => {
      this.deferRecovery(`'${gameId}' matches`, () => this.resumeControllers(undefined, gameId))
    }), 'game-engine.definition-registrations')
    ctx.effect(() => async () => {
      this.recoveryDisposed = true
      for (const timer of this.recoveryTimers) clearTimeout(timer)
      this.recoveryTimers.clear()
      await Promise.allSettled([...this.controllerTasks])
    }, 'game-engine.recovery-timers')
  }

  async create(request: CreateMatchRequest): Promise<MatchView> {
    const definition = this.ctx.gameDefinitions.require(request.gameId)
    const config = definition.validateConfig(request.config)
    if (request.seats.length === 0) throw new Error('a match requires at least one seat')
    if (new Set(request.seats.map(seat => seat.id)).size !== request.seats.length) throw new Error('match seat ids must be unique')
    if (request.seats.filter(seat => seat.controller.type === 'human').length > 1) throw new Error('a match supports at most one human seat')
    const createdAt = Date.now()
    const id = MatchId(crypto.randomUUID())
    const header = {
      id, formatVersion: 0 as const, gameId: definition.id, rulesVersion: definition.rulesVersion,
      config, seats: request.seats, createdAt,
    }
    const initial = definition.initial({ config, seats: request.seats })
    const events = this.ruleEvents(0, initial)
    const state = this.reduce(definition, initial)
    const pending = definition.pending(state)
    const complete = pending === undefined
    const batch = pending === undefined ? events : [...events, this.windowOpened(events.length, id, pending)]
    await this.ctx.gamePersistence.create({ ...header, events: batch })
    this.ctx.emit('match/changed', id, batch.length)
    const record = await this.requireRecord(id)
    void this.scheduleControllers(record, definition)
    return this.project(record, definition, undefined, complete)
  }

  async get(matchId: MatchId, humanSeat?: SeatId): Promise<MatchView | undefined> {
    const record = await this.ctx.gamePersistence.load(matchId)
    if (record === undefined) return undefined
    return this.project(record, this.definitionFor(record), humanSeat)
  }

  async list(): Promise<readonly MatchView[]> {
    const headers = await this.ctx.gamePersistence.list()
    const views: MatchView[] = []
    for (const header of headers) {
      const record = await this.requireRecord(header.id)
      views.push(this.project(record, this.definitionFor(record)))
    }
    return views.sort((left, right) => right.id.localeCompare(left.id))
  }

  async submit(request: SubmitActionRequest): Promise<MatchView> {
    return this.serial(request.matchId, async () => {
      const record = await this.requireRecord(request.matchId)
      const definition = this.definitionFor(record)
      const derived = this.derive(record, definition)
      const action = definition.validateAction(request.action)
      const prior = derived.commands.get(request.commandId)
      if (prior !== undefined) {
        if (prior.windowId !== request.windowId || prior.seatId !== request.seatId
          || JSON.stringify(prior.action) !== JSON.stringify(action)) throw new Error(`command '${request.commandId}' was reused with different input`)
        return this.project(record, definition, request.seatId)
      }
      if (derived.abandoned) throw new Error('match is abandoned')
      if (derived.window === undefined || derived.window.id !== request.windowId) throw new Error('action window is closed')
      if (!derived.window.window.requiredSeats.includes(request.seatId)) throw new Error(`seat '${request.seatId}' is not actionable`)
      if (derived.window.submissions.has(request.seatId)) throw new Error(`seat '${request.seatId}' already submitted`)
      const time = Date.now()
      const submission: MatchEvent = {
        seq: record.events.length,
        time,
        type: 'match/action-submitted',
        data: { windowId: request.windowId, commandId: request.commandId, seatId: request.seatId, action },
      }
      const submissions = new Map(derived.window.submissions)
      submissions.set(request.seatId, action)
      const batch: MatchEvent[] = [submission]
      if (derived.window.window.requiredSeats.every(seat => submissions.has(seat))) {
        const resolved = definition.resolve({ state: derived.state, window: derived.window.window, actions: submissions })
        batch.push(...this.ruleEvents(record.events.length + batch.length, resolved, time))
        batch.push({ seq: record.events.length + batch.length, time, type: 'match/action-closed', data: { windowId: request.windowId } })
        const nextState = resolved.reduce((state, event) => definition.reduce(state, event), derived.state)
        const pending = definition.pending(nextState)
        if (pending !== undefined) batch.push(this.windowOpened(record.events.length + batch.length, record.id, pending, time))
      }
      await this.ctx.gamePersistence.append(record.id, record.events.length, batch)
      const revision = record.events.length + batch.length
      this.ctx.emit('match/changed', record.id, revision)
      const committed = await this.requireRecord(record.id)
      void this.scheduleControllers(committed, definition)
      return this.project(committed, definition, request.seatId)
    })
  }

  async abandon(matchId: MatchId): Promise<MatchView> {
    const view = await this.serial(matchId, async () => {
      const record = await this.requireRecord(matchId)
      const definition = this.definitionFor(record)
      const derived = this.derive(record, definition)
      if (derived.abandoned || definition.pending(derived.state) === undefined) return this.project(record, definition)
      const event: MatchEvent = { seq: record.events.length, time: Date.now(), type: 'match/abandoned', data: {} }
      await this.ctx.gamePersistence.append(matchId, record.events.length, [event])
      this.ctx.emit('match/changed', matchId, record.events.length + 1)
      return this.project(await this.requireRecord(matchId), definition)
    })
    await this.ctx.gameControllers.cancel(matchId)
    return view
  }

  async retry(matchId: MatchId, seatId: SeatId): Promise<MatchView> {
    return this.serial(matchId, async () => {
      const record = await this.requireRecord(matchId)
      const definition = this.definitionFor(record)
      const derived = this.derive(record, definition)
      if (derived.abandoned || derived.window === undefined) throw new Error('match has no active action window')
      if (!derived.blockedSeats.has(seatId)) throw new Error(`seat '${seatId}' is not blocked`)
      const event: MatchEvent = {
        seq: record.events.length, time: Date.now(), type: 'match/controller-retried',
        data: { windowId: derived.window.id, seatId },
      }
      await this.ctx.gamePersistence.append(matchId, record.events.length, [event])
      this.ctx.emit('match/changed', matchId, record.events.length + 1)
      const committed = await this.requireRecord(matchId)
      void this.scheduleControllers(committed, definition)
      return this.project(committed, definition)
    })
  }

  private async serial<T>(matchId: MatchId, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(matchId) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => tail)
    this.tails.set(matchId, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.tails.get(matchId) === queued) this.tails.delete(matchId)
    }
  }

  private definitionFor(record: MatchRecord): GameDefinition {
    const definition = this.ctx.gameDefinitions.require(record.gameId)
    if (definition.rulesVersion !== record.rulesVersion) throw new Error(`unsupported rules version ${record.rulesVersion} for '${record.gameId}'`)
    return definition
  }

  private derive(record: MatchRecord, definition: GameDefinition): DerivedMatch {
    let state: unknown
    let window: { id: ActionWindowId; window: GameActionWindow; submissions: Map<SeatId, GameJson> } | undefined
    const commands = new Map<GameCommandId, { windowId: ActionWindowId; seatId: SeatId; action: GameJson }>()
    const blockedSeats = new Map<SeatId, string>()
    let abandoned = false
    for (const event of record.events) {
      const data = asObject(event.data)
      if (event.type === 'match/rule') {
        state = definition.reduce(state, { type: asString(data.ruleType, 'ruleType'), data: data.ruleData ?? null })
      } else if (event.type === 'match/action-opened') {
        const required = data.requiredSeats
        if (!Array.isArray(required)) throw new Error('corrupt match event requiredSeats')
        window = {
          id: ActionWindowId(asString(data.windowId, 'windowId')),
          window: { key: asString(data.key, 'key'), requiredSeats: required.map(value => SeatId(asString(value, 'requiredSeats'))) },
          submissions: new Map(),
        }
        blockedSeats.clear()
      } else if (event.type === 'match/action-submitted') {
        if (window === undefined || window.id !== data.windowId) throw new Error('corrupt match submission window')
        const seat = SeatId(asString(data.seatId, 'seatId'))
        const action = data.action ?? null
        window.submissions.set(seat, action)
        blockedSeats.delete(seat)
        commands.set(GameCommandId(asString(data.commandId, 'commandId')), { windowId: window.id, seatId: seat, action })
      } else if (event.type === 'match/controller-blocked') {
        if (window === undefined || window.id !== data.windowId) throw new Error('corrupt match controller failure window')
        blockedSeats.set(SeatId(asString(data.seatId, 'seatId')), asString(data.message, 'message'))
      } else if (event.type === 'match/controller-retried') {
        if (window === undefined || window.id !== data.windowId) throw new Error('corrupt match controller retry window')
        blockedSeats.delete(SeatId(asString(data.seatId, 'seatId')))
      } else if (event.type === 'match/action-closed') {
        window = undefined
        blockedSeats.clear()
      } else if (event.type === 'match/abandoned') {
        window = undefined
        blockedSeats.clear()
        abandoned = true
      }
    }
    if (state === undefined) throw new Error(`match '${record.id}' has no initial rule event`)
    return { state, ...(window === undefined ? {} : { window }), commands, abandoned, blockedSeats }
  }

  private project(record: MatchRecord, definition: GameDefinition, seat?: SeatId, knownComplete?: boolean): MatchView {
    const derived = this.derive(record, definition)
    const finished = knownComplete ?? definition.pending(derived.state) === undefined
    return {
      id: record.id,
      gameId: record.gameId,
      revision: record.events.length,
      status: derived.abandoned ? 'abandoned' : finished ? 'finished' : derived.blockedSeats.size > 0 ? 'blocked' : 'active',
      seats: record.seats,
      blockedSeats: [...derived.blockedSeats].map(([seatId, message]) => ({ seatId, message })),
      ...(derived.window === undefined ? {} : {
        window: {
          id: derived.window.id,
          requiredSeats: derived.window.window.requiredSeats,
          submittedSeats: [...derived.window.submissions.keys()],
        },
      }),
      game: definition.view(derived.state, seat),
    }
  }

  private reduce(definition: GameDefinition, events: readonly GameRuleEvent[]): unknown {
    return events.reduce<unknown>((state, event) => definition.reduce(state, event), undefined)
  }

  private ruleEvents(start: number, events: readonly GameRuleEvent[], time = Date.now()): MatchEvent[] {
    return events.map((event, index) => ({ seq: start + index, time, type: 'match/rule', data: { ruleType: event.type, ruleData: event.data } }))
  }

  private windowOpened(seq: number, matchId: MatchId, window: GameActionWindow, time = Date.now()): MatchEvent {
    return { seq, time, type: 'match/action-opened', data: { windowId: `${matchId}:window:${seq}`, key: window.key, requiredSeats: window.requiredSeats } }
  }

  private async requireRecord(matchId: MatchId): Promise<MatchRecord> {
    const record = await this.ctx.gamePersistence.load(matchId)
    if (record === undefined) throw new Error(`unknown match '${matchId}'`)
    return record
  }

  /** Create a match through the JSON wire boundary.
   * @param request - wire setup.
   * @returns created view.
   */
  @Remote('create')
  async remoteCreate(request: GameRemoteCreateRequest): Promise<GameRemoteMatchView> {
    const seats = request.seats.map(seat => ({ ...seat, id: SeatId(seat.id) }))
    await Promise.all(seats.flatMap((seat) => {
      const controller = seat.controller
      return controller.type === 'human' ? [] : [
        this.ctx.gameControllers.availability(controller.type, controller).then((availability) => {
          if (!availability.available) throw new Error(availability.message ?? `provider '${controller.provider}' is unavailable`)
        }),
      ]
    }))
    return this.create({
      gameId: request.gameId,
      config: request.config,
      seats,
    })
  }

  /** List public match views through the Host/Client wire.
   * @returns committed views.
   */
  @Remote('list')
  remoteList(): Promise<readonly GameRemoteMatchView[]> {
    return this.list()
  }

  /** List registered games and their deployment-resolved setup schemas.
   * @returns stable game metadata.
   */
  @Remote('catalog')
  remoteCatalog(): readonly GameRemoteGameInfo[] {
    return this.ctx.gameDefinitions.list().map(definition => ({ id: definition.id, configSchema: definition.configSchema }))
  }

  /** Return the human-safe view.
   * @param matchId - wire match id.
   * @returns committed view, if present.
   */
  @Remote('get')
  async remoteGet(matchId: string): Promise<GameRemoteMatchView | undefined> {
    const brandedMatchId = MatchId(matchId)
    const record = await this.ctx.gamePersistence.load(brandedMatchId)
    const humanSeat = record?.seats.find(seat => seat.controller.type === 'human')?.id
    return this.get(brandedMatchId, humanSeat)
  }

  /** Submit an action through the JSON wire boundary.
   * @param request - wire command.
   * @returns resulting view.
   */
  @Remote('submit')
  async remoteSubmit(request: GameRemoteSubmitRequest): Promise<GameRemoteMatchView> {
    const matchId = MatchId(request.matchId)
    const record = await this.requireRecord(matchId)
    const humanSeat = record.seats.find(seat => seat.controller.type === 'human')
    if (humanSeat === undefined) throw new Error('this match has no human-controlled seat')
    return this.submit({
      matchId,
      windowId: ActionWindowId(request.windowId),
      commandId: GameCommandId(request.commandId),
      seatId: humanSeat.id,
      action: request.action,
    })
  }

  /** Abandon the selected match through the JSON wire boundary.
   * @param matchId - wire match id.
   * @returns committed terminal view.
   */
  @Remote('abandon')
  remoteAbandon(matchId: string): Promise<GameRemoteMatchView> {
    return this.abandon(MatchId(matchId))
  }

  /** Retry one blocked AI seat through the JSON wire boundary.
   * @param matchId - wire match id.
   * @param seatId - blocked wire seat id.
   * @returns committed match view after the retry event.
   */
  @Remote('retry')
  remoteRetry(matchId: string, seatId: string): Promise<GameRemoteMatchView> {
    return this.retry(MatchId(matchId), SeatId(seatId))
  }

  /** Check configured AI routes from the Host that will run them.
   * @param candidates - provider and model routes shown by the product.
   * @returns route availability in candidate order.
   */
  @Remote('providerAvailability')
  async remoteProviderAvailability(
    candidates: readonly { readonly provider: string; readonly model: string }[],
  ): Promise<readonly GameRemoteProviderAvailability[]> {
    return Promise.all(candidates.map(async (candidate) => {
      const result = await this.ctx.gameControllers.availability('agent', { type: 'agent', ...candidate })
      return { ...candidate, ...result }
    }))
  }

  private async scheduleControllers(record: MatchRecord, definition: GameDefinition, validatePersisted = false): Promise<void> {
    const derived = this.derive(record, definition)
    if (derived.window === undefined) return
    for (const seat of record.seats) {
      if (seat.controller.type === 'human'
        || !this.ctx.gameControllers.has(seat.controller.type)
        || !derived.window.window.requiredSeats.includes(seat.id)
        || derived.window.submissions.has(seat.id)
        || derived.blockedSeats.has(seat.id)) continue
      if (validatePersisted) {
        const recoveryKey = `${record.id}:${seat.id}:${derived.window.id}`
        try {
          await this.ctx.gameControllers.validate(seat.controller.type, seat.controller)
          this.incompatibleRecoveries.delete(recoveryKey)
        } catch (error) {
          if (!this.incompatibleRecoveries.has(recoveryKey)) {
            this.incompatibleRecoveries.add(recoveryKey)
            this.ctx.logger.warn(`game-engine: preserved open match '${record.id}' without resuming seat '${seat.id}': ${error instanceof Error ? error.message : String(error)}`)
          }
          continue
        }
      }
      this.trackController(record.id, this.ctx.gameControllers.drive(seat.controller.type, {
        matchId: record.id,
        seat,
        windowId: derived.window.id,
        prompt: definition.modelPrompt(derived.state, seat.id),
        actionSchema: definition.actionSchema,
      }), seat.id, derived.window.id)
    }
  }

  private async resumeControllers(type?: string, gameId?: string): Promise<void> {
    const headers = await this.ctx.gamePersistence.list()
    for (const header of headers) {
      if (gameId !== undefined && header.gameId !== gameId) continue
      try {
        const record = await this.requireRecord(header.id)
        if (type !== undefined && !record.seats.some(seat => seat.controller.type === type)) continue
        await this.scheduleControllers(record, this.definitionFor(record), true)
      } catch (error) {
        this.ctx.logger.warn(`game-engine: preserved match '${header.id}' without recovery: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private trackController(matchId: MatchId, task: Promise<void>, seatId: SeatId, windowId: ActionWindowId): void {
    const tracked = task.catch(async (error: unknown) => {
      if (this.recoveryDisposed) return
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`game-engine: controller '${seatId}' failed for window '${windowId}': ${message}`)
      await this.serial(matchId, async () => {
        const record = await this.requireRecord(matchId)
        const definition = this.definitionFor(record)
        const derived = this.derive(record, definition)
        if (derived.abandoned || derived.window?.id !== windowId || derived.window.submissions.has(seatId)
          || derived.blockedSeats.has(seatId)) return
        const event: MatchEvent = {
          seq: record.events.length, time: Date.now(), type: 'match/controller-blocked',
          data: { windowId, seatId, message },
        }
        await this.ctx.gamePersistence.append(matchId, record.events.length, [event])
        this.ctx.emit('match/changed', matchId, record.events.length + 1)
      }).catch((persistError: unknown) => {
        this.ctx.logger.warn(`game-engine: failed to persist controller failure for '${seatId}': ${persistError instanceof Error ? persistError.message : String(persistError)}`)
      })
    }).finally(() => { this.controllerTasks.delete(tracked) })
    this.controllerTasks.add(tracked)
  }

  private deferRecovery(label: string, recover: () => Promise<void>): void {
    if (this.recoveryDisposed) return
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(timer)
      if (this.recoveryDisposed) return
      void recover().catch((error: unknown) => {
        this.ctx.logger.warn(`game-engine: could not resume ${label}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, 0)
    this.recoveryTimers.add(timer)
  }
}

/** Register ephemeral persistence for development and tests.
 * @param ctx - composition context.
 */
export function applyMemoryPersistence(ctx: Context): void {
  ctx.provide('gamePersistence', new MemoryGamePersistence())
}

export default GameEngine
