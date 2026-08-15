# Game engine

English | [中文](game.zh.md)

The game subsystem runs deterministic, event-sourced matches whose seats may be human or independently configured AI agents. The first definition is rock-paper-scissors, supporting human versus AI and AI versus AI for 1–20 configured rounds.

## Ownership

`@deepseek-ai/dsh-game` defines the shared vocabulary and the `gameDefinitions`, `gameControllers`, `gamePersistence`, and `matches` services. `game-engine` owns commands and the append-only match log, `game-persistence-sqlite` owns the on-disk provider, `game-controller-agent` adapts an AI seat to a dedicated Agent and Session, and `game-rps` owns only pure rules.

A game definition publishes its deployment-resolved setup schema, validates configuration and actions, emits rule events, reduces them to state, declares its active action window, and projects public or seat-scoped views. It performs no I/O. The engine accepts commands idempotently, atomically creates a match with its initial events, appends later event batches before publishing `match/changed`, and reconstructs every view from the log. Definition and controller registration resumes compatible pending AI actions after restart.

## Hidden simultaneous actions

An action window lists every seat that must act. Submissions are durable but absent from match projections until all required seats submit. The engine then closes the window and asks the rules definition for deterministic resolution events. This prevents a later AI seat from observing an earlier sealed choice.

## AI seats

Each AI seat has its own provider, model, display name, Agent, and Session. The controller uses a deployment-configured complete player instruction, suppresses generic coding-agent context, and exposes only `submit_game_action` inside that Agent scope. The model receives the rules, its seat-scoped observation, and the current action-window identity, while the controller binds the tool to that identity so the model submits only game data. The match engine still rejects a delayed call after the window changes. Controller work is serialized per seat, so opening the next window cannot overlap the previous Agent turn.

The match log and AI Session log serve different purposes. Match events are authoritative game facts. Session events reconstruct the exact prompt and tool call visible to one model.

Controller exhaustion records a blocked-seat event instead of leaving an indefinitely active table. The blocked state survives restart and prevents automatic redispatch until an operator retries that seat or abandons the match. The browser exposes both operations and reads the AI Session logs as a local audit view.

## Composition

The shipped `game` profile stacks `dsh-base`, `dsh-web-app`, and `dsh-game-app`. Run it with `dsh game`; deployments can replace definitions, persistence, controllers, or the browser plugin through later Cordis patch layers. The browser lists durable tables and selects only configured routes that are reachable from the game Host. The Host probes deployment-configured endpoints, so leaving the LAN disables the self-deployed route without hiding a reachable cloud route. Creation repeats availability and model resolution before persistence. Credentials remain environment references rather than browser settings or committed values.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgamecontrollers--gamecontrollerregistry"></a>

### `ctx.gameControllers` — `GameControllerRegistry`

Effect-owned registry of controller providers.

```ts cordis-catalog
/** Register one controller type.
 * @param type - discriminator.
 * @param provider - implementation.
 * @returns stale-safe disposer.
 */
register(type: string, provider: GameControllerProvider): () => void

/** Dispatch a controller request.
 * @param type - discriminator.
 * @param request - active request.
 * @returns provider completion.
 */
drive(type: string, request: GameControllerRequest): Promise<void>

/** Stop controller work for one match through every registered provider.
 * @param matchId - match whose work must quiesce.
 * @returns completion after all providers settle.
 */
async cancel(matchId: MatchId): Promise<void>

/** Validate one controller specification through its owning provider.
 * @param type - controller discriminator.
 * @param controller - unpersisted specification.
 * @returns validation completion.
 */
validate(type: string, controller: SeatControllerSpec): Promise<void>

/** Check current endpoint availability through the owning provider.
 * @param type - controller discriminator.
 * @param controller - controller specification to check.
 * @returns current reachability and an optional diagnostic.
 */
availability(type: string, controller: SeatControllerSpec): Promise<{ readonly available: boolean; readonly message?: string }>

/** Test whether a controller type is currently available.
 * @param type - controller discriminator.
 * @returns whether a provider owns the type.
 */
has(type: string): boolean

/** Observe current and future successful controller registrations.
 * @param listener - callback invoked for available providers and later registrations.
 * @returns stale-safe disposer.
 */
onRegister(listener: (type: string) => void): () => void
```

Source: [`packages/game/game/src/index.ts:246`](../../packages/game/game/src/index.ts)

<a id="ctxgamedefinitions--gamedefinitionregistry"></a>

### `ctx.gameDefinitions` — `GameDefinitionRegistry`

Effect-owned registry of versioned game definitions.

```ts cordis-catalog
/** Register one definition.
 * @param definition - rules definition.
 * @returns stale-safe disposer.
 */
register(definition: GameDefinition): () => void

/** Resolve a definition.
 * @param id - game id.
 * @returns matching definition.
 */
require(id: string): GameDefinition

/** List registered definitions.
 * @returns definitions in stable id order.
 */
list(): readonly GameDefinition[]

/** Observe current and future successful definition registrations.
 * @param listener - callback invoked for available definitions and later registrations.
 * @returns stale-safe disposer.
 */
onRegister(listener: (gameId: string) => void): () => void
```

Source: [`packages/game/game/src/index.ts:346`](../../packages/game/game/src/index.ts)

<a id="ctxgamepersistence--gamepersistence"></a>

### `ctx.gamePersistence` — `GamePersistence`

Atomic persistence operations required by the match engine.

```ts cordis-catalog
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
```

Source: [`packages/game/game/src/index.ts:133`](../../packages/game/game/src/index.ts)

<a id="ctxmatches--matchservice"></a>

### `ctx.matches` — `MatchService`

Runtime match operations supplied by the concrete engine provider.

```ts cordis-catalog
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
```

Source: [`packages/game/game/src/index.ts:185`](../../packages/game/game/src/index.ts)

<a id="match-events"></a>

### `match/*` events

<a id="matchchanged--parallel"></a>

#### `match/changed` — parallel

Notify consumers that a committed match revision is available.

```ts cordis-catalog
/**
 * Notify consumers that a committed match revision is available.
 * @mode parallel
 * @param matchId - changed match.
 * @param revision - committed revision.
 */
'match/changed'(matchId: MatchId, revision: number): void
```

Source: [`packages/game/game/src/index.ts:421`](../../packages/game/game/src/index.ts)
<!-- END GENERATED cordis-surface -->
