# `@deepseek-ai/dsh-client-ui-game`

English | [中文](README.zh.md)

This browser plugin owns the product root for match setup and play. It supports human-versus-AI and AI-versus-AI RPS, configurable fixed rounds, selection from the active configured providers, sealed-choice status, score history, and match results. Model ids, endpoints, credentials, and AI personas remain deployment configuration rather than editable match fields.

The UI reads committed match views through the generated `matches` Remote namespace and refetches after `match/changed`. It records the selected match id in browser storage and reloads that durable server view after navigation or refresh; choosing a new table first abandons an active match, drains its AI controllers, and then clears the browser selection. It never reads AI Session transcripts or raw private match events.

## Model Experience

### Match presentation

#### What the model sees

This browser plugin adds no model input. AI decisions from `matches` views are shown as sealed until resolution, and prompts or reasoning text are never rendered.

#### Token effect

Zero tokens. The Agent controller owns model requests.

#### KV Cache effect

No effect. Remote match refreshes do not mutate model history.

## Known Limitations and Deferred Work

- One browser selects one active table; the UI does not yet list earlier matches or expose controller failure details.
