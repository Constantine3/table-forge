# 游戏引擎

[English](game.md) | 中文

游戏子系统运行确定性、事件溯源的对局，其中席位可以由人类或独立配置的 AI Agent 控制。首个规则定义是剪刀石头布，支持人类对 AI 与 AI 对 AI，并可配置 1–20 局。

## 所有权

`@deepseek-ai/dsh-game` 定义共享词汇以及 `gameDefinitions`、`gameControllers`、`gamePersistence` 和 `matches` 服务。`game-engine` 拥有命令与只追加的对局日志，`game-persistence-sqlite` 拥有磁盘提供方，`game-controller-agent` 把一个 AI 席位适配为专属 Agent 与 Session，`game-rps` 只拥有纯规则。

游戏定义发布经部署配置解析后的设置 schema，验证配置与动作、产生规则事件、将事件归约为状态、声明当前动作窗口并投影公开或席位范围的视图。它不执行 I/O。引擎以幂等方式接受命令，以原子方式创建对局及其初始事件，在发布 `match/changed` 前追加后续事件批次，并从日志重建所有视图。定义和控制器注册后会恢复兼容的待处理 AI 动作。

## 隐藏的同时动作

动作窗口列出必须行动的全部席位。提交会持久化，但在所有必需席位完成前不会出现在对局投影中。随后引擎关闭窗口，并请求规则定义产生确定性的裁定事件。因此后行动的 AI 席位无法看到较早提交的封存选择。

## AI 席位

每个 AI 席位拥有自己的提供方、模型、显示名称、Agent 与 Session。控制器使用部署配置的完整玩家指令、屏蔽通用编码 agent 上下文，并在该 Agent 的范围内只暴露 `submit_game_action`。模型收到规则、席位范围的观察以及当前动作窗口标识，而控制器会将工具绑定到该标识，因此模型只提交游戏数据。窗口变化后，对局引擎仍会拒绝延迟调用。控制器工作按席位串行，因此打开下一窗口不会与上一 Agent 回合重叠。

对局日志与 AI Session 日志用途不同。对局事件是权威游戏事实；Session 事件重建某个模型实际看到的提示词与工具调用。

控制器尝试耗尽后会记录阻塞席位事件，而不是留下无限期的活跃牌桌。阻塞状态在重启后仍然存在，并阻止自动重新分派，直到操作员重试该席位或结束对局。浏览器公开这两项操作，并把 AI Session 日志作为本地审计视图读取。

## 装配

交付的 `game` profile 依次叠加 `dsh-base`、`dsh-web-app` 和 `dsh-game-app`。使用 `dsh game` 启动；部署可以通过后续 Cordis patch 层替换规则定义、持久化、控制器或浏览器插件。浏览器列出持久化牌桌，并且只选择从游戏 Host 可达的已配置路由。Host 探测部署配置的端点，因此离开局域网后自部署路由会禁用，但可达的云端路由仍然保留。创建操作会在持久化前再次检查可达性并解析模型。凭据保持为环境变量引用，不会成为浏览器设置或提交内容。

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
