# `@deepseek-ai/dsh-game-rps`

English | [中文](README.zh.md)

`dsh-game-rps` registers the `rps` game definition. A match has exactly two seats and a fixed positive `roundCount`; `maxRounds` limits deployment cost and defaults to 20.

Each round opens one simultaneous action window. Choices stay in submission events until both seats act, then `rps/round-resolved` reveals both choices and records the winner. The match finishes after exactly the configured number of rounds, and equal scores produce a draw.

## Configuration

- `defaultRounds` defaults to `3`.
- `maxRounds` defaults to `20` and must be at least `defaultRounds`.

## Model Experience

### RPS action

#### What the model sees

The AI sees the RPS rules, its current seat observation, and a schema accepting exactly `rock`, `paper`, or `scissors`. Sealed opponent choices are absent.

#### Token effect

One compact rules-and-state prompt is added to each AI action request.

#### KV Cache effect

The rules prefix is stable; round history and action-window identity append changing content.

## Known Limitations and Deferred Work

- The definition supports exactly two seats and a fixed round count; tournament brackets and alternate scoring are outside this plugin.
