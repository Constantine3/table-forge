# `@deepseek-ai/dsh-client-ui-game-avalon`

English | [中文](README.zh.md)

This browser plugin contributes the `avalon` catalog card, fixed five-seat setup, and round-table board to `dsh-client-ui-game`. Setup lets the human choose a role or retain random assignment and provides four separate provider selectors for the AI seats. During play, five seats remain positioned around a circular table whose center shows the selected speaking direction and current speaker. Controls come from the human seat's current action schema: a human leader selects the initial team and direction, each human speaker receives a statement editor, and the leader's final turn re-enables the seat controls so the summary action can retain or revise the team. The board labels the initial and final teams separately and shows ordered pre-vote statements, anonymous aggregate vote patterns on dedicated history rows, mission failure counts, score, rejection count, and only the human's permitted identity knowledge. Approval controls appear only after the leader commits the fifth statement and final team.

After three successful missions, evil players receive private statement controls in clockwise order and the Assassin receives the final summary turn before target selection. Evil human projections show committed evil statements and the current evil speaker; non-evil projections show only that private discussion is in progress. The assassination wait state does not identify the acting seat. A normal finish reveals all roles and evil statements and enables explicit AI audit loading. The shared audit timeline labels private evil statements as assassination discussion and the Assassin's accepted target as an assassination decision. Abandonment keeps undisclosed identities hidden and never offers audit loading.

## Model Experience

### Avalon presentation

#### What the model sees

Nothing. The contribution renders the human-safe `avalon` Remote projection and never creates a model request.

#### Token effect

Zero tokens.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Setup is fixed to one human, four AI seats, and the base five-role deck; provider selection does not expose per-seat persona editing.
