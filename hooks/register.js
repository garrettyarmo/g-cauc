// g-cauc mod: the /board pane, the quiet line above the prompt, and the
// permission advisor. It reads GitHub, the process list and job logs on a
// timer; it holds no state of record (GitHub and git do), only a shared cache
// in $.store so several open sessions make one set of gh calls.

import {
  parseProjects, parseLanes, summarizeProject, parseJobs, laneOf, modelName, parseEtime,
  fmtDuration, parseLsof, parseLog, bar, bandText, suggestedRules, withAllowed, labelsOf, parseClaudeAgents,
  asArray, sanitize, callKey,
} from './lib.js'
import { parseRuns, parseRunJobs, parseRunners, parseRepoSlots, doneTimings, budgetsFromDone, refusalMessage, summarizeCi, ciBand } from './ci.js'
import { colored, progress, pill, slots, dots, budgetTone } from './draw.js'

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
// CI across projects: { at, vm, projects: [{ name, repo, key, ci, error }], billing }
let ci = { at: 0, vm: '', projects: [], billing: null }
let ghLogin = null
let billingAt = 0
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
    await $.command.register({ name: 'board', description: 'g-cauc: milestone, running jobs, CI, lanes, allow-list suggestions', argumentHint: '[refresh]', immediate: true })
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
    const cib = ciBand(ci.projects)
    const survey = (e.props && e.props.hasSurvey) || e.hasSurvey
    if ((!line && !cib) || survey) return next(e)
    const E = $.ui.resolve(e)
    const theirs = await next(e)
    const parts = [E.Text({ dimColor: true, children: [(line || 'g-cauc') + (cib ? ' · ' + cib.text : '')] })]
    if (cib && cib.alert) parts.push(colored(E, e.surface, 'bad', ' · ' + cib.alert, { bold: true }))
    parts.push(E.Text({ dimColor: true, children: ['   /board'] }))
    const mine = E.Box({ flexDirection: 'row', children: parts })
    return E.Box({ flexDirection: 'column', children: theirs ? [theirs, mine] : [mine] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const E = $.ui.resolve(e)
    const width = (e.props && e.props.bodyColumns) || 80
    return boardView($, E, width, e.surface)
  })

  // Permission advisor: a dialog you answered, then the same call running,
  // counts as one approval of each rule Claude Code suggested for it.
  // The order for one call: tool.check says ask, the dialog opens
  // (PermissionRequest), and only an approved call runs (PostToolUse, same id).
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict && verdict.decision === 'ask' && e.tool_use_id && next.origin && next.origin.plugin === 'engine') {
      const now = await $.clock.now()
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
      // A dialog opens seconds after its call is checked, so only calls checked in
      // the last 2 minutes qualify (an ask the auto-mode classifier denied never
      // gets a dialog and must not swallow a later one); the oldest of those wins,
      // since dialogs arrive in call order.
      const key = callKey(e.tool_name, e.tool_input)
      const now = await $.clock.now()
      const match = [...asks.values()].filter((a) => a.key === key && !a.rules && now - a.at < 120_000)
      const ask = match.length ? match[0] : null
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
    const ciCached = await $.store.get('ci-snapshot')
    if (!force && ciCached && Date.now() - ciCached.at < STALE_MS) {
      ci = ciCached
    } else {
      ci = await gatherCi($, ciCached)
      await $.store.set('ci-snapshot', ci)
    }
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
      try {
        lanes = await withLaneState($, cached.lanes || [])
      } catch {
        lanes = []
      }
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

// A file as it is on origin/main (the checkout can lag behind), else as it is on disk.
async function readMain($, path, file) {
  const shown = await sh($, ['git', '-C', path, 'show', 'origin/main:' + file])
  return shown !== null ? shown : readText($, path + '/' + file)
}

async function specFiles($, path) {
  const listed = await sh($, ['git', '-C', path, 'ls-tree', '--name-only', 'origin/main', 'specs/'])
  if (listed !== null) return listed.split('\n').map((l) => l.replace(/^specs\//, '').trim()).filter(Boolean)
  try {
    return (await $.fs.list(path + '/specs')).map((f) => f.name)
  } catch {
    return []
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
      const roadmap = await readMain($, p.path, 'ROADMAP.md')
      const agents = await readMain($, p.path, 'AGENTS.md')
      const specs = []
      for (const name of await specFiles($, p.path)) {
        const m = name.match(/^(\d{3})-.*\.md$/)
        if (!m) continue
        const text = await readMain($, p.path, 'specs/' + name)
        const title = ((text.match(/^#\s+(.+)$/m) || [])[1] || name).replace(/^(Spec\s+)?\d{3}\s*[:.]\s*/i, '')
        specs.push({ num: m[1], file: name, title, text: text.slice(0, 2000) })
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

// ---------- CI ----------

const repoOk = (r) => /^[\w.-]+\/[\w.-]+$/.test(r)

// Facts about one finished run that never change: whether GitHub refused it,
// and the done timings in its log. Cached per run in $.store.
async function runFacts($, repo, run) {
  const jobsOfRun = parseRunJobs(await sh($, ['gh', 'api', `repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`]), run) || []
  const facts = { refused: null, fast: null, full: null }
  for (const j of jobsOfRun) {
    if (j.conclusion === 'failure' && j.steps.length === 0) {
      const msg = refusalMessage(asArray(await sh($, ['gh', 'api', `repos/${repo}/check-runs/${j.id}/annotations`])))
      if (msg) facts.refused = msg
    }
    if (j.name === 'done' && j.steps.length && repoOk(repo)) {
      // The job's log path is an argument, not part of the script, and a failed gh call exits 3.
      const lines = await sh($, ['sh', '-c', 'out=$(gh api "$1") || exit 3; printf "%s\\n" "$out" | grep -E "done --(fast|full): " | tail -4; exit 0', 'sh', `repos/${repo}/actions/jobs/${Number(j.id)}/logs`])
      if (lines === null) facts.retry = true
      for (const t of doneTimings(lines || '')) facts[t.mode] = t
    }
  }
  return facts
}

async function gatherCi($, cached) {
  const repoSlots = parseRepoSlots(await readText($, kitDir + '/runner/repos'))
  const vm = repoSlots.length ? ((await sh($, ['limactl', 'list', 'gcauc-ci', '--format', '{{.Status}}'])) || '').trim() || 'not created' : ''
  const out = []
  for (const p of projects) {
    const key = p.path.split('/').pop()
    try {
      if (!repoOk(p.repo)) throw new Error('not a GitHub repo name: ' + p.repo)
      const runs = parseRuns(await sh($, ['gh', 'api', `repos/${p.repo}/actions/runs?per_page=40`]))
      if (!runs) throw new Error('gh could not read the Actions runs of ' + p.repo + '; showing the last good data')
      const liveJobs = []
      for (const r of runs.filter((x) => x.status !== 'completed').slice(0, 8)) {
        liveJobs.push(...(parseRunJobs(await sh($, ['gh', 'api', `repos/${p.repo}/actions/runs/${r.id}/jobs?per_page=50`]), r) || []))
      }
      const runners = parseRunners(await sh($, ['gh', 'api', `repos/${p.repo}/actions/runners?per_page=100`])) || []
      const prs = asArray(await sh($, ['gh', 'pr', 'list', '--repo', p.repo, '--state', 'open', '--limit', '30', '--json', 'number,title,url,headRefName,mergeStateStatus,statusCheckRollup'])) || []
      // GitHub's single merge state hides BEHIND under BLOCKED, so ask git whether the head contains main.
      const behind = {}
      for (const pr of prs.slice(0, 30)) {
        if (!/^[\w./-]+$/.test(String(pr.headRefName || ''))) continue
        try {
          const r = await $.process.run(['git', '-C', p.path, 'merge-base', '--is-ancestor', 'origin/main', 'origin/' + pr.headRefName], { timeoutMs: 10_000 })
          if (r.exitCode === 0) behind[pr.number] = false
          else if (r.exitCode === 1) behind[pr.number] = true
        } catch {
          // unknown: GitHub's merge state decides
        }
      }
      const facts = {}
      let fetched = 0
      const keep = new Set()
      for (const r of runs.filter((x) => x.status === 'completed').slice(0, 20)) {
        const k = 'ci-run\u0000' + p.repo + '\u0000' + r.id
        keep.add(k)
        let f = await $.store.get(k)
        if ((!f || (f.retry && (f.tries || 0) < 3)) && fetched < 4) {
          fetched += 1
          const tries = ((f && f.tries) || 0) + 1
          f = { ...(await runFacts($, p.repo, r)), tries }
          await $.store.set(k, f)
        }
        if (f) facts[r.id] = f
      }
      for (const k of await $.store.keys()) if (k.startsWith('ci-run\u0000' + p.repo + '\u0000') && !keep.has(k)) await $.store.delete(k)
      const budgets = budgetsFromDone(await readMain($, p.path, 'scripts/done'))
      const slotCount = (repoSlots.find((x) => x.repo === p.repo) || {}).slots ?? null
      out.push({ name: p.name, repo: p.repo, key, ci: summarizeCi({ runs, jobs: liveJobs, runners, slots: slotCount, prs, facts, budgets, now: Date.now(), behind }) })
    } catch (err) {
      const before = [...ci.projects, ...((cached && cached.projects) || [])].find((x) => x.repo === p.repo && x.ci)
      out.push({ name: p.name, repo: p.repo, key, ci: before ? before.ci : null, stale: true, error: String((err && err.message) || err) })
    }
  }
  return { at: Date.now(), vm, projects: out, billing: await billing($, cached) }
}

// Actions minutes this month, when the gh token has the user scope; checked every 10 minutes.
async function billing($, cached) {
  if (Date.now() - billingAt < 10 * 60_000) return (cached && cached.billing) || ci.billing
  billingAt = Date.now()
  if (!ghLogin) ghLogin = ((await sh($, ['gh', 'api', 'user', '--jq', '.login'])) || '').trim() || null
  if (!ghLogin) return { error: 'gh is not signed in' }
  const raw = await sh($, ['gh', 'api', `users/${ghLogin}/settings/billing/actions`])
  try {
    const b = JSON.parse(raw || '')
    return { used: b.total_minutes_used ?? null, included: b.included_minutes ?? null, paid: b.total_paid_minutes_used ?? null }
  } catch {
    return { error: 'billing needs the gh "user" scope (gh auth refresh -s user)' }
  }
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

function boardView($, E, width, surface) {
  const { Box, Text, Button } = E
  const redraw = () => $.ui.invalidate('ui.render')
  const sugg = suggestions()
  const ciAlert = ciBand(ci.projects)
  const tabs = [['plan', 'Plan', '1'], ['now', `Now ${jobs.length}`, '2'], ['ci', ciAlert && ciAlert.alert ? 'CI !' : 'CI', '3'], ['lanes', 'Lanes', '4']]
  if (sugg.length) tabs.push(['allow', `Allow ${sugg.length}`, '5'])
  if (selected) tabs.push(['job', 'Job', '6'])
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
      ...(lastError ? [colored(E, surface, 'bad', lastError.slice(0, 80))] : []),
    ],
  })
  let body
  if (tab === 'now') body = nowView($, E, width, surface)
  else if (tab === 'ci') body = ciView(E, width, surface)
  else if (tab === 'lanes') body = lanesView(E, surface)
  else if (tab === 'allow') body = allowView($, E, sugg)
  else if (tab === 'job') body = jobView($, E, width, surface)
  else body = planView($, E, width, surface)
  return Box({ flexDirection: 'column', rowGap: 1, children: [tabRow, status, Box({ flexDirection: 'column', rowGap: tab === 'plan' || tab === 'ci' ? 1 : 0, children: body })] })
}

// Cut text to n columns, so a row stays one line in a narrow pane.
function fit(text, n) {
  const t = sanitize(String(text || ''), 2000).replace(/\n/g, ' ')
  return t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t
}

function linkOrText(E, url, label, surface) {
  const { Link, Text } = E
  label = sanitize(label, 300).replace(/\n/g, ' ')
  return surface === 'desktop' && /^https?:\/\//.test(String(url || '')) ? Link({ href: url, label }) : Text({ wrap: 'truncate-end', children: [label] })
}

// A row's main text: one line, cut at the end when the pane is narrow.
function line(E, text, extra = {}) {
  return E.Text({ ...extra, wrap: 'truncate-end', children: [sanitize(text, 2000)] })
}

function section(E, title, children) {
  const { Box, Text } = E
  return Box({ flexDirection: 'column', children: [Text({ bold: true, children: [title] }), ...children] })
}

function row(E, children) {
  return E.Box({ flexDirection: 'row', columnGap: 1, alignItems: 'center', children })
}

const roleTone = (role) => (/review/.test(role) ? 'warn' : /fix/.test(role) ? 'purple' : 'accent')
const roleWord = (role) => (/review/.test(role) ? 'review' : /fix/.test(role) ? 'fix' : 'build')

function issueRow($, E, p, i, width, surface, fallback) {
  const { Button, Text } = E
  const job = jobs.find((j) => j.project === p.key && j.issue === i.number)
  const title = fit(`#${i.number} ${i.title}`, Math.max(20, width - 34))
  if (!job) return row(E, [line(E, title), fallback])
  return row(E, [
    Button({ key: `row-${p.key}-${i.number}`, plain: true, label: title + ' ›', onPress: () => openJob($, job) }),
    pill(E, surface, roleWord(job.role) + (job.round ? ' r' + job.round : ''), roleTone(job.role)),
    Text({ dimColor: true, children: [`${modelName(job.model) || job.lane} · ${fmtDuration(job.elapsed)}`] }),
  ])
}

function planView($, E, width, surface) {
  const { Text, Box } = E
  if (projects.length === 0) return [Text({ dimColor: true, children: [refreshedAt ? 'No projects in ' + kitDir.replace(home, '~') + '/projects.md.' : 'Reading GitHub…'] })]
  const out = []
  for (const p of projects) {
    const s = p.summary
    const rows = [row(E, [Text({ bold: true, children: [p.name] }), ...(s.phase ? [pill(E, surface, `Phase ${s.phase.n} · ${s.phase.title}`, 'accent')] : []), Text({ dimColor: true, children: [s.autonomy] })])]
    if (s.phase) {
      rows.push(row(E, [progress(E, surface, s.phase.done, s.phase.total, { width: 240, cells: 18, color: 'accent' }), Text({ children: [`${s.phase.done}/${s.phase.total}`] })]))
      if (s.phase.exit) rows.push(Text({ dimColor: true, children: [fit('exit: ' + s.phase.exit, Math.max(40, width - 2))] }))
    }
    for (const sp of s.specs) rows.push(row(E, [Text({ dimColor: true, children: [fit(`spec ${sp.num} ${sp.title}`, 30).padEnd(31)] }), progress(E, surface, sp.done, sp.total, { width: 150, cells: 10, color: 'good' }), Text({ dimColor: true, children: [`${sp.done}/${sp.total}`] })]))
    const running = [...s.building, ...s.inReview]
    if (running.length) rows.push(section(E, 'Running', running.map((i) => issueRow($, E, p, i, width, surface, pill(E, surface, i.labels.includes('in-review') ? 'in review' : 'building', i.labels.includes('in-review') ? 'warn' : 'accent')))))
    const next = s.ready.slice(0, 6)
    if (next.length) rows.push(section(E, 'Next', next.map((i) => issueRow($, E, p, i, width, surface, i.waitingOn.length ? colored(E, surface, 'muted', `waits on #${i.waitingOn.join(', #')}`) : pill(E, surface, 'ready', 'good')))))
    if (s.needs.length) rows.push(section(E, 'Needs you', s.needs.map((n) => row(E, [pill(E, surface, n.kind === 'spec' ? 'spec to merge' : 'question', 'bad'), linkOrText(E, n.url, fit(`#${n.number} ${n.title}`, Math.max(20, width - 20)), surface)]))))
    if (s.merged.length) rows.push(section(E, 'Recently merged', s.merged.map((m) => row(E, [colored(E, surface, 'good', '✓'), Text({ dimColor: true, children: [fit(`#${m.number} ${m.title}`, width - 4)] })]))))
    if (s.ideas) rows.push(Text({ dimColor: true, children: [`${s.ideas} idea${s.ideas === 1 ? '' : 's'} waiting for the product pass`] }))
    if (p.error) rows.push(colored(E, surface, 'bad', p.error.slice(0, 100)))
    out.push(Box({ flexDirection: 'column', children: rows }))
  }
  return out
}

function nowView($, E, width, surface) {
  const { Text, Button } = E
  const out = []
  if (jobs.length === 0) out.push(Text({ dimColor: true, children: ['No g-cauc jobs running.'] }))
  for (const j of jobs) {
    out.push(row(E, [
      Button({ key: 'job-' + j.pid, plain: true, label: `${j.project} #${j.issue} ›`, onPress: () => openJob($, j) }),
      pill(E, surface, roleWord(j.role) + (j.round ? ' r' + j.round : ''), roleTone(j.role)),
      Text({ dimColor: true, children: [`${modelName(j.model) || j.lane} · ${fmtDuration(j.elapsed)}`] }),
    ]))
  }
  if (recent.length) {
    out.push(Text({ bold: true, children: ['Recent logs'] }))
    for (const r of recent) out.push(Button({ key: 'log-' + r.path, plain: true, dimColor: true, label: fit(`${r.project}  ${r.name}`, Math.max(40, width - 4)), onPress: () => openJob($, { path: r.path, title: `${r.project} ${r.name}` }) }))
  }
  return out
}

const checkTone = (state) => (state === 'pass' ? 'good' : state === 'fail' ? 'bad' : state === 'skip' ? 'muted' : 'warn')
const checkMark = (state) => (state === 'pass' ? '✓' : state === 'fail' ? '✗' : state === 'skip' ? '-' : '…')

function ciView(E, width, surface) {
  const { Text, Box } = E
  const out = []
  if (ci.projects.length === 0) return [Text({ dimColor: true, children: [refreshedAt ? 'No CI data yet.' : 'Reading GitHub…'] })]
  for (const p of ci.projects) {
    const rows = [row(E, [Text({ bold: true, children: [p.name] }), ...(ci.vm ? [pill(E, surface, 'VM ' + ci.vm.toLowerCase(), /running/i.test(ci.vm) ? 'good' : 'bad')] : [])])]
    if (!p.ci) {
      rows.push(colored(E, surface, 'bad', p.error || 'No CI data.'))
      out.push(Box({ flexDirection: 'column', children: rows }))
      continue
    }
    const c = p.ci
    if (c.pool.slots.length) {
      rows.push(row(E, [Text({ children: ['Pool'] }), slots(E, surface, c.pool.slots), Text({ dimColor: true, children: [`${c.pool.busy} busy · ${c.pool.idle} idle${c.pool.offline ? ` · ${c.pool.offline} offline` : ''}`] })]))
    }
    if (c.refusal) rows.push(row(E, [pill(E, surface, 'refused', 'bad'), colored(E, surface, 'bad', `${c.refusal.message} (${c.refusal.runs} run${c.refusal.runs === 1 ? '' : 's'})`)]))
    if (c.running.length) {
      rows.push(section(E, 'Running', c.running.map((j) => row(E, [
        line(E, fit(`${j.prs.length ? 'PR ' + j.prs[0] : j.branch} · ${j.name}`, Math.max(20, width - 40))),
        pill(E, surface, j.slot ? 'slot ' + j.slot : 'GitHub-hosted', j.slot ? 'accent' : 'purple'),
        Text({ dimColor: true, children: [`${fmtDuration(j.elapsed || 0)}${j.step ? ' · ' + fit(j.step, 28) : ''}`] }),
      ]))))
    }
    if (c.queued.length) {
      const qrows = []
      for (const j of c.queued) {
        qrows.push(row(E, [line(E, fit(`${j.prs.length ? 'PR ' + j.prs[0] : j.branch} · ${j.name}`, Math.max(20, width - 30))), pill(E, surface, (j.stuck ? 'stuck ' : j.status === 'queued' ? 'queued ' : j.status + ' ') + fmtDuration(j.wait), j.stuck ? 'bad' : j.status === 'queued' ? 'warn' : 'muted')]))
        if (j.stuck) qrows.push(Text({ dimColor: true, children: [fit(`  wants ${j.labels.join(', ') || 'no labels'} · pool has ${c.pool.labels.join(', ') || 'none'}`, width - 2)] }))
      }
      rows.push(section(E, 'Queued', qrows))
    }
    if (c.recent.length) {
      const passed = c.recent.filter((r) => r.conclusion === 'success').length
      const lines = [row(E, [dots(E, surface, c.recent.map((r) => r.conclusion).reverse()), Text({ dimColor: true, children: [`${passed} of ${c.recent.length} passed`] })])]
      for (const mode of ['fast', 'full']) {
        const list = c.timings[mode]
        if (!list.length) continue
        const last = list[0]
        const budget = c.timings.budgets[mode]
        const avg = Math.round(list.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(list.length, 5))
        lines.push(row(E, [
          Text({ dimColor: true, children: [`done --${mode}`.padEnd(12)] }),
          budget ? progress(E, surface, last, budget, { width: 150, cells: 10, color: budgetTone(last, budget) }) : Text({ children: [''] }),
          Text({ children: [budget ? `${last}s of ${budget}s` : `${last}s`] }),
          Text({ dimColor: true, children: [`avg ${avg}s`] }),
        ]))
      }
      rows.push(section(E, 'Recent results', lines))
    }
    if (c.prs.length) {
      rows.push(section(E, 'Pull requests', c.prs.slice(0, 8).map((pr) => row(E, [
        linkOrText(E, pr.url, fit(`#${pr.number} ${pr.title}`, Math.max(16, width - 52)), surface),
        ...Object.entries(pr.checks).map(([name, state]) => pill(E, surface, `${checkMark(state)} ${name}`, checkTone(state))),
        ...(pr.behind ? [pill(E, surface, 'behind main', 'warn')] : []),
      ]))))
    }
    if (p.error) rows.push(colored(E, surface, 'bad', p.error.slice(0, 100)))
    out.push(Box({ flexDirection: 'column', children: rows }))
  }
  const b = ci.billing
  if (b) out.push(Text({ dimColor: true, children: [b.error ? 'Actions minutes: ' + b.error : `Actions minutes this month: ${b.used ?? '?'}${b.included ? ' of ' + b.included + ' included' : ''}${b.paid ? `, ${b.paid} paid` : ''}`] }))
  return out
}

function lanesView(E, surface) {
  const { Text } = E
  const out = []
  for (const l of lanes) {
    const status = l.outUntil ? pill(E, surface, 'out until ' + l.outUntil.slice(5, 16).replace('T', ' '), 'bad') : l.max === 0 ? pill(E, surface, 'off', 'muted') : pill(E, surface, 'on', 'good')
    out.push(row(E, [
      Text({ dimColor: l.max === 0, children: [`${l.lane}`.padEnd(9) + `${l.family}`.padEnd(10)] }),
      progress(E, surface, l.running ?? 0, Math.max(l.max, 1), { width: 90, cells: 6, color: 'accent' }),
      Text({ dimColor: true, children: [`${l.running ?? 0}/${l.max}`.padEnd(5)] }),
      status,
    ]))
  }
  if (claudeLimits.length) {
    out.push(Text({ bold: true, children: ['Claude plan'] }))
    for (const r of claudeLimits) {
      const pct = Math.round(r.percentUsed)
      out.push(row(E, [
        Text({ dimColor: true, children: [`${r.kind}`.padEnd(12)] }),
        progress(E, surface, pct, 100, { width: 150, cells: 10, color: pct < 70 ? 'good' : pct < 90 ? 'warn' : 'bad' }),
        Text({ children: [`${pct}%`] }),
        Text({ dimColor: true, children: [r.resetsAt ? 'resets ' + String(r.resetsAt).slice(5, 16).replace('T', ' ') : ''] }),
      ]))
    }
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

function jobView($, E, width, surface) {
  const { Text, Box, Button, Code } = E
  if (!selected) return [Text({ dimColor: true, children: ['Pick a job on the Now tab.'] })]
  const head = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ bold: true, children: [selected.title] }),
      Button({ key: 'thinking', label: showThinking ? 'Hide thinking' : 'Show thinking', hotkey: 't', plain: true, dimColor: true, onPress: () => { showThinking = !showThinking; $.ui.invalidate('ui.render') } }),
      ...(selected.url ? [linkOrText(E, selected.url, 'issue', surface)] : []),
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
      const cmd = Text({ children: [sanitize(fit(`$ ${s.text}`, Math.max(40, width - 24)), 400)] })
      rows.push(s.exit === null ? cmd : row(E, [cmd, pill(E, surface, `exit ${s.exit}` + (s.ms ? ` · ${fmtDuration(s.ms / 1000)}` : ''), s.exit === 0 ? 'good' : 'bad')]))
    } else if (s.kind === 'tool') {
      rows.push(Text({ dimColor: true, children: [sanitize(`· ${s.text}`, 400)] }))
    } else if (s.kind === 'say') {
      rows.push(Text({ children: [sanitize(s.text.trim(), 3000)] }))
    } else if (s.kind === 'result') {
      rows.push(row(E, [pill(E, surface, s.text.startsWith('failed') ? 'failed' : 'finished', s.text.startsWith('failed') ? 'bad' : 'good'), Text({ children: [sanitize(s.text.replace(/^(failed|finished):?\s*/, ''), 300) + (s.ms ? ` in ${fmtDuration(s.ms / 1000)}` : '')] })]))
    }
  }
  return [head, ...rows]
}
