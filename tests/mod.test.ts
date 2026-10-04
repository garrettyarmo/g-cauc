import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'g-cauc',
  component: 'Pane',
  requestId: 'g-cauc-board',
  viewport: { columns: 140, rows: 40 },
  props: { title: 'g-cauc', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const FILES: Record<string, string> = {
  '/home/code/g-cauc/projects.md': '| Priority | Project | Path | Repo | Notes |\n|---|---|---|---|---|\n| 1 | CallFlow | `~/code/callflow` | `garrettyarmo/callflow` | Pilot |\n',
  '/home/code/g-cauc/lanes.md': '| Lane | Family | Subscription | Weight | Max jobs | Status |\n|---|---|---|---|---|---|\n| `grok` | xAI | Cursor Ultra | light | 6 | on |\n| `codex` | OpenAI | ChatGPT Pro | heavy | 3 | on |\n',
  '/home/code/g-cauc/limits/codex': '2099-10-06T15:21:00-05:00\n',
  '/home/code/callflow/ROADMAP.md': '# Roadmap\n\n## Phase 1: Walking skeleton (attended)\n\nExit: staging smoke is green.\n',
  '/home/code/callflow/AGENTS.md': '# CallFlow\n\nAutonomy: attended\n',
  '/home/code/callflow/specs/001-walking-skeleton.md': '# 001: Walking skeleton\n',
}

const ISSUES = JSON.stringify([
  { number: 12, title: 'Spec 001 row 3: staging', state: 'OPEN', labels: [{ name: 'in-review' }], body: '', url: 'https://github.com/garrettyarmo/callflow/issues/12' },
  { number: 13, title: 'Spec 001 row 4: smoke', state: 'OPEN', labels: [{ name: 'ready' }], body: 'Blocked by #12', url: 'https://github.com/garrettyarmo/callflow/issues/13' },
  { number: 16, title: 'Spec 001 row 5: go unattended', state: 'OPEN', labels: [{ name: 'needs:garrett' }], body: '', url: 'https://github.com/garrettyarmo/callflow/issues/16' },
  { number: 10, title: 'Spec 001 row 1: repo', state: 'CLOSED', labels: [], body: '', url: 'https://github.com/garrettyarmo/callflow/issues/10' },
])

const world = { ghFails: false, projectsGone: false, logFailsOnce: false, logCalls: 0, nastyTitle: false }

FILES['/home/code/g-cauc/runner/repos'] = '# repo slots\ngarrettyarmo/callflow 3\n'
FILES['/home/code/callflow/scripts/done'] = 'budget="${CALLFLOW_FULL_BUDGET:-1500}"\nbudget="${CALLFLOW_FAST_BUDGET:-200}"\n'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const RUNS = JSON.stringify({ workflow_runs: [
  { id: 501, name: 'CI', status: 'in_progress', conclusion: null, head_branch: 'build/52-inbox', display_title: 'Inbox filters', event: 'pull_request', created_at: ago(300000), run_started_at: ago(300000), updated_at: ago(1000), html_url: 'https://github.com/garrettyarmo/callflow/actions/runs/501', pull_requests: [{ number: 52 }] },
  { id: 502, name: 'CI', status: 'queued', conclusion: null, head_branch: 'build/54-hours', display_title: 'Hours editor', event: 'pull_request', created_at: ago(300000), run_started_at: ago(300000), updated_at: ago(300000), html_url: 'u', pull_requests: [{ number: 54 }] },
  { id: 403, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main', display_title: 'Merge 50', event: 'push', created_at: ago(900000), run_started_at: ago(900000), updated_at: ago(700000), html_url: 'u', pull_requests: [] },
  { id: 402, name: 'guard', status: 'completed', conclusion: 'failure', head_branch: 'build/49', display_title: 'Guard', event: 'pull_request', created_at: ago(1900000), run_started_at: ago(1900000), updated_at: ago(1899000), html_url: 'u', pull_requests: [{ number: 49 }] },
  { id: 401, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'main', display_title: 'Merge 48', event: 'push', created_at: ago(3600000), run_started_at: ago(3600000), updated_at: ago(3400000), html_url: 'u', pull_requests: [] },
] })
const JOBS: Record<string, string> = {
  '501': JSON.stringify({ jobs: [{ id: 9501, name: 'done', status: 'in_progress', conclusion: null, created_at: ago(300000), started_at: ago(240000), runner_name: 'mac-callflow-1-1791151244', labels: ['self-hosted', 'gcauc'], steps: [{ name: 'Set up job', status: 'completed', conclusion: 'success' }, { name: 'Run scripts/done --fast', status: 'in_progress', conclusion: null }] }] }),
  '502': JSON.stringify({ jobs: [{ id: 9502, name: 'done', status: 'queued', conclusion: null, created_at: ago(300000), started_at: null, runner_name: null, labels: ['gcauc', 'linux'], steps: [] }] }),
  '403': JSON.stringify({ jobs: [{ id: 9403, name: 'done', status: 'completed', conclusion: 'success', created_at: ago(900000), started_at: ago(890000), runner_name: 'mac-callflow-2-1', labels: ['self-hosted', 'gcauc'], steps: [{ name: 'Run scripts/done --fast', status: 'completed', conclusion: 'success' }] }] }),
  '402': JSON.stringify({ jobs: [{ id: 9402, name: 'guard', status: 'completed', conclusion: 'failure', created_at: ago(1900000), started_at: ago(1900000), runner_name: null, labels: ['ubuntu-latest'], steps: [] }] }),
  '401': JSON.stringify({ jobs: [{ id: 9401, name: 'done', status: 'completed', conclusion: 'success', created_at: ago(3600000), started_at: ago(3590000), runner_name: 'mac-callflow-1-1', labels: ['self-hosted', 'gcauc'], steps: [{ name: 'Run scripts/done --fast', status: 'completed', conclusion: 'success' }] }] }),
}
const RUNNERS = JSON.stringify({ runners: [
  { name: 'mac-callflow-1-1791151244', status: 'online', busy: true, labels: [{ name: 'gcauc' }, { name: 'self-hosted' }, { name: 'Linux' }, { name: 'ARM64' }] },
  { name: 'mac-callflow-2-1791150808', status: 'online', busy: false, labels: [{ name: 'gcauc' }, { name: 'self-hosted' }, { name: 'Linux' }, { name: 'ARM64' }] },
] })
const CHECK_PRS = JSON.stringify([
  { number: 52, title: 'Inbox filters', url: 'https://github.com/garrettyarmo/callflow/pull/52', headRefName: 'build/52-inbox', mergeStateStatus: 'BLOCKED', statusCheckRollup: [
    { __typename: 'CheckRun', name: 'guard', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: ago(600000) },
    { __typename: 'CheckRun', name: 'guard', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: ago(100000) },
    { __typename: 'CheckRun', name: 'done', status: 'IN_PROGRESS', conclusion: null, startedAt: ago(240000) },
    { __typename: 'StatusContext', context: 'agent-review', state: 'PENDING' },
  ] },
])
const REFUSAL = JSON.stringify([{ annotation_level: 'failure', message: "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings" }])

function stubWorld(on, saved: Map<string, unknown>, toasts: string[]) {
  on('session.start', () => ({ cwd: '/home/code/callflow' }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/home' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  const gone = (p: string) => world.projectsGone && p.endsWith('/projects.md')
  on('fs.exists', ($, e) => ({ value: e.path in FILES && !gone(e.path) }))
  on('fs.read', ($, e) => (e.path in FILES && !gone(e.path) ? { value: FILES[e.path] } : { deny: 'missing' }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/specs') ? [{ name: '001-walking-skeleton.md', kind: 'file', size: 1, isLink: false }] : [] }))
  on('session.usage', () => ({ value: { rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2099-10-02T18:00:00Z' }] } }))
  on('process.run', ($, e) => {
    const a = e.argv.join(' ')
    if (a.startsWith('gh') && world.ghFails) return { value: { exitCode: 1, stdout: '', stderr: 'HTTP 502' } }
    if (a.startsWith('gh issue list')) return { value: { exitCode: 0, stdout: ISSUES, stderr: '' } }
    if (a.startsWith('gh pr list') && a.includes('statusCheckRollup')) return { value: { exitCode: 0, stdout: world.nastyTitle ? CHECK_PRS.replace('Inbox filters', 'Inbox\\u001b[31m filters') : CHECK_PRS, stderr: '' } }
    if (a.startsWith('gh pr list') && a.includes('--state open')) return { value: { exitCode: 0, stdout: '[]', stderr: '' } }
    if (a.startsWith('gh api repos/garrettyarmo/callflow/actions/runs?')) return { value: { exitCode: 0, stdout: RUNS, stderr: '' } }
    const jm = a.match(/^gh api repos\/garrettyarmo\/callflow\/actions\/runs\/(\d+)\/jobs/)
    if (jm) return { value: { exitCode: 0, stdout: JOBS[jm[1]] || '{"jobs":[]}', stderr: '' } }
    if (a.startsWith('gh api repos/garrettyarmo/callflow/actions/runners')) return { value: { exitCode: 0, stdout: RUNNERS, stderr: '' } }
    if (a.startsWith('gh api repos/garrettyarmo/callflow/check-runs/9402/annotations')) return { value: { exitCode: 0, stdout: REFUSAL, stderr: '' } }
    if (a.startsWith('sh -c out=') && a.endsWith('/actions/jobs/9403/logs')) {
      world.logCalls += 1
      if (world.logFailsOnce && world.logCalls === 1) return { value: { exitCode: 3, stdout: '', stderr: 'HTTP 404' } }
      return { value: { exitCode: 0, stdout: 'done --fast: green in 127s\n', stderr: '' } }
    }
    if (a.startsWith('sh -c out=') && a.endsWith('/actions/jobs/9401/logs')) return { value: { exitCode: 0, stdout: 'done --fast: green in 151s\n', stderr: '' } }
    if (a.startsWith('git -C /home/code/callflow merge-base --is-ancestor origin/main origin/build/52-inbox')) return { value: { exitCode: 1, stdout: '', stderr: '' } }
    if (a.startsWith('limactl list gcauc-ci')) return { value: { exitCode: 0, stdout: 'Running\n', stderr: '' } }
    if (a === 'gh api user --jq .login') return { value: { exitCode: 0, stdout: 'garrettyarmo\n', stderr: '' } }
    if (a.startsWith('gh pr list')) return { value: { exitCode: 0, stdout: JSON.stringify([{ number: 9, title: 'Fresh tree', mergedAt: 'x', url: 'p9' }]), stderr: '' } }
    if (a.startsWith('pgrep')) return { value: { exitCode: 0, stdout: '501 /Users/g/.local/bin/cursor-agent -p --model grok-4.7-high [ak:callflow#12:agent-review:2] review\n', stderr: '' } }
    if (a.startsWith('ps ')) return { value: { exitCode: 0, stdout: '  501    03:10\n', stderr: '' } }
    if (a.startsWith('lsof')) return { value: { exitCode: 0, stdout: 'p501\nf1\nn/home/code/callflow_wt/logs/12-review-2-grok.jsonl\n', stderr: '' } }
    if (a.startsWith('tail')) return { value: { exitCode: 0, stdout: '{"type":"thinking","subtype":"delta","text":"Checking the deploy pin."}\n{"type":"thinking","subtype":"completed"}\n{"type":"tool_call","subtype":"completed","tool_call":{"shellToolCall":{"args":{"command":"scripts/done --fast"},"result":{"success":{"exitCode":0,"executionTime":41000}}}}}\n', stderr: '' } }
    if (a.startsWith('git rev-parse --show-toplevel')) return { value: { exitCode: 0, stdout: e.init && e.init.cwd ? e.init.cwd + '\n' : '', stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected ' + a } }
  })
  on('store.delete', ($, e) => {
    saved.delete(e.key)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
}

const BAND = { plugin: 'g-cauc', component: 'AbovePrompt', requestId: 'band', viewport: { columns: 140, rows: 40 }, props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} } } as const

test('the board shows the phase, the running review, the queue and what needs Garrett', async ($, on) => {
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, toasts)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  await $.command.run({ command: 'board', args: '' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Phase 1 · Walking skeleton/ })).toBeDefined()
  expect(await ui.find({ key: 'row-callflow-12' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /review r2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /#16 Spec 001 row 5/ })).toBeDefined()
  await ui.press({ key: 'tab-lanes' })
  expect(await ui.find({ type: 'Text', text: /out until 10-06 15:21/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\/6/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^42%/ })).toBeDefined()
  await ui.press({ key: 'tab-now' })
  await ui.press({ key: 'job-501' })
  await clock.settle()
  await ui.press({ key: 'tab-job' })
  expect(await ui.find({ type: 'Text', text: /› thinking/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$ scripts\/done --fast/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /exit 0 · 41s/ })).toBeDefined()
  await ui.press({ key: 'thinking' })
  expect(await ui.find({ type: 'Text', text: /Checking the deploy pin/ })).toBeDefined()
  await ui.unmount()
})

test('the Desktop app draws bars, pills, slots and dots as SVG on every tab', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const t of ['plan', 'now', 'ci', 'lanes']) {
    await ui.press({ key: 'tab-' + t })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
  }
  await ui.unmount()
})

test('the board also draws in the terminal', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Phase 1 · Walking skeleton/ })).toBeDefined()
  await ui.unmount()
})

test('the CI tab shows the pool, running and stuck jobs, results, timings, PR checks and the refusal', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-ci' })
  expect(await ui.find({ type: 'Text', text: /VM running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 busy · 1 idle · 1 offline/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /GitHub refused jobs at the spending limit \(1 run\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PR 52 · done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /slot 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Run scripts\/done --fast/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /stuck 5m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /wants gcauc, linux · pool has gcauc, self-hosted, Linux, ARM64/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 of 3 passed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /127s of 200s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /avg 139s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ guard/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /… done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /… agent-review/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /behind main/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /billing needs the gh "user" scope/ })).toBeDefined()
  await ui.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /CI 1 running · 1 queued · pool 1\/3/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /1 stuck/ })).toBeDefined()
  await band.unmount()
  // Finished runs are read once: a second refresh fetches no job logs again
  const logCalls = () => [...saved.keys()].filter((k) => k.startsWith('ci-run')).length
  expect(logCalls()).toBe(3)
})

test('a failed gh call keeps the last good board and does not repeat alerts', async ($, on) => {
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, toasts)
  world.ghFails = false
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  expect(saved.get('needsSeen')).toEqual(['garrettyarmo/callflow#16'])
  world.ghFails = true
  await $.command.run({ command: 'board', args: 'refresh' })
  expect(saved.get('needsSeen')).toEqual(['garrettyarmo/callflow#16'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Phase 1 · Walking skeleton/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gh could not read garrettyarmo\/callflow/ })).toBeDefined()
  // A second failure in a row still shows the last good board
  await $.command.run({ command: 'board', args: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /Phase 1 · Walking skeleton/ })).toBeDefined()
  // An unreadable projects.md changes nothing either
  world.ghFails = false
  world.projectsGone = true
  await $.command.run({ command: 'board', args: 'refresh' })
  expect(saved.get('needsSeen')).toEqual(['garrettyarmo/callflow#16'])
  world.projectsGone = false
  await $.command.run({ command: 'board', args: 'refresh' })
  expect(toasts.filter((t) => t.includes('needs you')).length).toBe(0)
  await ui.unmount()
})

test('a CI snapshot an older board saved is never read back', async ($, on) => {
  const saved = new Map<string, unknown>()
  // The 0.4.0 shape: a pool with no slots list
  saved.set('ci-snapshot', { at: Date.now(), vm: 'Running', billing: null, projects: [{ name: 'CallFlow', repo: 'garrettyarmo/callflow', key: 'callflow', ci: { running: [{ id: 1, name: 'done', prs: [1], branch: 'b', elapsed: 5, steps: [] }], queued: [], stuck: 0, recent: [], timings: { fast: [], full: [], budgets: { fast: null, full: null } }, refusal: null, prs: [], pool: { busy: 1, configured: 3, runners: [] } } }] })
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  world.ghFails = true
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-ci' })
  expect(await ui.find({ type: 'Text', text: /gh could not read the Actions runs/ })).toBeDefined()
  await ui.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /CI 1 running/ })).toBeUndefined()
  await band.unmount()
  world.ghFails = false
})

test('a cold start with projects.md missing shows the last snapshot any session saved', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('snapshot', {
    at: Date.now() - 10 * 60_000,
    lanes: [{ lane: 'codex', family: 'OpenAI', weight: 'heavy', max: 3, status: 'on' }],
    projects: [{ name: 'CallFlow', repo: 'garrettyarmo/callflow', path: '/home/code/callflow', key: 'callflow', priority: 1, summary: { autonomy: 'attended', phase: { n: 1, title: 'Walking skeleton', exit: '', done: 1, total: 4 }, specs: [], building: [], inReview: [], ready: [], needs: [], ideas: 0, merged: [] } }],
  })
  saved.set('needsSeen', ['garrettyarmo/callflow#16'])
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  world.projectsGone = true
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Phase 1 · Walking skeleton/ })).toBeDefined()
  expect(saved.get('needsSeen')).toEqual(['garrettyarmo/callflow#16'])
  await ui.press({ key: 'tab-lanes' })
  expect(await ui.find({ type: 'Text', text: /^0\/3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /out until/ })).toBeDefined()
  world.projectsGone = false
  await ui.unmount()
})

test('approvals are counted by call id: only prompts you approved, and the rule lands in the session working tree', async ($, on) => {
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const written: Record<string, string> = {}
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, toasts)
  on('fs.write', ($, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  const cwd = '/home/code/callflow_wt/build-35'
  const sugg = [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'gh pr view:*' }] }]
  const ask = async (id: string, approve: boolean) => {
    const input = { command: 'gh pr view 71 --json state' }
    await $.tool.check({ tool: 'Bash', input, tool_use_id: id })
    await $.classic.PermissionRequest({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: input, permission_suggestions: sugg })
    if (approve) await $.classic.PostToolUse({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input, tool_response: {}, tool_use_id: id })
  }
  await ask('denied-1', false)
  for (let i = 0; i < 9; i++) await ask('ok-' + i, true)
  // A run that never prompted does not count, even with the same command as the denied one
  await $.classic.PostToolUse({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr view 71 --json state' }, tool_response: {}, tool_use_id: 'no-prompt' })
  const key = 'allow\u0000' + cwd + '\u0000Bash(gh pr view:*)'
  expect(saved.get(key)).toEqual({ count: 9, state: 'counting' })
  // Two overlapping asks with different commands: the dialog names A, A is denied, B runs. Nothing counts.
  await $.tool.check({ tool: 'Bash', input: { command: 'gh pr view 1' }, tool_use_id: 'A' })
  await $.tool.check({ tool: 'Bash', input: { command: 'gh pr view 2' }, tool_use_id: 'B' })
  await $.classic.PermissionRequest({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'gh pr view 1' }, permission_suggestions: sugg })
  await $.classic.PostToolUse({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr view 2' }, tool_response: {}, tool_use_id: 'B' })
  expect(saved.get(key)).toEqual({ count: 9, state: 'counting' })
  // The dialog for C's command arrives while only D (a different command) is open: nothing counts.
  await $.tool.check({ tool: 'Bash', input: { command: 'gh pr view 4' }, tool_use_id: 'D' })
  await $.classic.PermissionRequest({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'gh pr view 3' }, permission_suggestions: sugg })
  await $.classic.PostToolUse({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr view 4' }, tool_response: {}, tool_use_id: 'D' })
  expect(saved.get(key)).toEqual({ count: 9, state: 'counting' })
  // Two open asks for the same command: dialogs arrive in call order, so approving the first counts once.
  await $.tool.check({ tool: 'Bash', input: { command: 'gh pr view 71 --json state' }, tool_use_id: 'E' })
  await $.tool.check({ tool: 'Bash', input: { command: 'gh pr view 71 --json state' }, tool_use_id: 'F' })
  await $.classic.PermissionRequest({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'gh pr view 71 --json state' }, permission_suggestions: sugg })
  await $.classic.PostToolUse({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr view 71 --json state' }, tool_response: {}, tool_use_id: 'E' })
  expect(saved.get(key)).toEqual({ count: 10, state: 'suggested' })
  // F gets its own dialog and is denied, so it never runs: nothing more counts.
  await $.classic.PermissionRequest({ session_id: 's', transcript_path: 't', cwd, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'gh pr view 71 --json state' }, permission_suggestions: sugg })
  expect(saved.get(key)).toEqual({ count: 10, state: 'suggested' })
  // An ask the classifier denied (no dialog) and is now 3 minutes old does not swallow the next approval.
  await $.tool.check({ tool: 'Bash', input: { command: 'gh pr view 71 --json state' }, tool_use_id: 'G-denied-by-classifier' })
  await clock.advance(3 * 60_000)
  await ask('ok-9', true)
  expect(saved.get(key)).toEqual({ count: 11, state: 'suggested' })
  expect(toasts.filter((t) => t.includes('Bash(gh pr view:*) 10 times')).length).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-allow' })
  await ui.press({ key: `apply-${cwd}-Bash(gh pr view:*)` })
  const settings = JSON.parse(written[cwd + '/.claude/settings.json'])
  expect(settings.permissions.allow).toEqual(['Bash(gh pr view:*)'])
  expect((saved.get(key) as { state: string }).state).toBe('applied')
  await ui.unmount()
})

test('a job log GitHub has not finished uploading is read again on a later refresh', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  world.logFailsOnce = true
  world.logCalls = 0
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const k = 'ci-run\u0000garrettyarmo/callflow\u0000403'
  expect((saved.get(k) as { retry?: boolean; fast: unknown }).retry).toBe(true)
  await $.command.run({ command: 'board', args: 'refresh' })
  expect((saved.get(k) as { fast: { seconds: number } }).fast.seconds).toBe(127)
  world.logFailsOnce = false
})

test('a control character in a PR title is dropped, and the CI tab still draws on both surfaces', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  world.nastyTitle = true
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-ci' })
    expect(await ui.find({ type: surface === 'desktop' ? 'Link' : 'Text', text: /#52 Inbox filters/ })).toBeDefined()
    await ui.unmount()
  }
  world.nastyTitle = false
})
