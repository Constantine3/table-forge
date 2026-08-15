# `@deepseek-ai/dsh-client-ui-game-rps`

English | [中文](README.zh.md)

This browser plugin contributes the `rps` catalog card, setup form, and board to `dsh-client-ui-game`. Setup supports human versus AI and AI versus AI, fixed round count from the deployment schema, and independently selectable reachable providers. The board renders sealed-choice status, scores, resolved rounds, terminal results, blocked-controller recovery, and the shared post-finish AI audit timeline with each model's accepted choice.

## Model Experience

### RPS presentation

#### What the model sees

Nothing. The contribution renders committed human-safe `rps` match views and never creates a model request.

#### Token effect

Zero tokens.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- This contribution assumes the installed `rps` definition's current setup and view fields.
