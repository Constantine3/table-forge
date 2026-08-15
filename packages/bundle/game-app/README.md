# `@deepseek-ai/dsh-game-app`

English | [中文](README.zh.md)

`dsh-game-app` is the Table Forge product layer. It stacks after `dsh-web-app`, mounting the game registries, SQLite match persistence, event-sourced engine, rock-paper-scissors definition, Agent controller, and dedicated browser root.

Run the shipped composition with `dsh game`. The game profile configures `deepseek-self-deployment` (`deepseek-v4-flash-vision` at `http://127.0.0.1:4100/v1`, maximum reasoning, ten-minute stream idle allowance) and `hy3-tokenhub` (`hy3` through Tencent TokenHub, high reasoning). Game setup lists active configured providers and never exposes model, endpoint, or credential fields; credentials resolve from `DEEPSEEK_API_KEY` and `HY3_TOKENHUB_API_KEY`. The Host probes the LAN-only self-deployment before selection, while TokenHub remains the cloud fallback when that route is unreachable. A later profile patch can change this catalog or add another game definition without changing the engine.

## Model Experience

### AI seat turn

#### What the model sees

Each configured AI seat receives its rules, seat-scoped observation, action-window id, and the `submit_game_action` tool. It cannot inspect another seat's sealed actions.

#### Token effect

One bounded Agent turn is requested per AI action, plus at most `maxAttemptsPerAction - 1` retries when no valid action is submitted.

#### KV Cache effect

Each seat has an independent Session. Stable rules and persona prefixes may be reused by its provider; observations and action-window ids change each round.

## Known Limitations and Deferred Work

- The shipped product exposes only rock-paper-scissors and has no lobby, spectator view, or durable match-history picker.
