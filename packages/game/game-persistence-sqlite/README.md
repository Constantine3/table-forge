# `@deepseek-ai/dsh-game-persistence-sqlite`

English | [中文](README.zh.md)

This provider stores match headers and append-only events in SQLite. Match creation commits the header and initial events in one transaction; each later append checks the expected revision and commits the complete event batch in one transaction. Loaded headers, seats, event envelopes, and JSON values are validated before entering the engine. The current record format is `1`, which includes action-window audience metadata and original command inputs for exact replay. Direct loads reject format `0` and other unknown formats; listings omit those rows without deleting or migrating them.

Configure `path` with a dedicated database path. `:memory:` is supported for tests.

## Model Experience

### Durable match log

#### What the model sees

Nothing directly. Controllers receive projections reconstructed by the engine, never `match_events` rows.

#### Token effect

Zero tokens.

#### KV Cache effect

No effect; persistence does not mutate model requests or Session history.

## Known Limitations and Deferred Work

- Pre-release schema changes require a fresh database. Unsupported match-format rows remain stored but unavailable; migrations, product deletion, and archival export are not implemented.
