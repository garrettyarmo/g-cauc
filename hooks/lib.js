// Pure helpers for the g-cauc mod: parsing and summarizing only, no mods API.
// register.js gathers the raw text (gh output, files, process lists) and these
// functions turn it into what the board and the band show.

// Rows of the first markdown table whose header row starts with `firstHeader`.
export function tableRows(md, firstHeader) {
  const lines = String(md || '').split('\n')
  const rows = []
  let inTable = false
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('|')) {
      if (inTable) break
      continue
    }
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (!inTable) {
      if (cells[0].toLowerCase() === firstHeader.toLowerCase()) inTable = true
      continue
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    rows.push(cells)
  }
  return rows
}

const strip = (s) => String(s || '').replace(/`/g, '').trim()
const expandHome = (p, home) => strip(p).replace(/^~(?=\/|$)/, home)

// projects.md: | Priority | Project | Path | Repo | Notes |
export function parseProjects(md, home) {
  return tableRows(md, 'Priority')
    .map((c) => ({ priority: Number(c[0]) || 99, name: strip(c[1]), path: expandHome(c[2], home), repo: strip(c[3]) }))
    .filter((p) => p.name && p.path && p.repo)
    .sort((a, b) => a.priority - b.priority)
}

// lanes.md: | Lane | Family | Subscription | Weight | Max jobs | Status |
export function parseLanes(md) {
  return tableRows(md, 'Lane').map((c) => ({
    lane: strip(c[0]),
    family: strip(c[1]),
    weight: strip(c[3]),
    max: Number(strip(c[4])) || 0,
    status: strip(c[5]).split(':')[0].split(';')[0],
  }))
}

// ROADMAP.md: "## Phase N: Title" headings, each with an "Exit:" paragraph.
export function parseRoadmap(md) {
  const phases = []
  let cur = null
  let inExit = false
  for (const line of String(md || '').split('\n')) {
    const h = line.match(/^##\s+Phase\s+(\d+)\s*[:.]\s*(.+?)\s*$/i)
    if (h) {
      cur = { n: Number(h[1]), title: h[2].replace(/\s*\(.*\)\s*$/, ''), exit: '' }
      phases.push(cur)
      inExit = false
      continue
    }
    if (/^##\s/.test(line)) {
      cur = null
      continue
    }
    if (!cur) continue
    const ex = line.match(/^Exit:\s*(.*)$/)
    if (ex) {
      inExit = true
      cur.exit = ex[1].trim()
      continue
    }
    if (inExit && !cur.exit && line.trim()) cur.exit = line.replace(/^[-*]\s*/, '').trim()
  }
  return phases
}

// The phase a spec belongs to: a "Phase: N" line near its top, else a phase
// whose title shares a word run with the spec's file name.
export function specPhase(specFile, specText, phases) {
  const head = String(specText || '').split('\n').slice(0, 15).join('\n')
  const m = head.match(/Phase[:\s]+(\d+)/i)
  if (m) return Number(m[1])
  const slug = String(specFile).replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ').toLowerCase()
  const hit = phases.find((p) => slug && (p.title.toLowerCase().includes(slug) || slug.includes(p.title.toLowerCase())))
  return hit ? hit.n : null
}

// gh output as an array, or null when the call failed or answered something else.
export function asArray(json) {
  if (typeof json !== 'string' || !json.trim()) return null
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

// Text from logs, made safe to draw: no ANSI escapes, no control characters
// other than tab and newline, and no more than `max` characters.
export function sanitize(text, max = 9000) {
  const t = String(text || '').replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
  return t.length > max ? '…' + t.slice(-(max - 1)) : t
}

export const labelsOf = (issue) => (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name))

// "Spec 002 row 7: ..." in the title, or "Spec: specs/002-name.md" in the body.
export function issueSpec(issue) {
  const t = String(issue.title || '').match(/Spec\s+(\d{3})\b/i)
  if (t) return t[1]
  const b = String(issue.body || '').match(/specs\/(\d{3})[-\w]*\.md/)
  return b ? b[1] : null
}

// Issue numbers this issue waits on: "Blocked by #12" lines, or #refs in the
// build plan row's "Blocked by" column.
export function blockers(body) {
  const text = String(body || '')
  const found = new Set()
  for (const m of text.matchAll(/Blocked by[^\n#]*((?:#\d+[\s,and]*)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) found.add(Number(n[1]))
  }
  const lines = text.split('\n')
  const hi = lines.findIndex((l) => /\|\s*Blocked by\s*\|/i.test(l))
  if (hi >= 0) {
    const col = lines[hi].split('|').map((c) => c.trim().toLowerCase()).indexOf('blocked by')
    for (const row of lines.slice(hi + 2)) {
      if (!row.trim().startsWith('|')) break
      const cell = row.split('|')[col] || ''
      for (const n of cell.matchAll(/#(\d+)/g)) found.add(Number(n[1]))
    }
  }
  return [...found]
}

// Everything the Plan tab and the band need for one project.
export function summarizeProject({ issues, openPrs, mergedPrs, roadmap, specs, autonomy }) {
  const phases = parseRoadmap(roadmap)
  const byNumber = new Map(issues.map((i) => [i.number, i]))
  const isOpen = (n) => {
    const i = byNumber.get(n)
    return i ? i.state === 'OPEN' : false
  }
  const specOf = new Map()
  for (const s of specs) specOf.set(s.num, { ...s, phase: specPhase(s.file, s.text, phases) })

  const build = issues.filter((i) => issueSpec(i) && !labelsOf(i).includes('idea') && !labelsOf(i).includes('spec'))
  const perSpec = new Map()
  for (const i of build) {
    const num = issueSpec(i)
    const p = perSpec.get(num) || { num, done: 0, total: 0 }
    p.total += 1
    if (i.state === 'CLOSED') p.done += 1
    perSpec.set(num, p)
  }
  const specRows = [...perSpec.values()]
    .map((p) => ({ ...p, title: (specOf.get(p.num) || {}).title || 'Spec ' + p.num, phase: (specOf.get(p.num) || {}).phase ?? null }))
    .sort((a, b) => a.num.localeCompare(b.num))

  const openSpecs = specRows.filter((s) => s.done < s.total)
  const phaseNums = openSpecs.map((s) => s.phase).filter((n) => n !== null)
  const currentN = phaseNums.length ? Math.min(...phaseNums) : null
  const current = currentN !== null ? phases.find((p) => p.n === currentN) || null : null
  const inPhase = current ? specRows.filter((s) => s.phase === current.n) : openSpecs
  const phaseDone = inPhase.reduce((a, s) => a + s.done, 0)
  const phaseTotal = inPhase.reduce((a, s) => a + s.total, 0)

  const open = issues.filter((i) => i.state === 'OPEN')
  const has = (i, l) => labelsOf(i).includes(l)
  const ready = open
    .filter((i) => has(i, 'ready'))
    .map((i) => ({ ...i, waitingOn: blockers(i.body).filter(isOpen) }))
    .sort((a, b) => a.waitingOn.length - b.waitingOn.length || a.number - b.number)
  const needs = [
    ...open.filter((i) => has(i, 'needs:garrett')).map((i) => ({ kind: 'issue', number: i.number, title: i.title, url: i.url })),
    ...openPrs.filter((p) => labelsOf(p).includes('agreed')).map((p) => ({ kind: 'spec', number: p.number, title: p.title, url: p.url })),
  ]
  return {
    autonomy,
    phase: current ? { n: current.n, title: current.title, exit: current.exit, done: phaseDone, total: phaseTotal } : null,
    specs: openSpecs,
    building: open.filter((i) => has(i, 'building')),
    inReview: open.filter((i) => has(i, 'in-review')),
    ready,
    needs,
    ideas: open.filter((i) => has(i, 'idea')).length,
    merged: mergedPrs.slice(0, 4),
  }
}

// `pgrep -lf ak:` output: keep the agent CLIs, drop the shells that launched them.
export function parseJobs(out, { claude = false } = {}) {
  const jobs = []
  for (const line of String(out || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/)
    if (!m) continue
    const cmd = m[2]
    const argv0 = cmd.split(/\s+/)[0]
    const base = argv0.split('/').pop()
    // Claude workers are listed by `claude agents --json` (parseClaudeAgents), so skip them here.
    if (!['cursor-agent', 'codex', ...(claude ? ['claude'] : [])].includes(base)) continue
    const mk = cmd.match(/\[ak:([\w.-]+)#(\d+):([\w-]+):(\d+)\]/)
    if (!mk) continue
    const model = (cmd.match(/(?:--model|\s-m)\s+(\S+)/) || [])[1] || ''
    jobs.push({ pid: Number(m[1]), cli: base, model, project: mk[1], issue: Number(mk[2]), role: mk[3], round: Number(mk[4]) })
  }
  return jobs
}

// `claude agents --json`: background sessions the foreman named ak-<project>-<issue>-<role>.
export function parseClaudeAgents(json, home, now) {
  let list = []
  try {
    list = JSON.parse(json || '[]')
  } catch {
    return []
  }
  const out = []
  for (const a of Array.isArray(list) ? list : []) {
    const m = String(a.name || '').match(/^ak-([\w.]+)-(\d+)-([\w-]+)$/)
    if (!m || !a.sessionId || !a.cwd) continue
    out.push({
      pid: a.pid || 0,
      cli: 'claude',
      model: 'opus',
      project: m[1],
      issue: Number(m[2]),
      role: m[3],
      round: 0,
      elapsed: a.startedAt ? Math.max(0, (now - a.startedAt) / 1000) : 0,
      log: `${home}/.claude/projects/${String(a.cwd).replace(/[^A-Za-z0-9]/g, '-')}/${a.sessionId}.jsonl`,
      status: a.status || '',
    })
  }
  return out
}

export function laneOf(cli, model) {
  if (cli === 'claude') return 'claude'
  if (cli === 'codex') return 'codex'
  const m = String(model).toLowerCase()
  if (m.startsWith('composer')) return 'composer'
  if (m.includes('grok')) return 'grok'
  if (m.startsWith('gemini')) return 'gemini'
  return 'cursor'
}

// Friendly model names for the rows.
export function modelName(model) {
  const m = String(model).toLowerCase()
  if (!m) return ''
  if (m.startsWith('composer')) return 'Composer ' + (m.match(/composer-([\d.]+)/) || [])[1]
  const g = m.match(/grok-([\d.]+)-?(\w+)?/)
  if (g) return 'Grok ' + g[1] + (g[2] && !/fast/.test(g[2]) ? ' ' + g[2] : '')
  if (m.startsWith('gemini')) return 'Gemini ' + (m.match(/gemini-([\d.]+)/) || [])[1]
  if (m.startsWith('gpt')) return m.replace(/^gpt-/, 'GPT-').replace(/-(high|xhigh|low|medium)$/, ' $1')
  if (m.includes('opus')) return 'Opus'
  if (m.includes('sonnet')) return 'Sonnet'
  return model
}

// ps etime "[[dd-]hh:]mm:ss" to seconds.
export function parseEtime(s) {
  const t = String(s || '').trim()
  if (!t) return 0
  const [d, rest] = t.includes('-') ? t.split('-') : ['0', t]
  const parts = rest.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  return Number(d) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]
}

export function fmtDuration(sec) {
  if (sec < 60) return Math.max(0, Math.round(sec)) + 's'
  if (sec < 3600) return Math.round(sec / 60) + 'm'
  const h = Math.floor(sec / 3600)
  return h + 'h' + String(Math.round((sec % 3600) / 60)).padStart(2, '0')
}

// `lsof -Fpn -a -d 1 -p ...`: where each process sends its standard output.
export function parseLsof(out) {
  const map = new Map()
  let pid = null
  for (const line of String(out || '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) map.set(pid, line.slice(1))
  }
  return map
}

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+$/, '')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// One job log, as a list of steps. Understands Cursor's stream-json, Codex's
// --json events, and falls back to the plain text tail for anything else.
export function parseLog(text) {
  const lines = String(text || '').split('\n').filter((l) => l.trim())
  const jsonish = lines.filter((l) => l.trim().startsWith('{')).length
  if (lines.length === 0) return { format: 'empty', steps: [] }
  if (jsonish < lines.length / 2) {
    return { format: 'text', steps: [{ kind: 'text', text: sanitize(lines.slice(-120).join('\n'), 9000) }] }
  }
  const steps = []
  let thinking = null
  const flushThinking = () => {
    if (thinking && thinking.text.trim()) steps.push(thinking)
    thinking = null
  }
  for (const line of lines) {
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    // Cursor stream-json
    if (ev.type === 'thinking') {
      if (ev.subtype === 'delta') {
        if (!thinking) thinking = { kind: 'thinking', text: '' }
        thinking.text += ev.text || ''
      } else flushThinking()
      continue
    }
    if (ev.type === 'assistant' && ev.message) {
      flushThinking()
      // Cursor sends text only; a Claude transcript also carries thinking and tool calls.
      for (const c of ev.message.content || []) {
        if (c.type === 'thinking' && String(c.thinking || '').trim()) steps.push({ kind: 'thinking', text: c.thinking })
        else if (c.type === 'text' && String(c.text || '').trim()) steps.push({ kind: 'say', text: c.text })
        else if (c.type === 'tool_use') {
          const inp = c.input || {}
          if (c.name === 'Bash') steps.push({ kind: 'cmd', text: clip(inp.command, 140), exit: null, ms: null, out: '' })
          else steps.push({ kind: 'tool', text: c.name + (inp.file_path || inp.pattern || inp.description ? ' ' + clip(inp.file_path || inp.pattern || inp.description, 100) : '') })
        }
      }
      continue
    }
    if (ev.type === 'tool_call' && ev.subtype === 'completed' && ev.tool_call) {
      flushThinking()
      const [name, call] = Object.entries(ev.tool_call)[0] || []
      const args = (call && call.args) || {}
      const ok = (call && call.result && call.result.success) || {}
      if (name === 'shellToolCall') {
        steps.push({ kind: 'cmd', text: clip(args.command, 140), exit: ok.exitCode ?? null, ms: ok.executionTime ?? null, out: clip(ok.stdout || ok.stderr || '', 600) })
      } else {
        const target = args.path || args.filePath || args.pattern || args.query || ''
        steps.push({ kind: 'tool', text: String(name || 'tool').replace(/ToolCall$/, '') + (target ? ' ' + clip(target, 100) : '') })
      }
      continue
    }
    if (ev.type === 'result') {
      flushThinking()
      steps.push({ kind: 'result', text: ev.is_error ? 'failed' : 'finished', ms: ev.duration_ms ?? null })
      continue
    }
    // Codex exec --json
    if (/^item\.(completed|updated)$/.test(ev.type || '') && ev.item) {
      if (ev.type === 'item.updated') continue
      flushThinking()
      const it = ev.item
      if (it.type === 'reasoning') steps.push({ kind: 'thinking', text: it.text || it.summary || '' })
      else if (it.type === 'agent_message') steps.push({ kind: 'say', text: it.text || '' })
      else if (it.type === 'command_execution') steps.push({ kind: 'cmd', text: clip(it.command, 140), exit: it.exit_code ?? null, ms: null, out: clip(it.aggregated_output || '', 600) })
      else if (it.type === 'file_change') steps.push({ kind: 'tool', text: 'edit ' + (it.changes || []).map((c) => c.path).join(', ') })
      else steps.push({ kind: 'tool', text: it.type })
      continue
    }
    if (ev.type === 'turn.completed') {
      flushThinking()
      steps.push({ kind: 'result', text: 'finished', ms: null })
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') {
      flushThinking()
      steps.push({ kind: 'result', text: 'failed: ' + clip((ev.error && ev.error.message) || ev.message || '', 200), ms: null })
    }
  }
  flushThinking()
  return { format: 'json', steps: steps.map((st) => ({ ...st, text: sanitize(st.text, 9000), out: st.out ? sanitize(st.out, 600) : st.out })) }
}

export function bar(done, total, width = 10) {
  if (!total) return '░'.repeat(width)
  const full = Math.max(0, Math.min(width, Math.round((done / total) * width)))
  return '█'.repeat(full) + '░'.repeat(width - full)
}

// The one dim line above the prompt, or null when there is nothing to say.
export function bandText(projects, jobs) {
  const running = jobs.length
  const needs = projects.reduce((a, p) => a + p.summary.needs.length, 0)
  if (running === 0 && needs === 0) return null
  const lead = projects.find((p) => p.summary.phase) || projects[0]
  const parts = ['g-cauc']
  if (lead && lead.summary.phase) parts.push(`${lead.name} ${lead.summary.phase.done}/${lead.summary.phase.total}`)
  if (running) parts.push(`${running} running`)
  if (needs) parts.push(`${needs} need${needs === 1 ? 's' : ''} you`)
  return parts.join(' · ')
}

// Permission advisor: the rule strings in a PermissionRequest's own
// "don't ask again" suggestions, such as "Bash(gh pr view:*)".
export function suggestedRules(suggestions) {
  const out = []
  for (const s of suggestions || []) {
    if (!s || s.type !== 'addRules' || s.behavior !== 'allow') continue
    for (const r of s.rules || []) out.push(r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)
  }
  return [...new Set(out)]
}

// Add rules to a settings object's permissions.allow, keeping everything else.
// Returns null when the file's shape is not one this can safely extend.
export function withAllowed(settings, rules) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (settings !== undefined && settings !== null && !isObj(settings)) return null
  const s = settings ? JSON.parse(JSON.stringify(settings)) : {}
  if (s.permissions !== undefined && !isObj(s.permissions)) return null
  s.permissions = s.permissions || {}
  if (s.permissions.allow !== undefined && !Array.isArray(s.permissions.allow)) return null
  const allow = Array.isArray(s.permissions.allow) ? s.permissions.allow : []
  for (const r of rules) if (!allow.includes(r)) allow.push(r)
  s.permissions.allow = allow
  return s
}
