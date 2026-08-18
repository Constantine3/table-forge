# `@deepseek-ai/dsh-client-ui-game`

English | [中文](README.zh.md)

This browser plugin owns the generic game product root, durable table list, game catalog, and shared Remote operations. Installed game UI plugins contribute catalog cards and keyed setup/board surfaces, so adding a game does not add game-specific state to the root. Model ids, endpoints, credentials, and AI personas remain deployment configuration rather than editable match fields.

The UI reads each game's configuration schema and rules version from the generated `matches` Remote namespace. Game-specific setup surfaces use that Host-published schema for available controls, and every create request echoes the catalog rules version. The UI reads committed match views through the same namespace and refetches after `match/changed`. It records the selected match id in browser storage and reloads that durable server view after navigation or refresh; choosing a new table first abandons an active match, drains its AI controllers, and then clears the browser selection. Restore, open, refresh, active play, and abandonment never read AI Session transcripts or raw private match events. A user may explicitly load complete AI Session histories only after a normally finished match; abandoned matches cannot be audited. The audit projection pages through every AI seat history, combines reasoning, natural-language output, and submitted game-tool arguments into one event-time timeline, and labels each row with the player, decision stage, model turn, clock time, and tool outcome. All model text and action fields from a decision declared anonymous by the game remain redacted even though the timeline identifies the submitting seat. Unavailable seat histories remain explicit instead of making a loaded empty result indistinguishable from an audit that was never requested.

Browser turn notifications are opt-in. The shell requests permission from the explicit enable control or a match-creation gesture, then emits at most one notification for each human-actionable window while the page is hidden or unfocused. An actionable window that first appears in the foreground remains eligible until it is completed, so leaving it open and switching away still notifies; clicking the notification focuses the game page. Unsupported or denied permission and notification-construction failures leave play unchanged and remain visible in the header.

## Model Experience

### Match presentation

#### What the model sees

This browser plugin adds no model input. During play, game surfaces render only the human-safe `matches` projection. AI reasoning and submitted action arguments appear only in the explicit post-finish audit timeline, except that anonymous decision turns remain redacted.

#### Token effect

Zero tokens. The Agent controller owns model requests.

#### KV Cache effect

No effect. Remote match refreshes do not mutate model history.

## Known Limitations and Deferred Work

- One browser selects one active table at a time; the catalog does not provide matchmaking, spectators, or multi-user identity.
