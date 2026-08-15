# `@deepseek-ai/dsh-game-controller-agent`

English | [中文](README.zh.md)

This provider registers the `agent` seat controller. Each AI seat owns an independent Agent and Session, receives only its definition-projected observation, and can call only the `submit_game_action` instance registered for that controller request when the game composition mounts no global tools. Its complete scoped system prompt suppresses generic coding-agent sections and runtime workspace context. The durable game-request Session event records the window id, observation, and seat-specific action schema that reach the model.

The tool is bound to the exact active window id by the controller, so the model submits only its action and cannot mistype routing data. A delayed call cannot select an action in a later round, and the idempotency key scopes the model's tool-call id to that window and seat. A successful submission concludes the Agent turn, so no second model request generates a redundant acknowledgement. Each attempt confirms the request's durable inbox receipt before awaiting whole-agent idle. The provider retries when that interval ends without an accepted action, up to `maxAttemptsPerAction` (default 2), then rejects the drive without inventing a move. After restart, it resumes a materialized seat Session instead of replacing its audit history.

Provider and model come from the persisted seat specification. The display name comes from the seat, while `playerInstruction` is deployment configuration shared by AI players. `maxTokensPerRequest` (default 16,384) limits every model request made by a newly created or resumed AI seat. The selected adapter translates that provider-neutral limit to its wire protocol; it bounds generated tokens rather than elapsed time. `timeoutRetryReasoningEfforts` maps exact provider and model ids to the reasoning effort used after a `TIMEOUT` until that seat submits its game action; model validation rejects a configured route that does not offer its mapped effort. Match events remain authoritative; replay never invokes the model.

Deployments may configure `providerProbes` for routes whose model catalog can resolve even when their network endpoint is unreachable. The controller probes those endpoints from the game Host, because that process makes model requests. An unavailable LAN route is disabled in setup while reachable cloud routes remain selectable, and creation repeats the check before persistence.

When all attempts fail, the engine records the seat failure and exposes a blocked match. The operator can retry that seat without losing the match or abandon it from the browser.

## Model Experience

### AI seat turn

#### What the model sees

The model receives the configured player instruction, game rules, seat-scoped observation, active window id, and only `submit_game_action`. The shipped game profile requires Simplified Chinese for every reasoning block, natural-language answer, and public statement, plus explicit reasoning before every submission over the observation, prior rounds, score and objective, uncertainty and hidden information, opponent tendencies, candidate actions, risks, and likely counterplay without inventing unobserved information. Protocol JSON keys, action tags, enum values, and seat ids remain exact. It never receives raw match events, runtime workspace context, or another seat's Session.

#### Token effect

One Agent turn is requested per action. A successful first-step tool call spends no acknowledgement request. Each model request uses the configured `maxTokensPerRequest` limit, with at most `maxAttemptsPerAction - 1` retries after an idle turn without a valid submission; requests after `TIMEOUT` use the exact route's `timeoutRetryReasoningEfforts` entry when configured.

#### KV Cache effect

Each seat has an independent cache lineage. Persona and rules are stable candidates; observations and window ids change between rounds.

## Known Limitations and Deferred Work

- Provider probes test TCP reachability only; authentication and API compatibility are still verified by the first model request.
