# `@deepseek-ai/dsh-client-ui-game-avalon`

English | [中文](README.zh.md)

This browser plugin contributes the `avalon` catalog card, five- or six-seat setup, and round-table board to `dsh-client-ui-game`. Setup defaults to a six-player human-and-AI table, lets the user switch to five players or an AI-only table, and selects a provider independently for every AI seat. Human participation exposes role selection or random assignment; AI-only setup removes that control and creates five or six Agent seats. During play, every seat is positioned dynamically around a circular table whose center shows the selected speaking direction and current speaker. The five projected mission sizes and results form a vertical rail beside the table at desktop widths and a horizontal row on narrow screens. A clockwise leader-rotation label relies on the circular seat order and current-leader styling instead of duplicating every seat in another list. Controls come from the human seat's current action schema when one exists: a human leader selects the initial team and direction, each human speaker receives a statement editor, and the leader's final turn re-enables the seat controls so the summary action can retain or revise the team. AI-only tables render the public observation without action controls. The board labels the initial and final teams separately and shows ordered pre-vote statements, mission failure counts, and only permitted identity knowledge. Each collapsed history summary includes the anonymous approval and rejection counts; expanding it reveals that round's public statements. Approval controls appear only after every player has spoken and the leader commits the final team.

After three successful missions, evil players receive private statement controls in clockwise order and the Assassin receives the final summary turn before target selection. Evil human projections show committed evil statements and the current evil speaker; non-evil projections show only that private discussion is in progress. The assassination wait state does not identify the acting seat. A normal finish reveals all roles and evil statements and enables explicit AI audit loading. The shared audit timeline labels private evil statements as assassination discussion and the Assassin's accepted target as an assassination decision. Abandonment keeps undisclosed identities hidden and never offers audit loading.

## Model Experience

### Avalon presentation

#### What the model sees

Nothing. The contribution renders the public or human-seat `avalon` Remote projection and never creates a model request.

#### Token effect

Zero tokens.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Setup uses the base roles for five- and six-player tables; provider selection does not expose per-seat persona editing.
