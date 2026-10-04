// Drawing helpers for the board. On the Desktop app they draw small SVGs
// (rounded bars, pills, slot squares, result dots) in mid-tone colors that
// read on light and dark themes alike; in a terminal the same calls draw
// colored text. Each takes the element table from $.ui.resolve(e) and the
// surface name; none touches the mods API.

const TONES = {
  accent: { hex: '#3B82F6', ink: '#FFFFFF', term: 'blue' },
  good: { hex: '#22A06B', ink: '#FFFFFF', term: 'green' },
  warn: { hex: '#E0A21A', ink: '#2B1D00', term: 'yellow' },
  bad: { hex: '#E5484D', ink: '#FFFFFF', term: 'red' },
  purple: { hex: '#8B5CF6', ink: '#FFFFFF', term: 'magenta' },
  muted: { hex: '#8A8F98', ink: '#FFFFFF', term: 'gray' },
}
const TRACK = 'rgba(127,127,127,0.24)'
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

const tone = (name) => TONES[name] || TONES.muted
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isDesktop = (surface) => surface === 'desktop'

// Text in a tone: a hex on the Desktop app, a named color in a terminal.
export function colored(E, surface, name, text, extra = {}) {
  const t = tone(name)
  return E.Text({ ...extra, color: isDesktop(surface) ? t.hex : t.term, children: [text] })
}

// A progress bar. Desktop: a rounded SVG bar. Terminal: heavy line characters.
export function progress(E, surface, done, total, { width = 160, cells = 12, color = 'accent' } = {}) {
  const frac = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  if (isDesktop(surface) && E.Svg) {
    const w = Math.round(width)
    const fill = Math.round(w * frac)
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="8" viewBox="0 0 ${w} 8"><rect width="${w}" height="8" rx="4" fill="${TRACK}"/>${fill > 0 ? `<rect width="${Math.max(fill, 8)}" height="8" rx="4" fill="${tone(color).hex}"/>` : ''}</svg>`
    return E.Svg({ source, alt: `${done} of ${total}`, width: w, height: 8 })
  }
  const full = Math.round(cells * frac)
  return E.Box({
    flexDirection: 'row',
    children: [
      E.Text({ color: tone(color).term, children: ['━'.repeat(full)] }),
      E.Text({ dimColor: true, children: ['━'.repeat(cells - full)] }),
    ],
  })
}

// A status pill. Desktop: a rounded filled label. Terminal: a colored dot and word.
export function pill(E, surface, label, name = 'muted') {
  const t = tone(name)
  if (isDesktop(surface) && E.Svg) {
    const w = Math.round(String(label).length * 6.3 + 16)
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18" viewBox="0 0 ${w} 18"><rect width="${w}" height="18" rx="9" fill="${t.hex}"/><text x="${w / 2}" y="12.5" text-anchor="middle" font-family="${esc(FONT)}" font-size="11" font-weight="600" fill="${t.ink}">${esc(label)}</text></svg>`
    return E.Svg({ source, alt: String(label), width: w, height: 18 })
  }
  return E.Box({ flexShrink: 0, children: [E.Text({ color: t.term, children: [`● ${label}`] })] })
}

// Pool slots as squares: busy filled, idle outlined, offline dimmed.
export function slots(E, surface, list) {
  if (isDesktop(surface) && E.Svg) {
    const n = Math.max(list.length, 1)
    const w = n * 18
    const cells = list
      .map((s, i) => {
        const x = i * 18 + 1
        if (s === 'busy') return `<rect x="${x}" y="1" width="14" height="14" rx="4" fill="${TONES.accent.hex}"/>`
        if (s === 'idle') return `<rect x="${x + 0.75}" y="1.75" width="12.5" height="12.5" rx="3.5" fill="none" stroke="${TONES.good.hex}" stroke-width="1.5"/>`
        return `<rect x="${x}" y="1" width="14" height="14" rx="4" fill="${TRACK}"/>`
      })
      .join('')
    return E.Svg({ source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="16" viewBox="0 0 ${w} 16">${cells}</svg>`, alt: `${list.filter((s) => s === 'busy').length} busy of ${list.length} slots`, width: w, height: 16 })
  }
  return E.Box({
    flexDirection: 'row',
    children: list.map((s) => E.Text({ color: s === 'busy' ? 'blue' : s === 'idle' ? 'green' : 'gray', children: [s === 'busy' ? '■ ' : '□ '] })),
  })
}

// Recent results, oldest to newest, as dots colored by conclusion.
export function dots(E, surface, results) {
  const toneOf = (c) => (c === 'success' ? 'good' : c === 'failure' || c === 'timed_out' || c === 'startup_failure' ? 'bad' : c === 'cancelled' ? 'muted' : 'warn')
  if (isDesktop(surface) && E.Svg) {
    const w = Math.max(results.length, 1) * 11
    const marks = results.map((c, i) => `<circle cx="${i * 11 + 5}" cy="6" r="4" fill="${tone(toneOf(c)).hex}"/>`).join('')
    return E.Svg({ source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="12" viewBox="0 0 ${w} 12">${marks}</svg>`, alt: `${results.filter((c) => c === 'success').length} of ${results.length} recent runs passed`, width: w, height: 12 })
  }
  return E.Box({ flexDirection: 'row', children: results.map((c) => E.Text({ color: tone(toneOf(c)).term, children: ['●'] })) })
}

// The tone for a time against its budget: green under 70 percent, amber under 90, red after.
export function budgetTone(seconds, budget) {
  if (!budget) return 'accent'
  const r = seconds / budget
  return r < 0.7 ? 'good' : r < 0.9 ? 'warn' : 'bad'
}
