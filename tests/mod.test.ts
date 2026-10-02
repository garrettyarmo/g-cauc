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

const world = { ghFails: false, projectsGone: false }

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
    if (a.startsWith('gh pr list') && a.includes('--state open')) return { value: { exitCode: 0, stdout: '[]', stderr: '' } }
    if (a.startsWith('gh pr list')) return { value: { exitCode: 0, stdout: JSON.stringify([{ number: 9, title: 'Fresh tree', mergedAt: 'x', url: 'p9' }]), stderr: '' } }
    if (a.startsWith('pgrep')) return { value: { exitCode: 0, stdout: '501 /Users/g/.local/bin/cursor-agent -p --model grok-4.7-high [ak:callflow#12:agent-review:2] review\n', stderr: '' } }
    if (a.startsWith('ps ')) return { value: { exitCode: 0, stdout: '  501    03:10\n', stderr: '' } }
    if (a.startsWith('lsof')) return { value: { exitCode: 0, stdout: 'p501\nf1\nn/home/code/callflow_wt/logs/12-review-2-grok.jsonl\n', stderr: '' } }
    if (a.startsWith('tail')) return { value: { exitCode: 0, stdout: '{"type":"thinking","subtype":"delta","text":"Checking the deploy pin."}\n{"type":"thinking","subtype":"completed"}\n{"type":"tool_call","subtype":"completed","tool_call":{"shellToolCall":{"args":{"command":"scripts/done --fast"},"result":{"success":{"exitCode":0,"executionTime":41000}}}}}\n', stderr: '' } }
    if (a.startsWith('git rev-parse --show-toplevel')) return { value: { exitCode: 0, stdout: e.init && e.init.cwd ? e.init.cwd + '\n' : '', stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected ' + a } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
}

test('the board shows the phase, the running review, the queue and what needs Garrett', async ($, on) => {
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, toasts)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  await $.command.run({ command: 'board', args: '' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Phase 1: Walking skeleton/ })).toBeDefined()
  expect(await ui.find({ key: 'row-callflow-12' })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: /#16 Spec 001 row 5/ })).toBeDefined()
  await ui.press({ key: 'tab-lanes' })
  expect(await ui.find({ type: 'Text', text: /codex.*out until/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /grok.*1\/6 jobs/ })).toBeDefined()
  await ui.press({ key: 'tab-now' })
  await ui.press({ key: 'job-501' })
  await clock.settle()
  await ui.press({ key: 'tab-job' })
  expect(await ui.find({ type: 'Text', text: /› thinking/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$ scripts\/done --fast.*exit 0/ })).toBeDefined()
  await ui.press({ key: 'thinking' })
  expect(await ui.find({ type: 'Text', text: /Checking the deploy pin/ })).toBeDefined()
  await ui.unmount()
})

test('the board also draws in the terminal', async ($, on) => {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on, { now: Date.now() })
  stubWorld(on, saved, [])
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/code/callflow' })
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Phase 1: Walking skeleton/ })).toBeDefined()
  await ui.unmount()
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
  expect(await ui.find({ type: 'Text', text: /Phase 1: Walking skeleton/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gh could not read garrettyarmo\/callflow/ })).toBeDefined()
  // A second failure in a row still shows the last good board
  await $.command.run({ command: 'board', args: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /Phase 1: Walking skeleton/ })).toBeDefined()
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

test('approvals are counted by call id: only prompts you approved, and the rule lands in the session working tree', async ($, on) => {
  const saved = new Map<string, unknown>()
  const toasts: string[] = []
  const written: Record<string, string> = {}
  mock.clock(on, { now: Date.now() })
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
  await ask('ok-9', true)
  expect(saved.get(key)).toEqual({ count: 10, state: 'suggested' })
  expect(toasts.some((t) => t.includes('Bash(gh pr view:*) 10 times'))).toBe(true)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-allow' })
  await ui.press({ key: `apply-${cwd}-Bash(gh pr view:*)` })
  const settings = JSON.parse(written[cwd + '/.claude/settings.json'])
  expect(settings.permissions.allow).toEqual(['Bash(gh pr view:*)'])
  expect((saved.get(key) as { state: string }).state).toBe('applied')
  await ui.unmount()
})
