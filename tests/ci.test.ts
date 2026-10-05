import { expect, test } from 'claude-code/testing'
import { parseRuns, parseRunJobs, parseRunners, parseRepoSlots, doneTimings, budgetsFromDone, refusalMessage, latestChecks, summarizeCi, ciBand, slotStates, vmName } from '../hooks/ci.js'

test('done timing lines: green and over budget', async () => {
  const t = doneTimings('x\ndone --fast: green in 127s\n\ndone --full: 1620s is over the 1500s budget\nnoise')
  expect(t).toEqual([
    { mode: 'fast', seconds: 127, green: true },
    { mode: 'full', seconds: 1620, green: false, budget: 1500 },
  ])
  expect(budgetsFromDone('budget="${CALLFLOW_FULL_BUDGET:-1500}"\nbudget="${CALLFLOW_FAST_BUDGET:-200}"')).toEqual({ fast: 200, full: 1500 })
  expect(budgetsFromDone('')).toEqual({ fast: null, full: null })
})

test('runner pool config skips comments and bad lines', async () => {
  expect(parseRepoSlots('# repos\ngarrettyarmo/callflow 3\n\nnot a repo 2\ngarrettyarmo/myqap 2 # later\n')).toEqual([
    { repo: 'garrettyarmo/callflow', slots: 3 },
    { repo: 'garrettyarmo/myqap', slots: 2 },
  ])
})

test('a refusal is a failure annotation about starting or billing; other annotations are not', async () => {
  expect(refusalMessage([{ annotation_level: 'notice', message: 'The ubuntu-latest label will migrate' }])).toBe(null)
  expect(refusalMessage([{ annotation_level: 'failure', message: 'The job was not started because your spending limit needs to be increased.' }])).toBe('GitHub refused jobs at the spending limit')
  expect(refusalMessage([{ annotation_level: 'failure', message: 'The job was not started because the runner group is disabled.' }])).toBe('The job was not started because the runner group is disabled.')
  expect(refusalMessage(null)).toBe(null)
})

test('the latest run of each check wins, and status contexts count', async () => {
  const c = latestChecks([
    { __typename: 'CheckRun', name: 'guard', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-10-04T10:00:00Z' },
    { __typename: 'CheckRun', name: 'guard', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: '2026-10-04T11:00:00Z' },
    { __typename: 'CheckRun', name: 'deploy-staging', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'agent-review', state: 'SUCCESS' },
  ])
  expect(c).toEqual({ guard: 'fail', 'deploy-staging': 'skip', 'agent-review': 'pass' })
})

test('bad gh output parses to null instead of an empty board', async () => {
  expect(parseRuns('{"message":"Bad credentials"}')).toBe(null)
  expect(parseRunJobs('', null)).toBe(null)
  expect(parseRunners('not json')).toBe(null)
})

test('a quiet CI says nothing on the quiet line; a stuck job is only stuck with an idle slot', async () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  const runner = (name, busy) => ({ name, status: 'online', busy, labels: ['gcauc', 'self-hosted'], slot: 1 })
  const queued = { id: 1, name: 'done', status: 'queued', createdAt: '2026-10-04T11:55:00Z', labels: ['gcauc'], prs: [52], branch: 'b', steps: [] }
  const busyPool = summarizeCi({ runs: [], jobs: [queued], runners: [runner('a-1-1', true)], slots: 1, prs: [], facts: {}, budgets: null, now })
  expect(busyPool.stuck).toBe(0)
  const idlePool = summarizeCi({ runs: [], jobs: [queued], runners: [runner('a-1-1', false)], slots: 1, prs: [], facts: {}, budgets: null, now })
  expect(idlePool.stuck).toBe(1)
  const quiet = summarizeCi({ runs: [], jobs: [], runners: [runner('a-1-1', false)], slots: 1, prs: [], facts: {}, budgets: null, now })
  expect(ciBand([{ ci: quiet }])).toBe(null)
  expect(ciBand([{ ci: idlePool }])).toEqual({ text: 'CI 0 running · 1 queued · pool 0/1', alert: '1 stuck' })
})

test('review fixes: an unfinished re-run is running, waiting jobs are never stuck, labels are always a list, git decides behind', async () => {
  const queuedRerun = { __typename: 'CheckRun', name: 'done', status: 'QUEUED', conclusion: null, startedAt: null, completedAt: null }
  const oldFail = { __typename: 'CheckRun', name: 'done', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: '2026-10-04T10:00:00Z' }
  expect(latestChecks([oldFail, queuedRerun])).toEqual({ done: 'running' })
  expect(latestChecks([queuedRerun, oldFail])).toEqual({ done: 'running' })
  const now = Date.parse('2026-10-04T12:00:00Z')
  const idle = [{ name: 'a-1-1', status: 'online', busy: false, labels: ['gcauc'], slot: 1 }]
  const waiting = { id: 2, name: 'deploy', status: 'waiting', createdAt: '2026-10-04T11:50:00Z', labels: ['gcauc'], prs: [], branch: 'main', steps: [] }
  const pending = { ...waiting, id: 3, status: 'pending' }
  expect(summarizeCi({ runs: [], jobs: [waiting, pending], runners: idle, slots: 1, prs: [], facts: {}, budgets: null, now }).stuck).toBe(0)
  const jobs = parseRunJobs(JSON.stringify({ jobs: [{ id: 1, name: 'done', status: 'queued', created_at: '2026-10-04T11:50:00Z', labels: 'gcauc', steps: [] }] }), null)
  expect(jobs[0].labels).toEqual(['gcauc'])
  const pr = { number: 7, title: 't', url: 'u', mergeStateStatus: 'BLOCKED', statusCheckRollup: [] }
  expect(summarizeCi({ runs: [], jobs: [], runners: [], slots: 0, prs: [pr], facts: {}, budgets: null, now, behind: { 7: true } }).prs[0].behind).toBe(true)
  expect(summarizeCi({ runs: [], jobs: [], runners: [], slots: 0, prs: [pr], facts: {}, budgets: null, now }).prs[0].behind).toBe(false)
})

test('the pool counts slots, not registrations: two runners on one slot are one busy slot', async () => {
  const reg = (name, slot, busy, status = 'online') => ({ name, status, busy, labels: ['gcauc'], slot })
  const runners = [reg('m-callflow-1-1', 1, true), reg('m-callflow-1-2', 1, false), reg('m-callflow-2-1', 2, false), reg('m-callflow-4-1', 4, true)]
  expect(slotStates(runners, 3)).toEqual(['busy', 'idle', 'offline', 'busy'])
  const c = summarizeCi({ runs: [], jobs: [{ id: 1, name: 'done', status: 'in_progress', startedAt: '2026-10-04T11:59:00Z', runner: 'm-callflow-1-1', labels: [], prs: [1], branch: 'b', steps: [] }], runners, slots: 3, prs: [], facts: {}, budgets: null, now: Date.parse('2026-10-04T12:00:00Z') })
  expect(c.pool).toMatchObject({ busy: 2, idle: 1, offline: 1 })
  expect(ciBand([{ ci: c }]).text).toBe('CI 1 running · pool 2/4')
})

test('review round 1: stuck reads slots, not registrations, and every runner shows up', async () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  const queued = { id: 1, name: 'done', status: 'queued', createdAt: '2026-10-04T11:55:00Z', labels: ['gcauc'], prs: [1], branch: 'b', steps: [] }
  const reg = (name, slot, busy, status = 'online') => ({ name, status, busy, labels: ['gcauc'], slot })
  const ci = (runners, slots) => summarizeCi({ runs: [], jobs: [queued], runners, slots, prs: [], facts: {}, budgets: null, now })
  // The only slot is busy, though one of its two registrations is idle
  const oneSlot = ci([reg('m-1-1', 1, true), reg('m-1-2', 1, false)], 1)
  expect(oneSlot.pool).toMatchObject({ slots: ['busy'], idle: 0 })
  expect(oneSlot.stuck).toBe(0)
  // An idle runner past the configured count, or with no slot number, is an idle slot the board shows
  expect(ci([reg('m-1-1', 1, true), reg('m-4-1', 4, false)], 3).pool.slots).toEqual(['busy', 'offline', 'offline', 'idle'])
  expect(ci([reg('plain', null, false)], 3).pool.slots).toEqual(['offline', 'offline', 'offline', 'idle'])
  expect(ci([reg('plain', null, false)], 3).stuck).toBe(1)
  // A configured count of 0 still shows the runners that exist
  expect(ci([reg('m-callflow-1-9', 1, true)], 0).pool.slots).toEqual(['busy'])
  expect(ci([reg('m-1-1', 1, false)], 0).stuck).toBe(1)
  expect(ci([], 0).pool.slots).toEqual([])
})

test('a repo VM is named as runner/gcauc-runner names it, and runner/repos may carry CPUs and memory', async () => {
  expect(['garrettyarmo/callflow', 'garrettyarmo/My_Repo.v2', 'nessy'].map(vmName)).toEqual(['gcauc-callflow', 'gcauc-my-repo-v2', 'gcauc-nessy'])
  expect(parseRepoSlots('garrettyarmo/callflow 2 12 12\ngarrettyarmo/nessy 1 # quiet\n')).toEqual([
    { repo: 'garrettyarmo/callflow', slots: 2 },
    { repo: 'garrettyarmo/nessy', slots: 1 },
  ])
})
