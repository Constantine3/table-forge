import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/game-product', import.meta.url))
const SETUP_EXPECTED = join(SNAPSHOT_DIR, 'setup.expected.md')
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

it('boots the shipped game product and restores its keyless setup surface', async () => {
  harnessHome = await mkdtemp(join(tmpdir(), 'dsh-game-product-'))
  llmServer = await startMockLlmServer({ sequence: ['success'] })
  const patchPath = join(harnessHome, 'game-setup-test.patch.yml')
  await writeFile(patchPath, [
    '- id: game-controller-agent',
    '  config:',
    '    maxAttemptsPerAction: 2',
    '    playerInstruction: Test game player.',
    '    providerProbes:',
    '      deepseek-self-deployment:',
    `        endpoint: ${llmServer.baseURL}`,
    '',
  ].join('\n'))
  child = spawn(process.execPath, ['apps/cli/lib/bin.js', 'game', '--patch', patchPath, '--port', '0'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DSH_HOME: harnessHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const baseUrl = await waitForWebUrl(child)

  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(baseUrl)
  await page.getByRole('heading', { name: '剪刀 · 石头 · 布', exact: true }).waitFor()
  expect(await page.getByRole('combobox').count()).toBe(1)
  expect(await page.locator('main').getByText('模型', { exact: true }).count()).toBe(0)
  const snapshot = await captureStableAria(page, 'main', harnessHome)
  if (MODE === 'refresh') await mkdir(SNAPSHOT_DIR, { recursive: true })
  await compareOrRefreshGolden(SETUP_EXPECTED, snapshot, MODE)

  await page.reload()
  await page.getByRole('heading', { name: '剪刀 · 石头 · 布', exact: true }).waitFor()
  expect(await captureStableAria(page, 'main', harnessHome)).toBe(snapshot)
  expect(await readdir(SNAPSHOT_DIR)).toEqual(['setup.expected.md'])
}, 60_000)

it('plays and restores complete human-AI and AI-AI matches through the shipped product', async () => {
  harnessHome = await mkdtemp(join(tmpdir(), 'dsh-game-product-play-'))
  llmServer = await startMockLlmServer({
    sequence: ['tool_call_success', 'success', 'tool_call_success', 'success'],
    toolName: 'submit_game_action',
    toolArguments: '{"action":{"choice":"paper"}}',
    successText: 'Action submitted.',
  })
  secondLlmServer = await startMockLlmServer({
    sequence: ['tool_call_success', 'success'],
    toolName: 'submit_game_action',
    toolArguments: '{"action":{"choice":"paper"}}',
    successText: 'Action submitted.',
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
    '    playerInstruction: Test game player.',
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
  await page.getByLabel('总局数').fill('1')
  await page.getByRole('button', { name: '开始对局' }).click()
  await page.getByText('当前对局').waitFor()
  await page.reload()
  await page.getByText('当前对局').waitFor()
  await page.getByRole('button', { name: '石头' }).click()
  await page.getByText('AI 一号获胜').waitFor({ timeout: 20_000 })
  expect(await page.getByText('第 1 局').count()).toBe(1)

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
  expect(llmServer.requests).toHaveLength(4)
  expect(secondLlmServer.requests).toHaveLength(2)
}, 60_000)
