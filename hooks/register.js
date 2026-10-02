// g-cauc mod: the /board pane, the quiet line above the prompt, and the
// permission advisor. It reads GitHub, the process list and job logs on a
// timer; it holds no state of record (GitHub and git do), only a shared cache
// in $.store so several open sessions make one set of gh calls.

import {
  parseProjects, parseLanes, summarizeProject, parseJobs, laneOf, modelName, parseEtime,
  fmtDuration, parseLsof, parseLog, bar, bandText, suggestedRules, withAllowed, labelsOf, parseClaudeAgents,
  asArray, sanitize, callKey,
} from './lib.js'

const PANE = 'g-cauc-board'
const STALE_MS = 45_000
const APPROVALS_TO_SUGGEST = 10

let home = ''
// Where projects.md, lanes.md and limits/ live: the plugin's kit_dir setting.
let kitSetting = '~/code/g-cauc'
let kitDir = ''
let projects = []
let jobs = []
let recent = []
let lanes = []
let claudeLimits = []
let refreshedAt = 0
let lastError = ''
let busy = false
let again = false

let paneOpen = false
let tab = 'plan'
let selected = null
let detail = null
let showThinking = false

// Tool calls that went to a permission prompt, by tool_use_id, until they run or expire.
let asks = new Map()
let allow = {}

export function register(on, options) {
  if (options && typeof options.kit_dir === 'string' && options.kit_dir.trim()) kitSetting = options.kit_dir.trim()
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'board', description: 'g-cauc: milestone, running jobs, lanes, allow-list suggestions', argumentHint: '[refresh]', immediate: true })
    home = (await $.env.get('HOME')) || ''
    kitDir = kitSetting.replace(/^~(?=\/|$)/, home).replace(/\/$/, '')
    $.clock.after(1500, () => refresh($, false))
    $.clock.every(60_000, () => refresh($, false))
    $.clock.every(4_000, () => followJob($))
    return result
  })

  on('command.run', { command: 'board' }, async ($, e) => {
    if (String(e.args || '').trim() === 'refresh') {
      await refresh($, true)
      return { text: 'g-cauc: refreshed' }
    }
    paneOpen = true
    await $.ui.open({ id: PANE, title: 'g-cauc', focus: true, closeOnEscape: true })
    if (Date.now() - refreshedAt > STALE_MS) refresh($, true)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = bandText(projects, jobs)
    const survey = (e.props && e.props.hasSurvey) || e.hasSurvey
    if (!line || survey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    const mine = Text({ dimColor: true, children: [line + '   /board'] })
    return Box({ flexDirection: 'column', children: theirs ? [theirs, mine] : [mine] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const E = $.ui.resolve(e)
    const width = (e.props && e.props.bodyColumns) || 80
    return boardView($, E, width)
  })

  // Permission advisor: a dialog you answered, then the same call running,
  // counts as one approval of each rule Claude Code suggested for it.
  // The order for one call: tool.check says ask, the dialog opens
  // (PermissionRequest), and only an approved call runs (PostToolUse, same id).
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict && verdict.decision === 'ask' && e.tool_use_id && next.origin && next.origin.plugin === 'engine') {
      const now = Date.now()
      for (const [id, a] of asks) if (now - a.at > 30 * 60_000) asks.delete(id)
      asks.set(e.tool_use_id, { tool: e.tool, key: callKey(e.tool, e.input), at: now, rules: null, cwd: '' })
    }
    return verdict
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    const rules = suggestedRules(e.permission_suggestions)
    if (rules.length) {
      // The dialog belongs to the open ask for the same call (tool and command
      // or path). Anything else, including no match, counts nothing.
      const key = callKey(e.tool_name, e.tool_input)
      const match = [...asks.values()].filter((a) => a.key === key && !a.rules)
      const ask = match.length ? match[match.length - 1] : null
      if (ask) {
        ask.rules = rules
        ask.cwd = e.cwd
      }
    }
    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const ask = asks.get(e.tool_use_id)
    if (ask) {
      asks.delete(e.tool_use_id)
      if (ask.rules) await countApproval($, ask)
    }
    return next(e)
  })
}

// ---------- gathering ----------

// stdout of a command that exited 0, or null.
async function sh($, argv, cwd) {
  try {
    const r = await $.process.run(argv, cwd ? { cwd, timeoutMs: 30_000 } : { timeoutMs: 30_000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

// stdout whatever the exit code: ps and lsof exit 1 when one of several pids is gone.
async function shAny($, argv) {
  try {
    const r = await $.process.run(argv, { timeoutMs: 30_000 })
    return r.stdout || ''
  } catch {
    return ''
  }
}

async function readText($, path) {
  try {
    if (!(await $.fs.exists(path))) return ''
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function refresh($, force) {
  if (busy) {
    again = again || force
    return
  }
  busy = true
  let cached = null
  try {
    cached = await $.store.get('snapshot')
    if (!force && cached && Date.now() - cached.at < STALE_MS) {
      projects = cached.projects
      lanes = cached.lanes
    } else {
      projects = await gatherProjects($, cached)
      lanes = parseLanes(await readText($, kitDir + '/lanes.md'))
      await $.store.set('snapshot', { at: Date.now(), projects, lanes })
    }
    jobs = await gatherJobs($)
    recent = await gatherRecent($)
    lanes = await withLaneState($, lanes)
    allow = await loadAllow($)
    await toastNewNeeds($)
    refreshedAt = Date.now()
    lastError = ''
  } catch (err) {
    lastError = String((err && err.message) || err)
    // Nothing on screen yet (a cold start): show the last snapshot any session saved.
    if (projects.length === 0 && cached && Array.isArray(cached.projects)) {
      projects = cached.projects.map((p) => ({ ...p, stale: true }))
      lanes = cached.lanes || lanes
    }
  } finally {
    busy = false
    $.ui.invalidate('ui.render')
    if (again) {
      again = false
      refresh($, true)
    }
  }
}

async function gatherProjects($, cached) {
  const list = parseProjects(await readText($, kitDir + '/projects.md'), home)
  if (list.length === 0) throw new Error('could not read any project from ' + kitDir.replace(home, '~') + '/projects.md; showing the last good data')
  const out = []
  for (const p of list) {
    try {
      const issues = asArray(await sh($, ['gh', 'issue', 'list', '--repo', p.repo, '--state', 'all', '--limit', '300', '--json', 'number,title,state,labels,body,url']))
      const openPrs = asArray(await sh($, ['gh', 'pr', 'list', '--repo', p.repo, '--state', 'open', '--limit', '50', '--json', 'number,title,labels,url,headRefName']))
      const mergedPrs = asArray(await sh($, ['gh', 'pr', 'list', '--repo', p.repo, '--state', 'merged', '--limit', '6', '--json', 'number,title,mergedAt,url']))
      if (!issues || !openPrs || !mergedPrs) throw new Error('gh could not read ' + p.repo + '; showing the last good data')
      const roadmap = await readText($, p.path + '/ROADMAP.md')
      const agents = await readText($, p.path + '/AGENTS.md')
      const specs = []
      try {
        for (const f of await $.fs.list(p.path + '/specs')) {
          const m = f.name.match(/^(\d{3})-.*\.md$/)
          if (!m) continue
          const text = await readText($, p.path + '/specs/' + f.name)
          const title = ((text.match(/^#\s+(.+)$/m) || [])[1] || f.name).replace(/^\d{3}\s*[:.]\s*/, '')
          specs.push({ num: m[1], file: f.name, title, text: text.slice(0, 2000) })
        }
      } catch {
        // no specs folder yet
      }
      const summary = summarizeProject({
        issues,
        openPrs,
        mergedPrs,
        roadmap,
        specs,
        autonomy: ((agents.match(/^Autonomy:\s*(\w+)/m) || [])[1] || 'unknown'),
      })
      for (const k of ['building', 'inReview', 'ready']) summary[k] = summary[k].map((i) => ({ number: i.number, title: i.title, url: i.url, labels: labelsOf(i), waitingOn: i.waitingOn || [] }))
      out.push({ ...p, summary, key: p.path.split('/').pop() })
    } catch (err) {
      const before = [...projects, ...((cached && cached.projects) || [])].find((x) => x.repo === p.repo)
      const fallback = before ? before.summary : summarizeProject({ issues: [], openPrs: [], mergedPrs: [], roadmap: '', specs: [], autonomy: 'unknown' })
      out.push({ ...p, key: p.path.split('/').pop(), summary: fallback, stale: true, error: String((err && err.message) || err) })
    }
  }
  return out
}

async function gatherJobs($) {
  const agents = await sh($, ['claude', 'agents', '--json'])
  const claudeJobs = agents === null ? [] : parseClaudeAgents(agents, home, Date.now()).map((j) => ({ ...j, lane: 'claude' }))
  // Without claude agents --json, fall back to Claude workers' own process lines.
  const found = parseJobs(await shAny($, ['pgrep', '-lf', 'ak:']), { claude: agents === null })
  if (found.length === 0) return claudeJobs
  const pids = found.map((j) => j.pid).join(',')
  const etimes = new Map()
  for (const line of (await shAny($, ['ps', '-o', 'pid=,etime=', '-p', pids])).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)/)
    if (m) etimes.set(Number(m[1]), parseEtime(m[2]))
  }
  const logs = parseLsof(await shAny($, ['lsof', '-a', '-d', '1', '-Fpn', '-p', pids]))
  return [...found.map((j) => ({ ...j, lane: laneOf(j.cli, j.model), elapsed: etimes.get(j.pid) || 0, log: logs.get(j.pid) || '' })), ...claudeJobs]
}

async function gatherRecent($) {
  const out = []
  for (const p of projects) {
    const dir = p.path + '_wt/logs'
    const names = ((await sh($, ['/bin/ls', '-t', dir])) || '').split('\n').filter(Boolean).slice(0, 8)
    for (const n of names) out.push({ project: p.key, name: n, path: dir + '/' + n })
  }
  return out.slice(0, 12)
}

async function withLaneState($, base) {
  const now = Date.now()
  const result = []
  for (const l of base) {
    const until = (await readText($, kitDir + '/limits/' + l.lane)).trim()
    const out = until && Date.parse(until) > now ? until : ''
    result.push({ ...l, running: jobs.filter((j) => j.lane === l.lane).length, outUntil: out })
  }
  try {
    const u = await $.session.usage()
    claudeLimits = (u && u.rateLimits) || []
  } catch {
    claudeLimits = []
  }
  return result
}

async function toastNewNeeds($) {
  const seen = await $.store.get('needsSeen')
  const ok = projects.filter((p) => !p.stale)
  const kept = Array.isArray(seen) ? seen.filter((k) => projects.some((p) => p.stale && k.startsWith(p.repo + '#'))) : []
  const now = [...kept, ...ok.flatMap((p) => p.summary.needs.map((n) => `${p.repo}#${n.number}`))]
  if (Array.isArray(seen)) {
    const fresh = ok.flatMap((p) => p.summary.needs.filter((n) => !seen.includes(`${p.repo}#${n.number}`)).map((n) => `${p.name} #${n.number}`))
    if (fresh.length) $.ui.toast('g-cauc: ' + fresh.join(', ') + (fresh.length === 1 ? ' needs you' : ' need you') + ' (/board)')
  }
  await $.store.set('needsSeen', now)
}

async function followJob($) {
  if (!paneOpen || tab !== 'job' || !selected) return
  const text = (await sh($, ['tail', '-c', '400000', selected.path])) || ''
  detail = parseLog(text)
  $.ui.invalidate('ui.render')
}

// ---------- permission advisor ----------

// The working tree the session is in, so a rule takes effect where the prompts happen.
async function treeRoot($, cwd) {
  const top = ((await sh($, ['git', 'rev-parse', '--show-toplevel'], cwd)) || '').trim()
  return top || cwd
}

// One store key per rule, read right before each write, so sessions racing
// on different rules never overwrite each other.
const allowKey = (root, rule) => 'allow\u0000' + root + '\u0000' + rule

async function loadAllow($) {
  const all = {}
  for (const k of await $.store.keys()) {
    if (!k.startsWith('allow\u0000')) continue
    const [, root, rule] = k.split('\u0000')
    all[root] = all[root] || {}
    all[root][rule] = await $.store.get(k)
  }
  return all
}

async function countApproval($, ask) {
  const root = await treeRoot($, ask.cwd)
  for (const rule of ask.rules) {
    const key = allowKey(root, rule)
    const r = (await $.store.get(key)) || { count: 0, state: 'counting' }
    r.count += 1
    if (r.state === 'counting' && r.count >= APPROVALS_TO_SUGGEST) {
      r.state = 'suggested'
      $.ui.toast(`g-cauc: you approved ${rule} ${r.count} times. /board → Allow to stop being asked.`)
    }
    await $.store.set(key, r)
  }
  allow = await loadAllow($)
  $.ui.invalidate('ui.render')
}

async function decideRule($, root, rule, verdict) {
  if (verdict === 'apply') {
    const path = root + '/.claude/settings.json'
    let current = {}
    if (await $.fs.exists(path)) {
      try {
        current = JSON.parse(String(await $.fs.read(path)))
      } catch {
        $.ui.toast('g-cauc: .claude/settings.json is not valid JSON, so nothing was changed')
        return
      }
    }
    const next = withAllowed(current, [rule])
    if (!next) {
      $.ui.toast('g-cauc: .claude/settings.json has a permissions shape I will not edit by hand, so nothing was changed')
      return
    }
    await $.fs.write(path, JSON.stringify(next, null, 2) + '\n')
    $.ui.toast(`g-cauc: added ${rule} to ${path.replace(home, '~')}. Commit it with this branch so every worktree gets it.`)
  }
  const key = allowKey(root, rule)
  const r = (await $.store.get(key)) || { count: 0 }
  await $.store.set(key, { ...r, state: verdict === 'apply' ? 'applied' : 'dismissed' })
  allow = await loadAllow($)
  $.ui.invalidate('ui.render')
}

// ---------- drawing ----------

function suggestions() {
  const out = []
  for (const [root, rules] of Object.entries(allow || {})) {
    for (const [rule, r] of Object.entries(rules)) if (r.state === 'suggested') out.push({ root, rule, count: r.count })
  }
  return out
}

function boardView($, E, width) {
  const { Box, Text, Button } = E
  const redraw = () => $.ui.invalidate('ui.render')
  const sugg = suggestions()
  const tabs = [['plan', 'Plan', '1'], ['now', `Now (${jobs.length})`, '2'], ['lanes', 'Lanes', '3']]
  if (sugg.length) tabs.push(['allow', `Allow (${sugg.length})`, '4'])
  if (selected) tabs.push(['job', 'Job', '5'])
  const tabRow = Box({
    flexDirection: 'row',
    columnGap: 3,
    children: tabs.map(([id, label, hotkey]) => Button({ key: 'tab-' + id, label, hotkey, plain: true, dimColor: tab !== id, onPress: () => { tab = id; redraw() } })),
  })
  const age = refreshedAt ? fmtDuration((Date.now() - refreshedAt) / 1000) + ' ago' : 'loading'
  const status = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ dimColor: true, children: [busy ? 'refreshing…' : 'updated ' + age] }),
      Button({ key: 'refresh', label: 'Refresh', hotkey: 'r', plain: true, dimColor: true, onPress: () => { refresh($, true) } }),
      ...(lastError ? [Text({ color: 'red', children: [lastError.slice(0, 80)] })] : []),
    ],
  })
  let body
  if (tab === 'now') body = nowView($, E, width)
  else if (tab === 'lanes') body = lanesView(E)
  else if (tab === 'allow') body = allowView($, E, sugg)
  else if (tab === 'job') body = jobView($, E, width)
  else body = planView($, E, width)
  return Box({ flexDirection: 'column', rowGap: 1, children: [tabRow, status, Box({ flexDirection: 'column', children: body })] })
}

// Cut text to n columns, so a row stays one line in a narrow pane.
function fit(text, n) {
  const t = String(text || '')
  return t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t
}

function linkOrText(E, url, label) {
  const { Link, Text } = E
  return /^https?:\/\//.test(String(url || '')) ? Link({ href: url, label }) : Text({ children: [label] })
}

function section(E, title, children) {
  const { Box, Text } = E
  return Box({ flexDirection: 'column', children: [Text({ bold: true, children: [title] }), ...children] })
}

function issueRow($, E, p, i, note, width) {
  const { Button, Text, Box } = E
  const job = jobs.find((j) => j.project === p.key && j.issue === i.number)
  const extra = job ? `  ${job.role}${job.round ? ' r' + job.round : ''}  ${modelName(job.model) || job.lane}  ${fmtDuration(job.elapsed)}` : note || ''
  const room = Math.max(24, (width || 80) - extra.length - 4)
  if (!job) return Text({ children: [fit(`  #${i.number} ${i.title}`, room), Text({ dimColor: true, children: [extra] })] })
  return Box({
    flexDirection: 'row',
    children: [Button({ key: `row-${p.key}-${i.number}`, plain: true, label: fit(`  #${i.number} ${i.title}`, room) + extra + '  ›', onPress: () => openJob($, job) })],
  })
}

function planView($, E, width) {
  const { Text, Box } = E
  if (projects.length === 0) return [Text({ dimColor: true, children: [refreshedAt ? 'No projects in ' + kitDir.replace(home, '~') + '/projects.md.' : 'Reading GitHub…'] })]
  const out = []
  for (const p of projects) {
    const s = p.summary
    const head = s.phase
      ? `${p.name}  ·  Phase ${s.phase.n}: ${s.phase.title}   ${bar(s.phase.done, s.phase.total, 12)} ${s.phase.done}/${s.phase.total}`
      : `${p.name}`
    const rows = [Text({ bold: true, children: [head] }), Text({ dimColor: true, children: [`  ${s.autonomy}` + (s.phase && s.phase.exit ? `  ·  exit: ${s.phase.exit}`.slice(0, Math.max(40, width - 12)) : '')] })]
    for (const sp of s.specs) rows.push(Text({ dimColor: true, children: [`  spec ${sp.num} ${sp.title}`.slice(0, 48).padEnd(50) + `${bar(sp.done, sp.total, 10)} ${sp.done}/${sp.total}`] }))
    const running = [...s.building, ...s.inReview]
    if (running.length) rows.push(section(E, 'Running', running.map((i) => issueRow($, E, p, i, i.labels.includes('in-review') ? '  in review' : '  building', width))))
    const next = s.ready.slice(0, 6)
    if (next.length) rows.push(section(E, 'Next', next.map((i) => issueRow($, E, p, i, i.waitingOn.length ? `  waits on #${i.waitingOn.join(', #')}` : '  ready', width))))
    if (s.needs.length) rows.push(section(E, 'Needs you', s.needs.map((n) => linkOrText(E, n.url, fit(`  ${n.kind === 'spec' ? 'spec PR ' : ''}#${n.number} ${n.title}`, width - 2)))))
    if (s.merged.length) rows.push(section(E, 'Recently merged', s.merged.map((m) => Text({ dimColor: true, children: [fit(`  #${m.number} ${m.title}`, width - 2)] }))))
    if (s.ideas) rows.push(Text({ dimColor: true, children: [`  ${s.ideas} idea${s.ideas === 1 ? '' : 's'} waiting for the product pass`] }))
    if (p.error) rows.push(Text({ color: 'red', children: ['  ' + p.error.slice(0, 100)] }))
    out.push(Box({ flexDirection: 'column', children: rows }))
  }
  return out
}

function nowView($, E, width) {
  const { Text, Button } = E
  const out = []
  if (jobs.length === 0) out.push(Text({ dimColor: true, children: ['No g-cauc jobs running.'] }))
  for (const j of jobs) {
    const label = `${j.project} #${j.issue}`.padEnd(16) + `${j.role}${j.round ? ' r' + j.round : ''}`.padEnd(18) + `${modelName(j.model) || j.lane}`.padEnd(18) + fmtDuration(j.elapsed)
    out.push(Button({ key: 'job-' + j.pid, plain: true, label: label.slice(0, Math.max(40, width - 4)) + '  ›', onPress: () => openJob($, j) }))
  }
  if (recent.length) {
    out.push(Text({ bold: true, children: ['Recent logs'] }))
    for (const r of recent) out.push(Button({ key: 'log-' + r.path, plain: true, dimColor: true, label: `${r.project}  ${r.name}`.slice(0, Math.max(40, width - 4)), onPress: () => openJob($, { path: r.path, title: `${r.project} ${r.name}` }) }))
  }
  return out
}

function lanesView(E) {
  const { Text } = E
  const out = []
  for (const l of lanes) {
    const state = l.outUntil ? `out until ${l.outUntil.slice(0, 16).replace('T', ' ')}` : l.max === 0 ? 'off' : 'on'
    out.push(Text({ dimColor: l.max === 0, children: [`${l.lane}`.padEnd(10) + `${l.family}`.padEnd(11) + `${l.running}/${l.max} jobs`.padEnd(11) + `${l.weight}`.padEnd(8) + state] }))
  }
  if (claudeLimits.length) {
    out.push(Text({ bold: true, children: ['Claude plan'] }))
    for (const r of claudeLimits) out.push(Text({ children: [`  ${r.kind}`.padEnd(14) + `${bar(r.percentUsed, 100, 10)} ${Math.round(r.percentUsed)}%` + (r.resetsAt ? `  resets ${String(r.resetsAt).slice(0, 16).replace('T', ' ')}` : '')] }))
  }
  return out
}

function allowView($, E, sugg) {
  const { Text, Box, Button } = E
  const out = [Text({ dimColor: true, children: [`Rules you approved ${APPROVALS_TO_SUGGEST} or more times. Allow writes them to the project's .claude/settings.json.`] })]
  for (const s of sugg) {
    out.push(Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Text({ children: [`${s.rule}`] }),
        Text({ dimColor: true, children: [`${s.count}x  ${s.root.replace(home, '~')}`] }),
        Button({ key: `apply-${s.root}-${s.rule}`, label: 'Allow', onPress: () => decideRule($, s.root, s.rule, 'apply') }),
        Button({ key: `dismiss-${s.root}-${s.rule}`, label: 'Dismiss', plain: true, dimColor: true, onPress: () => decideRule($, s.root, s.rule, 'dismiss') }),
      ],
    }))
  }
  return out
}

function openJob($, j) {
  if (!j.path && !j.log) return
  selected = {
    path: j.path || j.log,
    title: j.title || `${j.project} #${j.issue} · ${j.role} round ${j.round} · ${modelName(j.model) || j.lane}`,
    url: projects.find((p) => p.key === j.project) ? `https://github.com/${projects.find((p) => p.key === j.project).repo}/issues/${j.issue}` : '',
  }
  detail = null
  tab = 'job'
  followJob($)
  $.ui.invalidate('ui.render')
}

function jobView($, E, width) {
  const { Text, Box, Button, Code } = E
  if (!selected) return [Text({ dimColor: true, children: ['Pick a job on the Now tab.'] })]
  const head = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ bold: true, children: [selected.title] }),
      Button({ key: 'thinking', label: showThinking ? 'Hide thinking' : 'Show thinking', hotkey: 't', plain: true, dimColor: true, onPress: () => { showThinking = !showThinking; $.ui.invalidate('ui.render') } }),
      ...(selected.url ? [linkOrText(E, selected.url, 'issue')] : []),
    ],
  })
  if (!detail) return [head, Text({ dimColor: true, children: ['Reading the log…'] })]
  if (detail.format === 'empty') return [head, Text({ dimColor: true, children: ['The log is empty so far.'] })]
  if (detail.format === 'text') return [head, Text({ dimColor: true, children: ['Plain-text log (launch with stream-json or --json for steps and thinking):'] }), Code({ source: sanitize(detail.steps[0].text, 9000) })]
  const rows = []
  for (const s of detail.steps.slice(-60)) {
    if (s.kind === 'thinking') {
      const lines = s.text.trim().split('\n').length
      rows.push(showThinking ? Text({ dimColor: true, italic: true, children: [sanitize(s.text.trim(), 2000)] }) : Text({ dimColor: true, children: [`› thinking (${lines} line${lines === 1 ? '' : 's'})`] }))
    } else if (s.kind === 'cmd') {
      const tail = s.exit === null ? '' : `  exit ${s.exit}` + (s.ms ? `  ${fmtDuration(s.ms / 1000)}` : '')
      rows.push(Text({ color: s.exit && s.exit !== 0 ? 'red' : undefined, children: [sanitize(fit(`$ ${s.text}`, Math.max(40, width - 22)), 400) + tail] }))
    } else if (s.kind === 'tool') {
      rows.push(Text({ dimColor: true, children: [sanitize(`· ${s.text}`, 400)] }))
    } else if (s.kind === 'say') {
      rows.push(Text({ children: [sanitize(s.text.trim(), 3000)] }))
    } else if (s.kind === 'result') {
      rows.push(Text({ bold: true, children: [sanitize(`■ ${s.text}`, 400) + (s.ms ? ` in ${fmtDuration(s.ms / 1000)}` : '')] }))
    }
  }
  return [head, ...rows]
}
