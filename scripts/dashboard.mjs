#!/usr/bin/env node
// The progress page: each project's board (ready, building, in review, needs Garrett, merged)
// and how fast each project merges, as one HTML file. It reads GitHub with gh, the worker jobs
// on this Mac, and the local worktrees, and it uses no model. The board's own parsers and
// colors (hooks/lib.js, hooks/draw.js) do the parsing and the colors.
//
//   node scripts/dashboard.mjs            write the page once
//   node scripts/dashboard.mjs install    write it every 5 minutes (launchd agent)
//   node scripts/dashboard.mjs uninstall  stop the agent
//
// The page: ~/code/g-cauc/dashboard/index.html. It reloads itself every minute.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProjects, monogram, parseJobs, parseClaudeAgents, laneOf, modelName } from '../hooks/lib.js'
import { projectColor, ink } from '../hooks/draw.js'

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

function checks(pr) {
  const rollup = pr.statusCheckRollup || []
  const runs = rollup.filter((c) => c.__typename === 'CheckRun')
  const review = rollup.find((c) => c.__typename === 'StatusContext' && c.context === 'agent-review')
  const chips = []
  if (pr.isDraft) chips.push({ text: 'Draft', tone: 'muted' })
  if (!runs.length) chips.push({ text: 'No CI', tone: 'muted' })
  else if (runs.some((c) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(c.conclusion))) chips.push({ text: 'CI failed', tone: 'bad' })
  else if (runs.some((c) => c.status !== 'COMPLETED')) chips.push({ text: 'CI running', tone: 'warn' })
  else chips.push({ text: 'CI passed', tone: 'good' })
  if (!review) chips.push({ text: 'Not reviewed', tone: 'muted' })
  else if (review.state === 'SUCCESS') chips.push({ text: 'Review passed', tone: 'good' })
  else if (review.state === 'PENDING') chips.push({ text: 'In review', tone: 'warn' })
  else chips.push({ text: 'Review blocked', tone: 'bad' })
  if (pr.mergeStateStatus === 'DIRTY') chips.push({ text: 'Conflict', tone: 'bad' })
  else if (pr.mergeStateStatus === 'BEHIND') chips.push({ text: 'Behind main', tone: 'warn' })
  if (has(pr, 'risk:high')) chips.push({ text: 'risk:high', tone: 'muted' })
  return chips
}

const jobChip = (j) => ({ text: `${j.cli === 'claude' ? 'Claude' : modelName(j.model) || laneOf(j.cli, j.model)} ${j.role === 'review' || j.role === 'agent-review' ? 'reviewing' : j.role === 'fix' ? 'fixing' : 'building'}`, tone: 'warn' })

// Slices that have a worktree with a commit in the last 48 hours and no PR yet.
function sliceWorktrees(p, prBranches, now) {
  const out = run('git', ['-C', p.path, 'worktree', 'list', '--porcelain'])
  if (!out) return []
  const cards = []
  for (const block of out.split('\n\n')) {
    const wt = (block.match(/^worktree (.+)$/m) || [])[1]
    const branch = (block.match(/^branch refs\/heads\/(.+)$/m) || [])[1]
    const slice = branch && branch.match(/(?:^|\/)s(\d+)[-_](.*)$/i)
    if (!wt || !slice || prBranches.has(branch)) continue
    const ct = Number(run('git', ['-C', wt, 'log', '-1', '--format=%ct']) || 0) * 1000
    if (!ct || now - ct > 2 * DAY) continue
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
  const prTicket = new Set(prs.map(ticketOf))
  const issueCard = (i, chips = []) => ({ id: '#' + i.number, title: i.title, url: i.url, since: i.updatedAt, chips })
  const prCard = (pr) => {
    const t = ticketOf(pr)
    const live = mine.filter((j) => '#' + j.issue === t && j.role !== 'build').map(jobChip)
    return { id: t, title: pr.title, url: pr.url, since: pr.createdAt, chips: [...checks(pr), ...live] }
  }

  const needs = [...issues.data.filter((i) => has(i, 'needs:garrett')).map((i) => issueCard(i, [{ text: 'Needs you', tone: 'bad' }])),
    ...prs.filter((pr) => has(pr, 'needs:garrett')).map(prCard)]
  const ready = issues.data.filter((i) => has(i, 'ready') && !has(i, 'needs:garrett')).sort((a, b) => a.number - b.number).map((i) => issueCard(i))
  const building = issues.data.filter((i) => has(i, 'building') && !has(i, 'needs:garrett') && !prTicket.has('#' + i.number))
    .map((i) => issueCard(i, mine.filter((j) => j.issue === i.number).map(jobChip)))
  const usesIssues = issues.data.some((i) => ['ready', 'building', 'in-review'].some((l) => has(i, l)))
  if (!usesIssues) building.push(...sliceWorktrees(p, new Set([...prs, ...merged.data].map((pr) => pr.headRefName)), now))
  const review = prs.filter((pr) => !has(pr, 'needs:garrett')).map(prCard)

  const done = merged.data.filter((pr) => pr.mergedAt).map((pr) => ({ ...pr, t: Date.parse(pr.mergedAt) }))
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const start = startOfToday - (DAYS - 1 - i) * DAY
    return { day: new Date(start).toISOString(), n: done.filter((pr) => pr.t >= start && pr.t < start + DAY).length }
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

function liveJobs(now) {
  const agents = run('claude', ['agents', '--json'])
  const claude = agents === null ? [] : parseClaudeAgents(agents, home, now)
  return [...claude, ...parseJobs(run('pgrep', ['-lf', '[a]k:']), { claude: agents === null })]
}

function write() {
  const now = Date.now()
  const jobs = liveJobs(now)
  const data = { generated: new Date(now).toISOString(), projects: projects().map((p) => collect(p, jobs, now)) }
  fs.mkdirSync(outDir, { recursive: true })
  const html = fs.readFileSync(path.join(kit, 'scripts/dashboard.html'), 'utf8')
    .replace('/*DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c'))
  const file = path.join(outDir, 'index.html')
  fs.writeFileSync(file + '.tmp', html)
  fs.renameSync(file + '.tmp', file)
  console.log(`${data.generated} wrote ${file}`)
}

function install() {
  const logs = path.join(home, 'Library/Logs/gcauc-dashboard.log')
  fs.mkdirSync(path.dirname(plist), { recursive: true })
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${fileURLToPath(import.meta.url)}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${home}/.local/bin</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logs}</string>
  <key>StandardErrorPath</key><string>${logs}</string>
</dict>
</plist>
`)
  const domain = `gui/${process.getuid()}`
  run('launchctl', ['bootout', `${domain}/${label}`])
  execFileSync('launchctl', ['bootstrap', domain, plist])
  console.log(`installed: ${plist} (log: ${logs}). Open ${path.join(outDir, 'index.html')}`)
}

function uninstall() {
  run('launchctl', ['bootout', `gui/${process.getuid()}/${label}`])
  fs.rmSync(plist, { force: true })
  console.log('uninstalled')
}

const cmd = process.argv[2] || 'write'
if (cmd === 'write') write()
else if (cmd === 'install') install()
else if (cmd === 'uninstall') uninstall()
else {
  console.error('usage: dashboard.mjs [write|install|uninstall]')
  process.exit(2)
}
