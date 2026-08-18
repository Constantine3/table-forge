# Game engine

English | [中文](game.zh.md)

The game subsystem runs deterministic, event-sourced matches whose seats may be human or independently configured AI agents. The shipped product includes rock-paper-scissors for human-versus-AI or AI-versus-AI play and five- through eight-player Avalon with either one human and the remaining AI seats or an AI-only table.

## Ownership

`@deepseek-ai/dsh-game` defines the shared vocabulary and the `gameDefinitions`, `gameControllers`, `gamePersistence`, and `matches` services. `game-engine` owns commands and the append-only match log, `game-persistence-sqlite` owns the on-disk provider, `game-controller-agent` adapts an AI seat to a dedicated Agent and Session, and `game-rps` and `game-avalon` own only pure rules. The generic `ui-game` root owns catalog, durable selection, and Remote operations; `ui-game-rps` and `ui-game-avalon` own their setup and board surfaces.

A game definition publishes its deployment-resolved setup schema, validates configuration and each seat's current action, emits rule events, reduces them to state, declares its active action window, and projects public or seat-scoped views. Each window declares whether its participating seats and submission status are public or restricted to required seats. The definition performs no I/O. The Remote catalog pairs each setup schema with its rules version, and browser creation echoes that version so a stale page is rejected before provider checks or persistence. The engine accepts commands idempotently, atomically creates a match with its initial events, appends later event batches before publishing `match/changed`, and reconstructs every view from the log. Definition and controller registration resumes compatible pending AI actions after restart. Matches with an unsupported format or game rules version stay stored but are unavailable through product listing and restore.

## Hidden actions

An action window lists every seat that must act. Submissions are durable but their action data is absent from match projections until all required seats submit. The engine then closes the window and asks the rules definition for deterministic resolution events. This prevents a later AI seat from observing an earlier sealed choice. Restricted windows additionally hide participating seat ids, submission status, and controller-failure ownership from non-participants; only the actionable seat receives its current JSON schema.

## Five- through eight-player Avalon

Avalon setup selects a server-validated role preset and persists that preset with the private-seed assignment so replay remains deterministic. The default pairs Percival with Morgana, the basic preset uses Merlin, the Assassin, Loyal Servants, and Minions, and a seven- or eight-player advanced preset pairs Mordred with Oberon. The browser-safe `@deepseek-ai/dsh-game-avalon-rules` package supplies the same role catalog, decks, and mission rules to the definition and setup UI; arbitrary role assembly is not accepted. A leader publishes a team and chooses clockwise or counterclockwise discussion. The adjacent seat in that direction starts, every non-leader speaks in order, and the leader gives the final summary statement and final team. Every seat receives a sealed statement-free approval vote only after all statements commit, and approved team members submit sealed quest actions. Mission sizes are 2, 3, 2, 3, and 3 for five players; 2, 3, 4, 3, and 4 for six; 2, 3, 3, 4, and 4 for seven; and 3, 4, 4, 5, and 5 for eight. A proposed team needs three approvals for five players, four for six or seven, and five for eight. Every mission fails on one failure action except the fourth mission for seven or eight players, which requires two. Three failures or five consecutive rejected teams give evil victory. Three successes open restricted sequential cooperative-evil discussion followed by the Assassin's target action, and only the final resolution reveals all roles.

An active seat projection contains only the role knowledge allowed by the selected preset. Merlin sees evil except Mordred, Percival receives Merlin and Morgana as indistinguishable candidates, cooperative evil roles recognize one another, and Oberon receives no ally knowledge or private discussion. Quest resolution publishes only the failure count. The browser never identifies the Assassin while that private action is pending.

## AI seats

Each AI seat has its own provider, model, display name, Agent, and Session. The controller uses a deployment-configured complete player instruction, suppresses generic coding-agent context, and registers one `submit_game_action` tool for the exact controller request. The shipped instruction requires Simplified Chinese for reasoning and natural-language output while preserving protocol identifiers exactly. The model receives the rules, its seat-scoped observation, current action-window identity, and its current JSON schema, while the controller binds the tool to that identity so the model submits only game data. The durable Session request event records these inputs. The match engine still rejects a delayed call after the window changes. Controller work is serialized per seat, so opening the next window cannot overlap the previous Agent turn.

The match log and AI Session log serve different purposes. Match events are authoritative game facts. Session events reconstruct the exact prompt and tool call visible to one model.

Controller exhaustion records a blocked-seat event instead of leaving an indefinitely active table. The blocked state survives restart and prevents automatic redispatch until an operator retries the current blocks or abandons the match. Restore, table selection, refresh, active play, and abandonment never read AI Session logs. The browser can load those logs only after a normally finished match and only after an explicit audit action; abandoned matches cannot be audited.

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

Source: [`packages/game/game/src/index.ts:299`](../../packages/game/game/src/index.ts)

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

Source: [`packages/game/game/src/index.ts:399`](../../packages/game/game/src/index.ts)

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

Source: [`packages/game/game/src/index.ts:180`](../../packages/game/game/src/index.ts)

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

Source: [`packages/game/game/src/index.ts:238`](../../packages/game/game/src/index.ts)

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

Source: [`packages/game/game/src/index.ts:474`](../../packages/game/game/src/index.ts)
<!-- END GENERATED cordis-surface -->
