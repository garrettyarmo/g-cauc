#!/usr/bin/env node
// The progress page: each project's board (ready, building, in review, needs Garrett, merged),
// its CI as GitHub Actions lists it with the runner pool's machines, and how fast each project
// merges, as one HTML file. It reads GitHub with gh, the worker jobs on this Mac, the local
// worktrees, and each pool machine (over SSH for the others), and it uses no model. The board's own parsers and
// colors (hooks/lib.js, hooks/draw.js) do the parsing and the colors.
//
//   node scripts/dashboard.mjs            write the page once
//   node scripts/dashboard.mjs open       write the page and open it
//   node scripts/dashboard.mjs uninstall  remove the old launchd agent that wrote it on a timer
//
// It reads GitHub only when you run it: all agents share one GraphQL limit.
// The page: ~/code/g-cauc/dashboard/index.html. An open page reloads itself every minute.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProjects, monogram, parseJobs, parseClaudeAgents, laneOf, modelName } from '../hooks/lib.js'
import { projectColor, ink } from '../hooks/draw.js'
import { latestChecks, parseRuns, parseRunJobs, parseRepoSlots } from '../hooks/ci.js'

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = os.homedir()
const outDir = path.join(kit, 'dashboard')
const label = 'com.gcauc.dashboard'
const plist = path.join(home, 'Library/LaunchAgents', label + '.plist')
const DAY = 86400000
const DAYS = 14

const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
  } catch {
    return null
  }
}
const gh = (args) => {
  try {
    return { data: JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })) }
  } catch (e) {
    return { error: String(e.stderr || e.message || e).split('\n').filter(Boolean)[0] || 'gh failed' }
  }
}

// projects.md first, then any repo the runner pool serves that projects.md does not list.
function projects() {
  const listed = parseProjects(fs.readFileSync(path.join(kit, 'projects.md'), 'utf8'), home)
  const pool = fs.readFileSync(path.join(kit, 'runner/repos'), 'utf8').split('\n')
    .map((l) => l.trim().split(/\s+/)[0]).filter((r) => r && !r.startsWith('#'))
  for (const repo of pool) {
    if (listed.some((p) => p.repo === repo)) continue
    const short = repo.split('/').pop()
    listed.push({ priority: 99, name: short, path: path.join(home, 'code', short), repo, color: null })
  }
  return listed.map((p, i) => ({ ...p, color: projectColor(p, i) }))
}

const labelsOf = (x) => (x.labels || []).map((l) => l.name)
const has = (x, name) => labelsOf(x).includes(name)

// The ticket a PR builds: "#N" from a build/<N>- or fix/<N>- branch, "S-N" from a myqap slice.
function ticketOf(pr) {
  const issue = String(pr.headRefName || '').match(/^(?:build|fix)\/(\d+)-/)
  if (issue) return '#' + issue[1]
  const slice = String(pr.title || '').match(/^S-(\d+)/i) || String(pr.headRefName || '').match(/(?:^|\/)s(\d+)[-_]/i)
  if (slice) return 'S-' + slice[1]
  return 'PR ' + pr.number
}

// The newest run of each check (latestChecks), so a passing rerun replaces an old failure.
// CI is every check and status except agent-review.
function checks(pr) {
  const latest = latestChecks(pr.statusCheckRollup)
  const review = latest['agent-review']
  const ci = Object.entries(latest).filter(([name]) => name !== 'agent-review').map(([, state]) => state)
  const chips = []
  if (pr.isDraft) chips.push({ text: 'Draft', tone: 'muted' })
  if (!ci.length) chips.push({ text: 'No CI', tone: 'muted' })
  else if (ci.includes('fail')) chips.push({ text: 'CI failed', tone: 'bad' })
  else if (ci.includes('running')) chips.push({ text: 'CI running', tone: 'warn' })
  else chips.push({ text: 'CI passed', tone: 'good' })
  if (review === 'pass') chips.push({ text: 'Review passed', tone: 'good' })
  else if (review === 'running') chips.push({ text: 'In review', tone: 'warn' })
  else if (review === 'fail') chips.push({ text: 'Review blocked', tone: 'bad' })
  else chips.push({ text: 'Not reviewed', tone: 'muted' })
  if (pr.mergeStateStatus === 'DIRTY') chips.push({ text: 'Conflict', tone: 'bad' })
  else if (pr.mergeStateStatus === 'BEHIND') chips.push({ text: 'Behind main', tone: 'warn' })
  if (has(pr, 'risk:high')) chips.push({ text: 'risk:high', tone: 'muted' })
  return chips
}

const jobChip = (j) => ({ text: `${j.cli === 'claude' ? 'Claude' : modelName(j.model) || laneOf(j.cli, j.model)} ${j.role === 'review' || j.role === 'agent-review' ? 'reviewing' : j.role === 'fix' ? 'fixing' : 'building'}`, tone: 'warn' })

// Slices that have a worktree with a commit in the last 48 hours and no PR yet, one card each.
function sliceWorktrees(p, taken, now) {
  const out = run('git', ['-C', p.path, 'worktree', 'list', '--porcelain'])
  if (!out) return []
  const cards = []
  for (const block of out.split('\n\n')) {
    const wt = (block.match(/^worktree (.+)$/m) || [])[1]
    const branch = (block.match(/^branch refs\/heads\/(.+)$/m) || [])[1]
    const slice = branch && branch.match(/(?:^|\/)s(\d+)[-_](.*)$/i)
    if (!wt || !slice || taken.has('S-' + slice[1])) continue
    const ct = Number(run('git', ['-C', wt, 'log', '-1', '--format=%ct']) || 0) * 1000
    if (!ct || now - ct > 2 * DAY) continue
    taken.add('S-' + slice[1])
    cards.push({ id: 'S-' + slice[1], title: slice[2].replace(/[-_]+/g, ' '), since: new Date(ct).toISOString(), chips: [{ text: 'Worktree, no PR yet', tone: 'muted' }] })
  }
  return cards
}

function collect(p, jobs, now) {
  const base = { name: p.name, repo: p.repo, url: `https://github.com/${p.repo}`, color: p.color, ink: ink(p.color), mono: monogram(p.name) }
  const since = new Date(now - DAYS * DAY).toISOString().slice(0, 10)
  const issues = gh(['issue', 'list', '-R', p.repo, '--state', 'open', '--limit', '300', '--json', 'number,title,labels,updatedAt,url'])
  const open = gh(['pr', 'list', '-R', p.repo, '--state', 'open', '--limit', '100', '--json', 'number,title,headRefName,labels,createdAt,isDraft,statusCheckRollup,mergeStateStatus,url'])
  const merged = gh(['pr', 'list', '-R', p.repo, '--state', 'merged', '--search', `merged:>=${since}`, '--limit', '1000', '--json', 'number,title,headRefName,createdAt,mergedAt,url'])
  const error = issues.error || open.error || merged.error
  if (error) return { ...base, error }

  const key = path.basename(p.path)
  const mine = jobs.filter((j) => j.project === key)
  const prs = open.data
  // A ticket with two open PRs shows its newest one.
  const prOf = new Map()
  for (const pr of prs) {
    const t = ticketOf(pr)
    if (!prOf.has(t) || Date.parse(pr.createdAt) > Date.parse(prOf.get(t).createdAt)) prOf.set(t, pr)
  }
  const issueCard = (i, chips = []) => ({ id: '#' + i.number, title: i.title, url: i.url, since: i.updatedAt, chips })
  const prCard = (pr) => {
    const t = ticketOf(pr)
    const live = mine.filter((j) => '#' + j.issue === t && j.role !== 'build').map(jobChip)
    return { id: t, title: pr.title, url: pr.url, since: pr.createdAt, chips: [...checks(pr), ...live] }
  }

  // One card per ticket, in the first column that fits: Needs you, In review, Building, Ready.
  // An issue with an open PR shows as that PR, with the PR's checks.
  const needsYou = { text: 'Needs you', tone: 'bad' }
  const parked = new Set(issues.data.filter((i) => has(i, 'needs:garrett')).map((i) => '#' + i.number))
  for (const pr of prs) if (has(pr, 'needs:garrett')) parked.add(ticketOf(pr))
  const needs = [...parked].map((t) => {
    const pr = prOf.get(t)
    if (pr) {
      const c = prCard(pr)
      return { ...c, chips: [needsYou, ...c.chips] }
    }
    const i = issues.data.find((x) => '#' + x.number === t)
    return i ? issueCard(i, [needsYou]) : null
  }).filter(Boolean)
  const waiting = (i) => !parked.has('#' + i.number) && !prOf.has('#' + i.number)
  const ready = issues.data.filter((i) => has(i, 'ready') && !has(i, 'building') && waiting(i)).sort((a, b) => a.number - b.number).map((i) => issueCard(i))
  const building = issues.data.filter((i) => has(i, 'building') && waiting(i))
    .map((i) => issueCard(i, mine.filter((j) => j.issue === i.number).map(jobChip)))
  const usesIssues = issues.data.some((i) => ['ready', 'building', 'in-review'].some((l) => has(i, l)))
  if (!usesIssues) building.push(...sliceWorktrees(p, new Set([...prs, ...merged.data].map(ticketOf)), now))
  const review = [...prOf].filter(([t]) => !parked.has(t)).map(([, pr]) => prCard(pr))

  const done = merged.data.filter((pr) => pr.mergedAt).map((pr) => ({ ...pr, t: Date.parse(pr.mergedAt) }))
  // Calendar days in local time, so a day with a clock change keeps its own midnights.
  const today = new Date(now)
  const midnight = (k) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - k).getTime()
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const start = midnight(DAYS - 1 - i)
    const end = midnight(DAYS - 2 - i)
    return { day: new Date(start).toISOString(), n: done.filter((pr) => pr.t >= start && pr.t < end).length }
  })
  const week = done.filter((pr) => pr.t >= now - 7 * DAY)
  const hours = week.map((pr) => (pr.t - Date.parse(pr.createdAt)) / 3600000).sort((a, b) => a - b)
  const median = hours.length ? (hours[(hours.length - 1) >> 1] + hours[hours.length >> 1]) / 2 : null

  return {
    ...base,
    ready, building, review, needs,
    merged: done.filter((pr) => pr.t >= now - DAY).sort((a, b) => b.t - a.t)
      .map((pr) => ({ id: ticketOf(pr), title: pr.title, url: pr.url, since: pr.mergedAt, chips: [] })),
    daily,
    week: week.length,
    lastWeek: done.filter((pr) => pr.t >= now - 14 * DAY && pr.t < now - 7 * DAY).length,
    median,
    events: [...done.filter((pr) => pr.t >= now - 2 * DAY).map((pr) => ({ when: pr.mergedAt, verb: 'merged', id: ticketOf(pr), title: pr.title, url: pr.url })),
      ...prs.filter((pr) => Date.parse(pr.createdAt) >= now - DAY).map((pr) => ({ when: pr.createdAt, verb: 'opened', id: ticketOf(pr), title: pr.title, url: pr.url }))],
  }
}

// CI as GitHub Actions lists it: the jobs that have not finished, and the latest finished runs.
// The runs API filters on one status a call, so each unfinished status is its own call. Any read
// that fails or comes back cut short goes in `error`, so the page never shows a short list as whole.
const ACTIVE = ['in_progress', 'queued', 'waiting', 'pending', 'requested']
function runsOf(repo, status, perPage, errors) {
  const text = run('gh', ['api', `repos/${repo}/actions/runs?status=${status}&per_page=${perPage}`])
  const runs = parseRuns(text)
  if (!runs) errors.push(`gh could not read the ${status} runs`)
  else if (status !== 'completed' && JSON.parse(text).total_count > runs.length) errors.push(`more than ${perPage} ${status} runs, so some are missing`)
  return runs || []
}
function ciOf(p) {
  const errors = []
  const active = new Map(ACTIVE.flatMap((st) => runsOf(p.repo, st, 100, errors)).map((r) => [r.id, r]))
  const live = []
  for (const r of active.values()) {
    const text = run('gh', ['api', `repos/${p.repo}/actions/runs/${r.id}/jobs?per_page=100`])
    const jobs = parseRunJobs(text, r)
    if (!jobs) { errors.push(`gh could not read the jobs of run ${r.id} (${r.workflow}, ${r.branch})`); continue }
    if (JSON.parse(text).total_count > jobs.length) errors.push(`run ${r.id} (${r.workflow}, ${r.branch}) has more than 100 jobs, so some are missing`)
    for (const j of jobs) {
      if (j.status === 'completed') continue
      live.push({ repo: p.repo, name: j.name, workflow: j.workflow, branch: j.branch, prs: j.prs, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt, runner: j.runner, labels: j.labels, step: j.step, url: j.url })
    }
  }
  const done = runsOf(p.repo, 'completed', 30, errors)
    .map((r) => ({ repo: p.repo, title: r.title, workflow: r.workflow, branch: r.branch, prs: r.prs, conclusion: r.conclusion, startedAt: r.startedAt, endedAt: r.updatedAt, url: r.url }))
  return { repo: p.repo, live, done, error: errors.length ? errors.join('; ') : null }
}

// What one pool machine knows about itself: its core count, its load and its memory, read as
// gcauc-runner's host_has_room reads them, and the state of each live slot from runner/.slots.
// A slot file counts only while its process is still a gcauc-runner serve (live_states).
const PROBE = `cd "$HOME/code/g-cauc/runner" || exit 1
if [ "$(uname)" = Darwin ]; then
  c=$(sysctl -n hw.ncpu) && l=$(sysctl -n vm.loadavg) && m=$(sysctl -n kern.memorystatus_vm_pressure_level) || exit 1
  echo "cores $c"; echo "load $(echo "$l" | awk '{ print $2 }')"; echo "pressure $m"
else
  c=$(nproc) && l=$(cut -d' ' -f1 /proc/loadavg) && m=$(awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { if (t) printf "%d", a * 100 / t }' /proc/meminfo) || exit 1
  echo "cores $c"; echo "load $l"; echo "available $m"
fi
for f in .slots/*/*; do
  [ -f "$f" ] || continue
  s="" p=""; read -r s p <"$f" || true
  case "$(ps -o command= -p "$p" 2>/dev/null)" in *"gcauc-runner serve"*) echo "slot \${f#.slots/} $s" ;; esac
done`

// Each machine in runner/hosts, with the slots its own runner/repos.<name> (or runner/repos) sets.
function machines(projs) {
  const self = os.hostname().split('.')[0].toLowerCase()
  const hosts = fs.readFileSync(path.join(kit, 'runner/hosts'), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
  return hosts.map((name) => {
    const own = path.join(kit, 'runner/repos.' + name)
    const repos = parseRepoSlots(fs.readFileSync(fs.existsSync(own) ? own : path.join(kit, 'runner/repos'), 'utf8'))
    const out = name === self ? run('sh', ['-c', PROBE]) : run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', name, PROBE])
    if (!out) return { name, error: name === self ? 'could not read this machine' : 'could not reach it over SSH' }
    const fig = Object.fromEntries(out.split('\n').filter((l) => /^(cores|load|pressure|available) /.test(l)).map((l) => l.split(' ')))
    const states = new Map(out.split('\n').filter((l) => l.startsWith('slot ')).map((l) => l.split(' ').slice(1)))
    const num = (x) => /^\d+(\.\d+)?$/.test(x || '') ? Number(x) : NaN
    const cores = num(fig.cores), load = num(fig.load)
    if (!(cores > 0) || Number.isNaN(load) || Number.isNaN(num(fig.pressure ?? fig.available))) return { name, error: 'it gave no core count, load or memory reading' }
    const memOk = fig.pressure != null ? fig.pressure === '1' : Number(fig.available) >= 10
    return {
      name, cores, load,
      memory: fig.pressure != null ? (fig.pressure === '1' ? 'memory normal' : 'memory pressure ' + fig.pressure) : `${fig.available}% memory free`,
      room: memOk && Math.floor(load) < cores,
      repos: repos.map((r) => {
        const short = r.repo.split('/').pop()
        return { repo: r.repo, slots: Array.from({ length: r.slots }, (_, i) => states.get(`${short}/${i + 1}`) || 'off') }
      }),
    }
  })
}

function liveJobs(now) {
  const agents = run('claude', ['agents', '--json'])
  const claude = agents === null ? [] : parseClaudeAgents(agents, home, now)
  return [...claude, ...parseJobs(run('pgrep', ['-lf', '[a]k:']), { claude: agents === null })]
}

function write() {
  const now = Date.now()
  const jobs = liveJobs(now)
  const projs = projects()
  const data = {
    generated: new Date(now).toISOString(),
    projects: projs.map((p) => collect(p, jobs, now)),
    ci: { repos: projs.map(ciOf), machines: machines(projs) },
  }
  fs.mkdirSync(outDir, { recursive: true })
  const html = fs.readFileSync(path.join(kit, 'scripts/dashboard.html'), 'utf8')
    .replace('/*DATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'))
  const file = path.join(outDir, 'index.html')
  fs.writeFileSync(file + '.tmp', html)
  fs.renameSync(file + '.tmp', file)
  console.log(`${data.generated} wrote ${file}`)
}

function uninstall() {
  run('launchctl', ['bootout', `gui/${process.getuid()}/${label}`])
  fs.rmSync(plist, { force: true })
  console.log('uninstalled')
}

const cmd = process.argv[2] || 'write'
if (cmd === 'write') write()
else if (cmd === 'open') {
  write()
  execFileSync('open', [path.join(outDir, 'index.html')])
} else if (cmd === 'uninstall') uninstall()
else {
  console.error('usage: dashboard.mjs [write|open|uninstall]')
  process.exit(2)
}
