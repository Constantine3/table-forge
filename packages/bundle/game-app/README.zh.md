# `@deepseek-ai/dsh-game-app`

[English](README.md) | 中文

`dsh-game-app` 是 Table Forge 产品层。它叠加在 `dsh-web-app` 之后，挂载游戏注册表、SQLite 对局持久化、事件溯源引擎、剪刀石头布与五人阿瓦隆定义、Agent 控制器、通用浏览器根界面以及两种游戏界面。

使用 `dsh game` 运行交付的组合。游戏 profile 配置 `deepseek-self-deployment`（通过 `http://127.0.0.1:4100/v1` 调用最高推理档、流空闲等待上限为十分钟的 `deepseek-v4-flash-vision`）和 `hy3-tokenhub`（通过腾讯 TokenHub 调用高推理档的 `hy3`）。Agent 控制器会把两个路由上的每次模型请求限制为最多输出 16,384 个 token，并在超时后改用高推理档，直至动作成功。开桌表单只列出已激活的配置提供方，不提供模型、端点或凭据字段；凭据分别读取自 `DEEPSEEK_API_KEY` 与 `HY3_TOKENHUB_API_KEY`。Host 会在选择前探测仅限局域网的自部署路由；该路由不可达时，TokenHub 仍作为云端备选。后续 profile patch 可以调整该目录或增加其他游戏定义，无需修改引擎。

## 模型体验

### AI 席位回合

#### 模型看到什么

每个配置的 AI 席位收到规则、席位范围观察、动作窗口 id 和 `submit_game_action` 工具。交付指令要求全部思维链与自然语言输出使用简体中文，同时保持协议标识符的精确值。它无法检查其他席位的封存动作。

#### Token 影响

每个 AI 动作发起一次有界 Agent 回合。动作工具调用成功后会直接结束回合，不再请求模型生成确认语。每次模型请求最多输出 16,384 个 token；未提交有效动作时最多额外重试 `maxAttemptsPerAction - 1` 次。发生超时后，交付的路由映射会把本地模型从 `max` 降到 `high` 推理档，并把云端模型从 `high` 降到 `low`，直至提交成功。

#### KV Cache 影响

每个席位拥有独立 Session。稳定的规则与角色设定前缀可由提供方复用；观察和动作窗口 id 每局变化。

## 已知限制与后续工作

- 阿瓦隆采用固定一名人类与四名 AI 的五人规则；交付产品不提供匹配、观战或多浏览器牌桌协作。
