# `@deepseek-ai/dsh-game-avalon`

English | [中文](README.zh.md)

`dsh-game-avalon` registers a fixed five-player Avalon definition for one human and four independently configured AI seats. Setup may pin the human to Merlin, the Assassin, a Loyal Servant, or the Minion; omission assigns every role from a private random seed. The complete assignment and initial leader are durable rule events, so replay is deterministic.

The mission sizes are 2, 3, 2, 3, and 3. A leader publishes an initial team and chooses clockwise or counterclockwise discussion. The adjacent seat in that direction starts, the four non-leaders speak in order, and the leader's final summary action submits the team that will be voted on; the leader may retain the initial team or replace members after hearing the discussion. Only after that fifth statement commits does every seat receive a sealed approval vote without an attached statement. Resolution records and reveals only the approval and rejection counts, never the choice made by a named seat. Approved final-team members submit sealed quest actions. Loyal roles can only submit success, while evil roles may submit success or failure. A rejection increments the consecutive-rejection count, while any approved team resets it to zero; three failed missions or five consecutive rejected teams give evil an immediate victory. After three successful missions, evil players speak privately in clockwise seat order after the Assassin, with the Assassin speaking last; only then does the Assassin receive the private target action. All roles and the evil discussion are revealed after normal resolution.

Active public views omit roles. A seat projection contains only that seat's role and permitted knowledge: Merlin sees the two evil seats, evil players recognize each other, and Loyal Servants receive no extra identity information. During the private endgame discussion, only evil seat projections contain its speaker and committed statements; non-evil projections expose neither. Team-vote history exposes only aggregate approval and rejection counts, and mission history reveals only the failure count rather than individual actions.

## Match setup

- `humanRole` optionally fixes the human seat to `merlin`, `loyal-servant`, `assassin`, or `minion`; omission keeps random assignment.

## Configuration

- `maxStatementChars` limits each public pre-vote or private evil statement and defaults to `280`.

## Model Experience

### Avalon action

#### What the model sees

The AI receives the fixed rules, its current seat projection, and a JSON schema for only its current legal action, such as `propose-team`, `make-statement`, `make-evil-statement`, or `quest`. The rules prompt states that team votes are anonymous, only their aggregate counts are revealed, only consecutive rejections count toward the evil victory, and approval resets the count. The leader's final `make-statement` schema requires both its summary and final team, while other speakers submit only their statement. Reasoning, natural-language output, and statements are instructed to use Simplified Chinese. The prompt forbids disclosing or quoting private role knowledge in public statements, permits that knowledge in the private evil discussion, and rejects an AI statement without Chinese text.

#### Token effect

One rules-and-observation prompt is added for every AI proposal, pre-vote statement, team vote, quest action, evil discussion statement, or assassination choice. A team proposal opens five sequential statement actions after the proposal; the fixed one-human composition makes four of them AI model turns. The endgame adds two sequential evil statements; one or both use AI turns according to the human's chosen role.

#### KV Cache effect

The rules prefix is stable per seat; mission history, public statements, private observation, and action schema change as events commit.

## Known Limitations and Deferred Work

- The plugin intentionally omits additional Avalon roles, alternate player counts, free-form chat, spectator policy, and social moderation.
