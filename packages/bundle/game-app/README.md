# `@deepseek-ai/dsh-game-app`

English | [中文](README.zh.md)

`dsh-game-app` is the Table Forge product layer. It stacks after `dsh-web-app`, mounting the game registries, SQLite match persistence, event-sourced engine, rock-paper-scissors and five-, six-, or seven-player Avalon definitions, Agent controller, generic browser root, and both game surfaces.

Run the shipped composition with `dsh game`. The game profile configures `deepseek-self-deployment` (`deepseek-v4-flash-vision` at `http://127.0.0.1:4100/v1`, maximum reasoning, ten-minute stream idle allowance) and `hy3-tokenhub` (`hy3` through Tencent TokenHub, high reasoning). The Agent controller limits every model request to 16,384 output tokens on either route and uses `high` reasoning after a timeout until the action succeeds. Game setup lists active configured providers and never exposes model, endpoint, or credential fields; credentials resolve from `DEEPSEEK_API_KEY` and `HY3_TOKENHUB_API_KEY`. The Host probes the LAN-only self-deployment before selection, while TokenHub remains the cloud fallback when that route is unreachable. A later profile patch can change this catalog or add another game definition without changing the engine.

## Model Experience

### AI seat turn

#### What the model sees

Each configured AI seat receives its rules, seat-scoped observation, action-window id, and the `submit_game_action` tool. The shipped instruction requires Simplified Chinese for all reasoning and natural-language output while preserving protocol identifiers exactly. It cannot inspect another seat's sealed actions.

#### Token effect

One bounded Agent turn is requested per AI action. A successful action tool call ends the turn without an acknowledgement request. Every model request has a 16,384-token output limit, plus at most `maxAttemptsPerAction - 1` retries when no valid action is submitted. After a timeout, the shipped route map lowers the local model from `max` to `high` reasoning and the cloud model from `high` to `low` until submission succeeds.

#### KV Cache effect

Each seat has an independent Session. Stable rules and persona prefixes may be reused by its provider; observations and action-window ids change each round.

## Known Limitations and Deferred Work

- Avalon supports one human with the remaining AI seats or an AI-only table; the shipped product has no matchmaking, multi-browser spectating, or multi-browser table coordination.
