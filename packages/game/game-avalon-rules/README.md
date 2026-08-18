# `@deepseek-ai/dsh-game-avalon-rules`

English | [中文](README.zh.md)

`dsh-game-avalon-rules` is the pure rule catalog shared by the Avalon game definition and browser setup. It owns the supported role ids, Chinese labels and ability descriptions, faction and cooperative-evil membership, fair preset decks, mission sizes, and mission failure thresholds for five- through eight-player tables.

The public API resolves only complete presets: `basic` and `percival-morgana` support every table size, while `mordred-oberon` supports seven and eight players. It does not assign seats, validate actions, reduce events, or project private information; those responsibilities stay in `dsh-game-avalon`.

## Model Experience

### Avalon role and mission catalog

#### What the model sees

This package sends no model request. `dsh-game-avalon` renders its resolved deck, mission rules, role labels, and ability descriptions into the seat-private Chinese prompt.

#### Token effect

The package adds no prompt by itself; consumers choose which resolved rule facts to include.

#### KV Cache effect

Preset metadata is immutable for a match, so consumer-rendered rule text can remain in the stable prompt prefix.

## Known Limitations and Deferred Work

- The catalog intentionally supports only validated five- through eight-player presets; arbitrary role lists and nine-or-more-player mission tables are outside this package.
