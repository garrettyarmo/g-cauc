import { expect, test } from 'claude-code/testing'
import {
  parseProjects, parseLanes, parseRoadmap, issueSpec, blockers, summarizeProject, parseJobs, laneOf,
  modelName, parseEtime, fmtDuration, parseLsof, parseLog, bar, bandText, suggestedRules, withAllowed, parseClaudeAgents,
  asArray, sanitize, callKey,
} from '../hooks/lib.js'

const PROJECTS = `# Projects

| Priority | Project | Path | Repo | Notes |
|---|---|---|---|---|
| 2 | qaps | \`~/code/myqap\` | \`garrettyarmo/myqap\` | later |
| 1 | CallFlow | \`~/code/callflow\` | \`garrettyarmo/callflow\` | Pilot |
`

test('projects come back in priority order with ~ expanded', async () => {
  const p = parseProjects(PROJECTS, '/Users/g')
  expect(p.map((x) => x.name)).toEqual(['CallFlow', 'qaps'])
  expect(p[0].path).toBe('/Users/g/code/callflow')
  expect(p[0].repo).toBe('garrettyarmo/callflow')
})

test('lanes parse max jobs and status', async () => {
  const md = `| Lane | Family | Subscription | Weight | Max jobs | Status |
|---|---|---|---|---|---|
| \`composer\` | Cursor | Cursor Ultra | light | 6 | on |
| \`muse\` | Meta | Muse Code plan | light | 0 | off: run \`muse auth\` once |`
  const l = parseLanes(md)
  expect(l[0]).toMatchObject({ lane: 'composer', family: 'Cursor', max: 6, status: 'on' })
  expect(l[1]).toMatchObject({ lane: 'muse', max: 0, status: 'off' })
})

const ROADMAP = `# Roadmap

## Phase 0: Foundation (this PR)

Exit: the kickoff spec PR carries both sign-offs.

## Phase 1: Walking skeleton (attended)

Exit:

- \`scripts/done --full\` exits 0 in CI on main.

## Phase 2: Call handling core

Exit: scripted staging calls land in the inbox.

## After go-live (one paragraph each)
`

test('roadmap phases carry their exit criterion', async () => {
  const ph = parseRoadmap(ROADMAP)
  expect(ph.map((p) => p.title)).toEqual(['Foundation', 'Walking skeleton', 'Call handling core'])
  expect(ph[1].exit).toBe('`scripts/done --full` exits 0 in CI on main.')
})

test('an issue finds its spec in the title or the body', async () => {
  expect(issueSpec({ title: 'Spec 002 row 7: privacy checks', body: '' })).toBe('002')
  expect(issueSpec({ title: 'Staging', body: 'Spec: specs/001-walking-skeleton.md\n' })).toBe('001')
  expect(issueSpec({ title: 'Something else', body: '' })).toBe(null)
})

test('blockers come from lines and from the build plan column', async () => {
  const body = `Spec: specs/002-test-foundation.md

| # | Build issue | Checks | Size | Area | Lane | Blocked by | Risk |
|---|---|---|---|---|---|---|---|
| 8 | Recorded fixtures | T15 | S | infra | claude | spec 001 row 14 (#15) | normal |

Blocked by #9 and #10`
  expect(blockers(body).sort()).toEqual([10, 15, 9].sort())
})

test('summary finds the current phase, the queue and what needs Garrett', async () => {
  const issue = (number, title, state, labels, body = '') => ({ number, title, state, labels: labels.map((name) => ({ name })), body, url: 'u' + number })
  const issues = [
    issue(10, 'Spec 001 row 1: repo', 'CLOSED', ['size:s']),
    issue(11, 'Spec 001 row 2: ci', 'CLOSED', []),
    issue(12, 'Spec 001 row 3: staging', 'OPEN', ['in-review']),
    issue(13, 'Spec 001 row 4: smoke', 'OPEN', ['ready'], 'Blocked by #12'),
    issue(14, 'Spec 001 row 5: go unattended', 'OPEN', ['ready', 'needs:garrett']),
    issue(20, 'Spec 002 row 1: guard', 'OPEN', ['building']),
    issue(30, 'Batch the idea', 'OPEN', ['idea']),
  ]
  const s = summarizeProject({
    issues,
    openPrs: [{ number: 40, title: 'Spec 003: billing', labels: [{ name: 'agreed' }], url: 'p40' }],
    mergedPrs: [],
    roadmap: ROADMAP,
    specs: [
      { num: '001', file: '001-walking-skeleton.md', title: 'Walking skeleton', text: '# 001: Walking skeleton' },
      { num: '002', file: '002-test-foundation.md', title: 'Test foundation', text: '# 002\n\nPhase: 1' },
    ],
    autonomy: 'attended',
  })
  expect(s.phase).toMatchObject({ n: 1, title: 'Walking skeleton', done: 2, total: 6 })
  expect(s.inReview.map((i) => i.number)).toEqual([12])
  expect(s.building.map((i) => i.number)).toEqual([20])
  expect(s.ready.map((i) => i.number)).toEqual([14, 13])
  expect(s.ready[1].waitingOn).toEqual([12])
  expect(s.needs.map((n) => n.kind + n.number)).toEqual(['issue14', 'spec40'])
  expect(s.ideas).toBe(1)
})

test('only the agent CLIs count as jobs, not the shells that started them', async () => {
  const out = [
    '16826 /bin/zsh -c source snap.sh && nohup cursor-agent -p --model grok-4.7-high "[ak:callflow#14:agent-review:7] go"',
    '16829 /Users/g/.local/bin/cursor-agent --use-system-ca /x/index.js -p --model grok-4.7-high --sandbox enabled [ak:callflow#14:agent-review:7] Use the agent-review skill',
    '17001 /Users/g/.local/bin/codex exec -m gpt-6.1-sol --sandbox workspace-write [ak:callflow#31:build:2] Use the build skill',
    '17002 /Users/g/.local/bin/claude --bg --name ak-callflow-35-build --model opus [ak:callflow#35:build:2] Use the build skill',
  ].join('\n')
  const jobs = parseJobs(out)
  expect(jobs.length).toBe(2)
  expect(jobs[0]).toMatchObject({ pid: 16829, cli: 'cursor-agent', model: 'grok-4.7-high', project: 'callflow', issue: 14, role: 'agent-review', round: 7 })
  expect(jobs[1]).toMatchObject({ cli: 'codex', model: 'gpt-6.1-sol', issue: 31, role: 'build', round: 2 })
  expect(laneOf('cursor-agent', 'grok-4.7-high')).toBe('grok')
  expect(laneOf('cursor-agent', 'composer-2.5')).toBe('composer')
  expect(laneOf('codex', 'gpt-6.1-sol')).toBe('codex')
  expect(modelName('grok-4.7-high')).toBe('Grok 4.7 high')
  expect(modelName('composer-2.5')).toBe('Composer 2.5')
})

test('times and process output parse', async () => {
  expect(parseEtime('04:05')).toBe(245)
  expect(parseEtime('1-02:00:00')).toBe(93600)
  expect(fmtDuration(3700)).toBe('1h02')
  expect(parseLsof('p101\nf1\nn/tmp/a.log\np102\nf1\nn/tmp/b.log\n').get(102)).toBe('/tmp/b.log')
  expect(bar(3, 4, 4)).toBe('███░')
})

test('a Cursor stream-json log becomes thinking, commands, words and a result', async () => {
  const log = [
    '{"type":"system","subtype":"init","model":"Grok 4.7"}',
    '{"type":"thinking","subtype":"delta","text":"I should run "}',
    '{"type":"thinking","subtype":"delta","text":"the tests."}',
    '{"type":"thinking","subtype":"completed"}',
    '{"type":"tool_call","subtype":"started","tool_call":{"shellToolCall":{"args":{"command":"scripts/done --fast"}}}}',
    '{"type":"tool_call","subtype":"completed","tool_call":{"shellToolCall":{"args":{"command":"scripts/done --fast"},"result":{"success":{"exitCode":1,"stdout":"1 failed","executionTime":41000}}}}}',
    '{"type":"tool_call","subtype":"completed","tool_call":{"readToolCall":{"args":{"path":"api/app.py"}}}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"VERDICT: BLOCK"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"duration_ms":90000}',
  ].join('\n')
  const { format, steps } = parseLog(log)
  expect(format).toBe('json')
  expect(steps.map((s) => s.kind)).toEqual(['thinking', 'cmd', 'tool', 'say', 'result'])
  expect(steps[0].text).toBe('I should run the tests.')
  expect(steps[1]).toMatchObject({ text: 'scripts/done --fast', exit: 1, ms: 41000 })
  expect(steps[2].text).toBe('read api/app.py')
})

test('a Codex --json log and a plain text log both parse', async () => {
  const codex = [
    '{"type":"thread.started","thread_id":"t"}',
    '{"type":"item.completed","item":{"id":"1","type":"reasoning","text":"Check the migration first."}}',
    '{"type":"item.completed","item":{"id":"2","type":"command_execution","command":"pytest -q","aggregated_output":"3 passed","exit_code":0,"status":"completed"}}',
    '{"type":"item.completed","item":{"id":"3","type":"agent_message","text":"Done."}}',
    '{"type":"turn.completed","usage":{}}',
  ].join('\n')
  expect(parseLog(codex).steps.map((s) => s.kind)).toEqual(['thinking', 'cmd', 'say', 'result'])
  const plain = parseLog('**VERDICT: PASS** on abc\nall good')
  expect(plain.format).toBe('text')
  expect(parseLog('').format).toBe('empty')
})

test('the band says nothing when nothing runs and nothing waits', async () => {
  const proj = (needs, phase) => ({ name: 'CallFlow', summary: { needs, phase } })
  expect(bandText([proj([], null)], [])).toBe(null)
  expect(bandText([proj([{}], { done: 11, total: 15 })], [{}, {}, {}])).toBe('g-cauc · CallFlow 11/15 · 3 running · 1 needs you')
})

test('permission suggestions become rule strings, and allowing one keeps the rest of the file', async () => {
  const rules = suggestedRules([
    { type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'gh pr view:*' }] },
    { type: 'addRules', behavior: 'deny', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }] },
    { type: 'setMode', mode: 'acceptEdits' },
  ])
  expect(rules).toEqual(['Bash(gh pr view:*)'])
  const before = { model: 'opus', permissions: { allow: ['Read'], deny: ['Bash(sudo:*)'] } }
  const after = withAllowed(before, ['Bash(gh pr view:*)', 'Read'])
  expect(after).toEqual({ model: 'opus', permissions: { allow: ['Read', 'Bash(gh pr view:*)'], deny: ['Bash(sudo:*)'] } })
  expect(before.permissions.allow).toEqual(['Read'])
})

test('Claude background workers come from claude agents --json, with their transcript as the log', async () => {
  const json = JSON.stringify([
    { pid: 1, cwd: '/Users/g', kind: 'interactive', sessionId: 'aaa', name: 'Nessy Design / Build', status: 'idle' },
    { pid: 2, cwd: '/Users/g/code/callflow_wt/ak-35', kind: 'background', startedAt: 1000, sessionId: 'bbb', name: 'ak-callflow-35-build', status: 'busy' },
  ])
  const jobs = parseClaudeAgents(json, '/Users/g', 61000)
  expect(jobs.length).toBe(1)
  expect(jobs[0]).toMatchObject({ project: 'callflow', issue: 35, role: 'build', elapsed: 60, log: '/Users/g/.claude/projects/-Users-g-code-callflow-wt-ak-35/bbb.jsonl' })
})

test('a Claude transcript shows thinking, commands and tools', async () => {
  const log = [
    '{"type":"user","message":{"role":"user","content":"go"}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Run the fast checks."},{"type":"tool_use","name":"Bash","input":{"command":"scripts/done --fast"}}]}}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"api/app.py"}},{"type":"text","text":"PR opened."}]}}',
  ].join('\n')
  expect(parseLog(log).steps.map((s) => s.kind)).toEqual(['thinking', 'cmd', 'tool', 'say'])
})

test('review fixes: bars clamp, odd settings are refused, gh output is checked, log text is cleaned', async () => {
  expect(bar(105, 100, 10)).toBe('██████████')
  expect(bar(-5, 100, 4)).toBe('░░░░')
  expect(withAllowed({ permissions: [] }, ['Read'])).toBe(null)
  expect(withAllowed({ permissions: 'default' }, ['Read'])).toBe(null)
  expect(withAllowed({ permissions: { allow: 'Read' } }, ['Read'])).toBe(null)
  expect(withAllowed(undefined, ['Read'])).toEqual({ permissions: { allow: ['Read'] } })
  expect(asArray('[{"number":1}]')).toEqual([{ number: 1 }])
  expect(asArray('{"message":"Bad credentials"}')).toBe(null)
  expect(asArray(null)).toBe(null)
  expect(sanitize('\u001b[31mred\u001b[0m line\r\nnext\u0007')).toBe('red line\nnext')
})

test('recheck fixes: C1 controls and error lines are cleaned, and Claude lines count when agents is unavailable', async () => {
  expect(sanitize('hello\u0080\u009b world')).toBe('hello world')
  const steps = parseLog('{"type":"turn.started"}\n{"type":"error","message":"\\u001b[31mboom\\u0007"}').steps
  expect(steps[steps.length - 1].text).toBe('failed: boom')
  const line = '17002 /usr/local/bin/claude --bg --name ak-callflow-35-build [ak:callflow#35:build:2] go'
  expect(parseJobs(line).length).toBe(0)
  expect(parseJobs(line, { claude: true })[0]).toMatchObject({ cli: 'claude', issue: 35, round: 2 })
})

test('round 3: exit codes are numbers or nothing, and a dialog matches its call by command', async () => {
  const log = '{"type":"tool_call","subtype":"completed","tool_call":{"shellToolCall":{"args":{"command":"echo ok"},"result":{"success":{"exitCode":"1\\u009b[2J","executionTime":5}}}}}'
  expect(parseLog(log).steps[0]).toMatchObject({ kind: 'cmd', text: 'echo ok', exit: null })
  expect(callKey('Bash', { command: 'gh pr view 1', description: 'x' })).toBe(callKey('Bash', { command: 'gh pr view 1' }))
  expect(callKey('Bash', { command: 'gh pr view 1' })).not.toBe(callKey('Bash', { command: 'gh pr view 2' }))
})
