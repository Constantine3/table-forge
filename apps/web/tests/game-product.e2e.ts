import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { MATCH_FORMAT_VERSION, MatchId, SeatId } from '@deepseek-ai/dsh-game'
import { SqliteGamePersistence } from '@deepseek-ai/dsh-game-persistence-sqlite'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/game-product', import.meta.url))
const CATALOG_EXPECTED = join(SNAPSHOT_DIR, 'catalog.expected.md')
const RPS_SETUP_EXPECTED = join(SNAPSHOT_DIR, 'setup.expected.md')
const RPS_AUDIT_EXPECTED = join(SNAPSHOT_DIR, 'rps-audit.expected.md')
const AVALON_SETUP_EXPECTED = join(SNAPSHOT_DIR, 'avalon-setup.expected.md')
const AVALON_DISCUSSION_EXPECTED = join(SNAPSHOT_DIR, 'avalon-discussion.expected.md')
const AVALON_ASSASSINATION_EXPECTED = join(SNAPSHOT_DIR, 'avalon-assassination.expected.md')
const LEGACY_MATCH_ID = 'legacy-format-zero'
const AVALON_DISCUSSION_MATCH_ID = 'avalon-discussion'
const AVALON_EVIL_DISCUSSION_MATCH_ID = 'avalon-evil-discussion'
const MODE = webSnapshotMode()

let child: ChildProcess | undefined
let browser: Browser | undefined
let harnessHome: string | undefined
let llmServer: MockLlmServer | undefined
let secondLlmServer: MockLlmServer | undefined

async function waitForWebUrl(process: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let diagnostics = ''
    const inspect = (chunk: Buffer): void => {
      diagnostics += chunk.toString()
      const match = diagnostics.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match !== null) resolve(match[1]!)
    }
    process.stdout!.on('data', inspect)
    process.stderr!.on('data', inspect)
    process.once('exit', (code) => { reject(new Error(`game product exited before readiness (${code}): ${diagnostics}`)) })
    setTimeout(() => { reject(new Error(`game product readiness timed out: ${diagnostics}`)) }, 30_000).unref()
  })
}

afterEach(async () => {
  await browser?.close()
  browser = undefined
  if (child?.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise<void>(resolve => child!.once('exit', () => { resolve() }))
  }
  child = undefined
  await llmServer?.close()
  llmServer = undefined
  await secondLlmServer?.close()
  secondLlmServer = undefined
  if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true })
  harnessHome = undefined
})

it('boots the shipped game product and snapshots installed setup and discussion surfaces', async () => {
  harnessHome = await mkdtemp(join(tmpdir(), 'dsh-game-product-'))
  const legacyPersistence = new SqliteGamePersistence(join(harnessHome, 'games.sqlite'))
  await legacyPersistence.create({
    id: MatchId(LEGACY_MATCH_ID), formatVersion: 0, gameId: 'rps', rulesVersion: 1, config: {},
    seats: [{ id: SeatId('human'), displayName: 'You', controller: { type: 'human' } }],
    createdAt: 1, events: [],
  })
  await legacyPersistence.create({
    id: MatchId(AVALON_EVIL_DISCUSSION_MATCH_ID), formatVersion: MATCH_FORMAT_VERSION,
    gameId: 'avalon', rulesVersion: 10, config: { playerCount: 6, humanRole: 'assassin' }, createdAt: 2,
    seats: [
      { id: SeatId('human'), displayName: '你', controller: { type: 'human' } },
      ...[1, 2, 3, 4, 5].map(index => ({
        id: SeatId(`ai-${index}`), displayName: `AI ${index}`,
        controller: { type: 'agent' as const, provider: 'deepseek-self-deployment', model: 'deepseek-v4-flash-vision' },
      })),
    ],
    events: [
      {
        seq: 0, time: 2, type: 'match/rule',
        data: {
          ruleType: 'avalon/started',
          ruleData: {
            seats: ['human', 'ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5'], leaderIndex: 0,
            roles: {
              human: 'assassin', 'ai-1': 'minion', 'ai-2': 'merlin',
              'ai-3': 'loyal-servant', 'ai-4': 'loyal-servant', 'ai-5': 'loyal-servant',
            },
          },
        },
      },
      ...[1, 2, 3].flatMap((number, index) => {
        const team = [
          ['human', 'ai-1'],
          ['human', 'ai-1', 'ai-2'],
          ['human', 'ai-1', 'ai-2', 'ai-3'],
        ][index]!
        return [
          {
            seq: index * 2 + 1, time: 2, type: 'match/rule' as const,
            data: {
              ruleType: 'avalon/team-vote-resolved',
              ruleData: {
                proposal: { leader: index === 0 ? 'human' : `ai-${index}`, team, direction: 'clockwise' },
                statements: [], approveCount: 4, rejectCount: 2, approved: true,
              },
            },
          },
          {
            seq: index * 2 + 2, time: 2, type: 'match/rule' as const,
            data: {
              ruleType: 'avalon/quest-resolved',
              ruleData: { number, team, failCount: 0, success: true },
            },
          },
        ]
      }),
      {
        seq: 7, time: 2, type: 'match/action-opened',
        data: {
          windowId: `${AVALON_EVIL_DISCUSSION_MATCH_ID}:window:7`, key: 'evil-discussion',
          requiredSeats: ['ai-1'], audience: 'required-seats',
        },
      },
    ],
  })
  legacyPersistence.close()
  llmServer = await startMockLlmServer({
    sequence: ['stall', 'tool_call_success'],
    toolName: 'submit_game_action',
    toolArguments: '{"action":{"type":"make-evil-statement","statement":"我判断 AI 2 最像梅林。"}}',
    successText: '邪方发言已提交。',
  })
  secondLlmServer = await startMockLlmServer({
    sequence: ['tool_call_success'],
    repeatLast: true,
    toolName: 'submit_game_action',
    toolArguments: '{"action":{"type":"vote-team","approve":true}}',
    successText: '匿名投票已提交。',
  })
  const patchPath = join(harnessHome, 'game-setup-test.patch.yml')
  await writeFile(patchPath, [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      deepseek-self-deployment:',
    '        displayName: DeepSeek Self Deployment',
    '        apiKeyEnv: DEEPSEEK_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${llmServer.baseURL}/v1`,
    '        reasoning: max',
    '        streamIdleTimeoutMs: 500',
    '        compat:',
    '          supportsReasoningEffort: true',
    '          supportsDeveloperRole: false',
    '        models:',
    '          - id: deepseek-v4-flash-vision',
    '            name: DeepSeek-V4-Flash-Vision',
    '            reasoningEfforts:',
    '              off:',
    '              high: high',
    '              max: max',
    '      hy3-tokenhub:',
    '        displayName: Hy3 TokenHub',
    '        apiKeyEnv: HY3_TOKENHUB_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${secondLlmServer.baseURL}/v1`,
    '        reasoning: high',
    '        compat:',
    '          thinkingFormat: deepseek',
    '          supportsReasoningEffort: true',
    '          supportsDeveloperRole: false',
    '        models:',
    '          - id: hy3',
    '            name: Hy3',
    '            reasoningEfforts:',
    '              off:',
    '              low: low',
    '              high: high',
    '- id: game-controller-agent',
    '  config:',
    '    maxAttemptsPerAction: 2',
    '    maxTokensPerRequest: 16384',
    '    timeoutRetryReasoningEfforts:',
    '      deepseek-self-deployment:',
    '        deepseek-v4-flash-vision: high',
    '      hy3-tokenhub:',
    '        hy3: low',
    '    playerInstruction: 测试游戏玩家。所有思考、分析和自然语言输出必须使用简体中文。',
    '    providerProbes:',
    '      deepseek-self-deployment:',
    `        endpoint: ${llmServer.baseURL}`,
    '',
  ].join('\n'))
  child = spawn(process.execPath, ['apps/cli/lib/bin.js', 'game', '--patch', patchPath, '--port', '0'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DSH_HOME: harnessHome, DEEPSEEK_API_KEY: 'keyless-game-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const baseUrl = await waitForWebUrl(child)

  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  // A pre-release browser selection must not make its preserved format-0 row block product startup.
  await page.addInitScript((matchId) => {
    if (localStorage.getItem('table-forge.active-match') === null) {
      localStorage.setItem('table-forge.active-match', matchId)
    }
  }, LEGACY_MATCH_ID)
  await page.goto(baseUrl)
  await page.getByRole('heading', { name: '一张桌，多种推演', exact: true }).waitFor()
  expect(await page.getByRole('button', { name: '开启后台回合通知', exact: true }).count()).toBe(1)
  const catalogSnapshot = await captureStableAria(page, 'main', harnessHome)
  if (MODE === 'refresh') await mkdir(SNAPSHOT_DIR, { recursive: true })
  await compareOrRefreshGolden(CATALOG_EXPECTED, catalogSnapshot, MODE)

  await page.getByRole('button', { name: /剪刀 · 石头 · 布/ }).click()
  await page.getByRole('heading', { name: '剪刀 · 石头 · 布', exact: true }).waitFor()
  expect(await page.getByRole('combobox').count()).toBe(1)
  expect(await page.locator('main').getByText('模型', { exact: true }).count()).toBe(0)
  await compareOrRefreshGolden(RPS_SETUP_EXPECTED, await captureStableAria(page, 'main', harnessHome), MODE)

  await page.getByRole('button', { name: /返回游戏列表/ }).click()
  await page.getByRole('button', { name: /阿瓦隆/ }).click()
  await page.getByRole('heading', { name: '阿瓦隆', exact: true }).waitFor()
  await page.getByRole('button', { name: '全 AI 对局', exact: true }).click()
  await page.getByLabel('游戏人数').selectOption('7')
  expect(await page.getByRole('combobox').count()).toBe(8)
  expect(await page.getByLabel('游戏人数').inputValue()).toBe('7')
  expect(await page.getByLabel('你的角色').count()).toBe(0)
  expect(await page.getByLabel('AI 席位 7').count()).toBe(1)
  await compareOrRefreshGolden(AVALON_SETUP_EXPECTED, await captureStableAria(page, 'main', harnessHome), MODE)

  await page.reload()
  await page.getByRole('heading', { name: '一张桌，多种推演', exact: true }).waitFor()
  expect(await captureStableAria(page, 'main', harnessHome)).toBe(catalogSnapshot)

  const discussionPersistence = new SqliteGamePersistence(join(harnessHome, 'games.sqlite'))
  await discussionPersistence.create({
    id: MatchId(AVALON_DISCUSSION_MATCH_ID), formatVersion: MATCH_FORMAT_VERSION,
    gameId: 'avalon', rulesVersion: 10, config: { playerCount: 5 }, createdAt: 3,
    seats: [
      { id: SeatId('human'), displayName: '你', controller: { type: 'human' } },
      ...[1, 2, 3, 4].map(index => ({
        id: SeatId(`ai-${index}`), displayName: `AI ${index}`,
        controller: { type: 'agent' as const, provider: 'hy3-tokenhub', model: 'hy3' },
      })),
    ],
    events: [
      {
        seq: 0, time: 2, type: 'match/rule',
        data: {
          ruleType: 'avalon/started',
          ruleData: {
            seats: ['human', 'ai-1', 'ai-2', 'ai-3', 'ai-4'], leaderIndex: 0,
            roles: { human: 'merlin', 'ai-1': 'assassin', 'ai-2': 'minion', 'ai-3': 'loyal-servant', 'ai-4': 'loyal-servant' },
          },
        },
      },
      {
        seq: 1, time: 2, type: 'match/rule',
        data: {
          ruleType: 'avalon/team-proposed',
          ruleData: { leader: 'human', team: ['human', 'ai-1'], direction: 'clockwise' },
        },
      },
      ...['ai-1', 'ai-2', 'ai-3', 'ai-4'].map((seatId, index) => ({
        seq: index + 2, time: 2, type: 'match/rule' as const,
        data: {
          ruleType: 'avalon/statement-made',
          ruleData: { seatId, statement: `我是第 ${index + 1} 位发言者。` },
        },
      })),
      {
        seq: 6, time: 2, type: 'match/action-opened',
        data: {
          windowId: `${AVALON_DISCUSSION_MATCH_ID}:window:6`, key: 'discussion',
          requiredSeats: ['human'], audience: 'public',
        },
      },
    ],
  })
  discussionPersistence.close()
  await page.evaluate((matchId) => { localStorage.setItem('table-forge.active-match', matchId) }, AVALON_DISCUSSION_MATCH_ID)
  await page.reload()
  await page.getByRole('heading', { name: '阿瓦隆', exact: true }).waitFor()
  try {
    await page.getByRole('heading', { name: '队长归票发言', exact: true }).waitFor({ timeout: 10_000 })
  } catch (cause) {
    throw new Error(`seeded Avalon discussion did not render: ${JSON.stringify(await page.locator('main').innerText())}`, { cause })
  }
  await page.getByRole('button', { name: /AI 1/ }).click()
  await page.getByRole('button', { name: /AI 2/ }).click()
  await page.getByPlaceholder('总结本轮讨论并完成归票发言').fill('根据大家的发言，我把 AI 2 换入最终队伍。')
  await page.getByRole('button', { name: '发表归票并确定队伍', exact: true }).click()
  await page.getByRole('heading', { name: '提交匿名投票', exact: true }).waitFor()
  expect(await page.getByText(/你、AI 2/).count()).toBeGreaterThan(0)
  await compareOrRefreshGolden(AVALON_DISCUSSION_EXPECTED, await captureStableAria(page, 'main', harnessHome), MODE)

  await page.evaluate((matchId) => { localStorage.setItem('table-forge.active-match', matchId) }, AVALON_EVIL_DISCUSSION_MATCH_ID)
  await page.reload()
  try {
    await page.getByRole('heading', { name: '刺客总结', exact: true }).waitFor({ timeout: 20_000 })
  } catch (cause) {
    throw new Error(`seeded evil discussion did not advance: requests=${JSON.stringify(llmServer.requests.map(request => ({
      behavior: request.behavior, body: request.body,
    })))} page=${JSON.stringify(await page.locator('main').innerText())}`, { cause })
  }
  expect(await page.getByText('“我判断 AI 2 最像梅林。”', { exact: true }).count()).toBe(1)
  expect(await page.getByText('刺客', { exact: true }).count()).toBeGreaterThan(0)
  const evilRequest = llmServer.requests.find(request => request.behavior === 'tool_call_success')
  const timedOutRequest = llmServer.requests.find(request => request.behavior === 'stall')
  expect(timedOutRequest?.body).toMatchObject({ max_completion_tokens: 16_384, reasoning_effort: 'max' })
  expect(evilRequest?.body).toMatchObject({ max_completion_tokens: 16_384 })
  expect(evilRequest?.body).toMatchObject({ reasoning_effort: 'high' })
  expect(JSON.stringify(evilRequest?.body)).toContain('make-evil-statement')
  expect(JSON.stringify(evilRequest?.body)).toContain('邪方沿圆桌顺时针依次私密发言')
  expect(JSON.stringify(evilRequest?.body)).toContain('任一队伍通过时，该计数立即清零')
  expect(JSON.stringify(evilRequest?.body)).toContain('结算只公开赞成票数和否决票数')
  expect(JSON.stringify(evilRequest?.body)).toContain('不得根据汇总票型断言某个席位投了赞成或否决')
  expect(JSON.stringify(evilRequest?.body)).toContain('隐藏身份和让任务成功只能是达成胜利的手段')
  expect(JSON.stringify(evilRequest?.body)).toContain('区分公开事实与推断')
  expect(JSON.stringify(evilRequest?.body)).toContain('队长最后归票发言，并在同一个动作中提交最终队伍')
  expect(JSON.stringify(evilRequest?.body)).toContain('你是 6 人阿瓦隆')
  expect(JSON.stringify(evilRequest?.body)).toContain('2、3、4、3、4，任务失败所需的失败票数依次为 1、1、1、1、1')
  await page.getByPlaceholder('总结讨论并说明刺杀判断').fill('我同意刺杀 AI 2。')
  await page.getByRole('button', { name: '提交刺客总结', exact: true }).click()
  await page.getByRole('heading', { name: '刺杀梅林', exact: true }).waitFor()
  await page.getByRole('button', { name: 'AI 2', exact: true }).click()
  await page.getByText('邪方胜利', { exact: true }).waitFor()
  await page.getByRole('button', { name: '载入 AI 审计记录', exact: true }).click()
  await page.getByText(/^AI 审计时间线（\d+ 条）$/).waitFor()
  await page.getByText('刺杀前密谈', { exact: true }).last().waitFor()
  const assassinationAuditText = await page.locator('main').innerText()
  expect(
    await page.getByText('邪方密谈：“我判断 AI 2 最像梅林。”', { exact: true }).count(),
    assassinationAuditText,
  ).toBe(1)
  const voteHistory = page.locator('details').filter({ hasText: '队伍通过 · 票型 4 赞成 / 2 否决' }).first()
  await voteHistory.locator('summary').click()
  expect(await voteHistory.getAttribute('open')).not.toBeNull()
  await compareOrRefreshGolden(AVALON_ASSASSINATION_EXPECTED, await captureStableAria(page, 'main', harnessHome), MODE)
  expect(await readdir(SNAPSHOT_DIR)).toEqual([
    'avalon-assassination.expected.md', 'avalon-discussion.expected.md', 'avalon-setup.expected.md',
    'catalog.expected.md', 'rps-audit.expected.md', 'setup.expected.md',
  ])
}, 60_000)

it('plays and restores complete human-AI and AI-AI matches through the shipped product', async () => {
  harnessHome = await mkdtemp(join(tmpdir(), 'dsh-game-product-play-'))
  llmServer = await startMockLlmServer({
    sequence: ['tool_call_success', 'tool_call_success'],
    toolName: 'submit_game_action',
    toolArguments: '{"action":{"choice":"paper"}}',
    successText: '动作已提交。',
  })
  secondLlmServer = await startMockLlmServer({
    sequence: ['tool_call_success'],
    toolName: 'submit_game_action',
    toolArguments: '{"action":{"choice":"paper"}}',
    successText: '动作已提交。',
  })
  const patchPath = join(harnessHome, 'game-test.patch.yml')
  await writeFile(patchPath, [
    '- id: agent-default-model',
    '  config:',
    '    provider: game-test',
    '    model: game-model',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      game-test:',
    '        displayName: Game Test',
    '        apiKeyEnv: GAME_TEST_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${llmServer.baseURL}/v1`,
    '        reasoning: off',
    '        compat:',
    '          supportsDeveloperRole: false',
    '        models:',
    '          - id: game-model',
    '            name: Game Model',
    '            reasoningEfforts: false',
    '      game-test-2:',
    '        displayName: Game Test 2',
    '        apiKeyEnv: GAME_TEST_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${secondLlmServer.baseURL}/v1`,
    '        reasoning: off',
    '        compat:',
    '          supportsDeveloperRole: false',
    '        models:',
    '          - id: game-model',
    '            name: Game Model',
    '            reasoningEfforts: false',
    '- id: game-controller-agent',
    '  config:',
    '    maxAttemptsPerAction: 2',
    '    maxTokensPerRequest: 16384',
    '    playerInstruction: 测试游戏玩家。所有思考、分析和自然语言输出必须使用简体中文。',
    '    providerProbes:',
    '      game-test:',
    `        endpoint: ${llmServer.baseURL}`,
    '      game-test-2:',
    `        endpoint: ${secondLlmServer.baseURL}`,
    '',
  ].join('\n'))
  child = spawn(process.execPath, ['apps/cli/lib/bin.js', 'game', '--patch', patchPath, '--port', '0'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DSH_HOME: harnessHome, GAME_TEST_API_KEY: 'keyless-game-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const baseUrl = await waitForWebUrl(child)

  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(baseUrl)
  await page.getByRole('button', { name: /剪刀 · 石头 · 布/ }).click()
  await page.getByLabel('总局数').fill('1')
  await page.getByRole('button', { name: '开始对局' }).click()
  await page.getByText('当前对局').waitFor()
  await page.reload()
  await page.getByText('当前对局').waitFor()
  await page.getByRole('button', { name: '石头' }).click()
  await page.getByText('AI 一号获胜').waitFor({ timeout: 20_000 })
  expect(await page.getByText('第 1 局').count()).toBe(1)
  await page.getByRole('button', { name: '载入 AI 审计记录' }).click()
  await page.getByText(/AI 审计时间线/).waitFor()
  expect(await page.getByText('AI 一号', { exact: true }).count()).toBeGreaterThan(0)
  expect(await page.getByText('猜拳决策', { exact: true }).count()).toBeGreaterThan(0)
  expect(await page.getByText('选择：布', { exact: true }).count()).toBe(1)
  if (MODE === 'refresh') await mkdir(SNAPSHOT_DIR, { recursive: true })
  await compareOrRefreshGolden(RPS_AUDIT_EXPECTED, await captureStableAria(page, 'main', harnessHome), MODE)

  await page.getByRole('button', { name: '新对局' }).click()
  await page.getByRole('button', { name: 'AI 对 AI' }).click()
  await page.getByRole('combobox').nth(1).selectOption('game-test-2')
  await page.getByLabel('总局数').fill('1')
  await page.getByRole('button', { name: '开始对局' }).click()
  try {
    await page.getByText('本场平局').waitFor({ timeout: 8_000 })
  } catch (cause) {
    throw new Error(`AI-AI match did not finish; first=${JSON.stringify(llmServer.requests.map(request => ({ behavior: request.behavior, body: request.body })))}, second=${JSON.stringify(secondLlmServer.requests.map(request => ({ behavior: request.behavior, body: request.body })))}, page=${JSON.stringify(await page.locator('main').innerText())}`, { cause })
  }
  expect(await page.getByText('第 1 局').count()).toBe(1)
  expect(llmServer.requests.filter(request => request.behavior === 'tool_call_success')).toHaveLength(2)
  expect(secondLlmServer.requests.filter(request => request.behavior === 'tool_call_success')).toHaveLength(1)
  expect(llmServer.requests.every(request =>
    (request.body as { max_completion_tokens?: number }).max_completion_tokens === 16_384)).toBe(true)
  expect(secondLlmServer.requests.every(request =>
    (request.body as { max_completion_tokens?: number }).max_completion_tokens === 16_384)).toBe(true)
}, 60_000)
