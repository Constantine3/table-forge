# `@deepseek-ai/dsh-game-engine`

English | [中文](README.zh.md)

`dsh-game-engine` serializes commands per match, atomically creates the header with its initial events, appends complete event batches before publishing revisions, and reconstructs every view from the durable log. Simultaneous submissions remain private until the game definition emits its resolution event. A newly registered definition or controller validates persisted seat routes before resuming compatible open AI action windows after process restart; one unavailable definition or incompatible controller cannot block recovery of other matches.

The Remote surface validates configured AI provider/model pairs and Host-side route availability before creation. Browser action submissions are assigned to the match's sole human seat; an AI-only match cannot accept a browser action. Controller failures become durable blocked-seat events, so restart does not dispatch the same failed window again. Retry clears one block before dispatching that seat, while abandonment is a durable terminal event that drains controller work before completion.

`MemoryGamePersistence` supports tests and disposable compositions. Durable products provide `ctx.gamePersistence` before loading `GameEngine`.

## Model Experience

### Controller dispatch

#### What the model sees

The engine calls `modelPrompt` and passes only that seat observation, the action schema, and active window id to a controller. It sends no model request itself.

#### Token effect

Zero direct tokens; the selected controller owns request cost.

#### KV Cache effect

No direct effect. Event reconstruction does not rewrite an AI Session.

## Known Limitations and Deferred Work

- A match supports at most one human seat in the initial product composition.
