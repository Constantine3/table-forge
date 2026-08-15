# `@deepseek-ai/dsh-game-persistence-sqlite`

English | [中文](README.zh.md)

This provider stores match headers and append-only events in SQLite. Match creation commits the header and initial events in one transaction; each later append checks the expected revision and commits the complete event batch in one transaction. Loaded headers, seats, event envelopes, and JSON values are validated before entering the engine. A database with an unknown schema or match format is rejected; pre-release formats are not migrated.

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

- Pre-release schema and match-format changes require a fresh database; migrations and archival export are not implemented.
