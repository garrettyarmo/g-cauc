// Pure helpers for the CI tab: parse what `gh` returns about Actions runs,
// jobs, runners and pull request checks, and summarize it per project.
// register.js makes the calls; nothing here touches the mods API.

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])
const secs = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null)

function json(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// `gh api repos/R/actions/runs`: the runs, newest first.
export function parseRuns(text) {
  const v = json(text)
  if (!v || !Array.isArray(v.workflow_runs)) return null
  return v.workflow_runs.map((r) => ({
    id: r.id,
    workflow: r.name || '',
    status: r.status || '',
    conclusion: r.conclusion || null,
    branch: r.head_branch || '',
    title: r.display_title || '',
    event: r.event || '',
    createdAt: r.created_at || null,
    startedAt: r.run_started_at || r.created_at || null,
    updatedAt: r.updated_at || null,
    url: r.html_url || '',
    prs: (r.pull_requests || []).map((p) => p.number),
  }))
}

// `gh api repos/R/actions/runs/ID/jobs`: one run's jobs, with their steps.
export function parseRunJobs(text, run) {
  const v = json(text)
  if (!v || !Array.isArray(v.jobs)) return null
  return v.jobs.map((j) => {
    const steps = (j.steps || []).map((s) => ({ name: s.name || '', status: s.status || '', conclusion: s.conclusion || null }))
    const current = steps.find((s) => s.status === 'in_progress')
    return {
      id: j.id,
      runId: run ? run.id : j.run_id,
      workflow: run ? run.workflow : j.workflow_name || '',
      branch: run ? run.branch : j.head_branch || '',
      prs: run ? run.prs : [],
      name: j.name || '',
      status: j.status || '',
      conclusion: j.conclusion || null,
      createdAt: j.created_at || null,
      startedAt: j.started_at || null,
      completedAt: j.completed_at || null,
      runner: j.runner_name || null,
      labels: j.labels || [],
      steps,
      step: current ? current.name : null,
      url: j.html_url || '',
    }
  })
}

// `gh api repos/R/actions/runners`: the pool's registrations for one repo.
export function parseRunners(text) {
  const v = json(text)
  if (!v || !Array.isArray(v.runners)) return null
  return v.runners.map((r) => ({
    name: r.name || '',
    status: r.status || '',
    busy: Boolean(r.busy),
    labels: (r.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    slot: Number(((r.name || '').match(/-(\d+)-\d+$/) || [])[1]) || null,
  }))
}

// runner/repos: "owner/repo slots" per line, # comments.
export function parseRepoSlots(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter((p) => /^[\w.-]+\/[\w.-]+$/.test(p[0]))
    .map((p) => ({ repo: p[0], slots: Number(p[1]) || 0 }))
}

// The lines scripts/done prints at the end:
// "done --fast: green in 127s" or "done --fast: 230s is over the 200s budget".
export function doneTimings(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    const green = line.match(/done --(fast|full): green in (\d+)s/)
    if (green) {
      out.push({ mode: green[1], seconds: Number(green[2]), green: true })
      continue
    }
    const over = line.match(/done --(fast|full): (\d+)s is over the (\d+)s budget/)
    if (over) out.push({ mode: over[1], seconds: Number(over[2]), green: false, budget: Number(over[3]) })
  }
  return out
}

// Budgets from a project's scripts/done defaults, such as ${CALLFLOW_FAST_BUDGET:-200}.
export function budgetsFromDone(text) {
  const t = String(text || '')
  const fast = t.match(/FAST_BUDGET:-(\d+)/)
  const full = t.match(/FULL_BUDGET:-(\d+)/)
  return { fast: fast ? Number(fast[1]) : null, full: full ? Number(full[1]) : null }
}

// A job GitHub never started: it failed with no steps, and an annotation says why.
export function refusalMessage(annotations) {
  for (const a of Array.isArray(annotations) ? annotations : []) {
    const m = String(a.message || '')
    if (a.annotation_level === 'failure' && /not started|spending limit|payments have failed|billing/i.test(m)) {
      return /spending limit|payments have failed|billing/i.test(m) ? 'GitHub refused jobs at the spending limit' : m.slice(0, 120)
    }
  }
  return null
}

// The latest state of each named check on a PR's head commit.
export function latestChecks(rollup) {
  const out = {}
  const at = (c) => Date.parse(c.completedAt || c.startedAt || '') || 0
  const seen = {}
  ;(Array.isArray(rollup) ? rollup : []).forEach((c, i) => {
    const name = c.name || c.context
    if (!name) return
    const when = at(c) || i
    if (seen[name] !== undefined && seen[name] > when) return
    seen[name] = when
    let state
    if (c.__typename === 'StatusContext' || c.state) {
      state = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'running', EXPECTED: 'running' }[c.state] || 'running'
    } else if (c.status && c.status !== 'COMPLETED') {
      state = 'running'
    } else {
      state = { SUCCESS: 'pass', NEUTRAL: 'pass', SKIPPED: 'skip' }[c.conclusion] || 'fail'
    }
    out[name] = state
  })
  return out
}

const KEY_CHECKS = ['done', 'agent-review', 'guard']

// Everything the CI tab shows for one project.
export function summarizeCi({ runs, jobs, runners, slots, prs, facts, budgets, now }) {
  const pool = (runners || []).filter((r) => r.labels.includes('gcauc'))
  const idle = pool.filter((r) => r.status === 'online' && !r.busy)
  const poolLabels = [...new Set(pool.flatMap((r) => r.labels))]
  const live = (jobs || []).filter((j) => ACTIVE.has(j.status))
  const running = live
    .filter((j) => j.status === 'in_progress')
    .map((j) => {
      const r = pool.find((x) => x.name === j.runner)
      return { ...j, slot: r ? r.slot : null, hosted: !r, elapsed: secs(j.startedAt, new Date(now).toISOString()) }
    })
  const queued = live
    .filter((j) => j.status !== 'in_progress')
    .map((j) => {
      const wait = secs(j.createdAt, new Date(now).toISOString()) || 0
      return { ...j, wait, stuck: wait > 120 && idle.length > 0 }
    })
  const completed = (runs || []).filter((r) => r.status === 'completed').slice(0, 20)
  const recent = completed.map((r) => ({ id: r.id, conclusion: r.conclusion, seconds: secs(r.startedAt, r.updatedAt), title: r.title, workflow: r.workflow }))
  const timings = { fast: [], full: [], budgets: budgets || { fast: null, full: null } }
  let refusedRuns = 0
  let refusedMessage = null
  for (const r of completed) {
    const f = (facts || {})[r.id]
    if (!f) continue
    if (f.fast) timings.fast.push(f.fast.seconds)
    if (f.full) timings.full.push(f.full.seconds)
    if (f.refused) {
      refusedRuns += 1
      refusedMessage = refusedMessage || f.refused
    }
  }
  const prRows = (prs || []).map((p) => {
    const checks = latestChecks(p.statusCheckRollup)
    const shown = {}
    for (const k of KEY_CHECKS) if (checks[k]) shown[k] = checks[k]
    for (const [k, v] of Object.entries(checks)) if (v === 'fail' && !shown[k]) shown[k] = v
    return { number: p.number, title: p.title || '', url: p.url || '', behind: p.mergeStateStatus === 'BEHIND', checks: shown }
  })
  return {
    pool: { configured: slots ?? null, online: pool.filter((r) => r.status === 'online').length, busy: pool.filter((r) => r.busy).length, idle: idle.length, labels: poolLabels, runners: pool },
    running,
    queued,
    stuck: queued.filter((j) => j.stuck).length,
    recent,
    timings,
    refusal: refusedRuns ? { runs: refusedRuns, message: refusedMessage } : null,
    prs: prRows,
  }
}

// The CI part of the quiet line, and whether it needs attention.
export function ciBand(projects) {
  const all = (projects || []).filter((p) => p.ci)
  if (all.length === 0) return null
  const running = all.reduce((a, p) => a + p.ci.running.length, 0)
  const queued = all.reduce((a, p) => a + p.ci.queued.length, 0)
  const busy = all.reduce((a, p) => a + p.ci.pool.busy, 0)
  const total = all.reduce((a, p) => a + (p.ci.pool.configured ?? p.ci.pool.runners.length), 0)
  const stuck = all.reduce((a, p) => a + p.ci.stuck, 0)
  const refused = all.some((p) => p.ci.refusal)
  if (!running && !queued && !stuck && !refused) return null
  const parts = [`CI ${running} running`]
  if (queued) parts.push(`${queued} queued`)
  if (total) parts.push(`pool ${busy}/${total}`)
  const alert = stuck ? `${stuck} stuck` : refused ? 'refused by GitHub' : ''
  return { text: parts.join(' · '), alert }
}
