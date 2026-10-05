// Drawing helpers for the board. On the Desktop app they draw small SVGs
// (badges, rings, pipeline strips, bars, pills, cells, result dots); in a
// terminal the same calls draw colored text. Every color here comes from
// BRAND.md: status tones for state, and each project's own color (from
// projects.md) for which project a thing belongs to. Each helper takes the
// element table from $.ui.resolve(e) and the surface name; none touches the
// mods API.

import { sanitize } from './lib.js'

const TONES = {
  good: { hex: '#22A06B', ink: '#FFFFFF', term: 'green' },
  warn: { hex: '#E0A21A', ink: '#111111', term: 'yellow' },
  bad: { hex: '#E5484D', ink: '#FFFFFF', term: 'red' },
  muted: { hex: '#8A8F98', ink: '#FFFFFF', term: 'gray' },
}
// Project colors when projects.md gives none, in priority order.
const PROJECT_FALLBACK = ['#017272', '#F48327', '#5B5BD6', '#C2185B', '#2E7D32', '#0277BD']
const TRACK = 'rgba(127,127,127,0.24)'
const LABEL = TONES.muted.hex
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isDesktop = (surface, E) => surface === 'desktop' && Boolean(E.Svg)
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''))

function luminance(hex) {
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Text on a filled shape: white or near black, whichever contrasts more.
export function ink(hex) {
  const l = luminance(hex)
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#111111'
}

// The nearest named terminal color to a hex, by hue.
export function termName(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d < 0.08) return 'gray'
  const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
  const hue = (h + 360) % 360
  return hue < 15 || hue >= 330 ? 'red' : hue < 70 ? 'yellow' : hue < 165 ? 'green' : hue < 200 ? 'cyan' : hue < 260 ? 'blue' : 'magenta'
}

// A status tone by name, or a project color given as a hex.
function tone(name) {
  if (isHex(name)) return { hex: name.toUpperCase(), ink: ink(name), term: termName(name) }
  return TONES[name] || TONES.muted
}

// A project's color: its own from projects.md, else the fallback for its place.
export function projectColor(p, index) {
  return p && isHex(p.color) ? p.color.toUpperCase() : PROJECT_FALLBACK[Math.max(0, index) % PROJECT_FALLBACK.length]
}

function svg(E, w, h, body, alt) {
  return E.Svg({ source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, alt: sanitize(alt, 200), width: w, height: h })
}

// Text in a tone: a hex on the Desktop app, a named color in a terminal.
export function colored(E, surface, name, text, extra = {}) {
  text = sanitize(text, 2000)
  const t = tone(name)
  return E.Text({ ...extra, color: surface === 'desktop' ? t.hex : t.term, children: [text] })
}

// A project's badge: its monogram on a rounded square in its color.
export function badge(E, surface, label, hex, size = 18) {
  label = sanitize(label, 4)
  const t = tone(hex)
  if (isDesktop(surface, E)) {
    const w = Math.round(size * 1.25)
    return svg(E, w, size, `<rect width="${w}" height="${size}" rx="4" fill="${t.hex}"/><text x="${w / 2}" y="${size / 2 + 3.8}" text-anchor="middle" font-family="${esc(FONT)}" font-size="${Math.round(size * 0.58)}" font-weight="600" fill="${t.ink}">${esc(label)}</text>`, label)
  }
  return E.Box({ flexShrink: 0, children: [E.Text({ bold: true, color: t.term, children: [label] })] })
}

// A ring for a fraction done, in a project's color. The count goes beside it, as text.
export function ring(E, surface, done, total, hex, size = 40) {
  const frac = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  if (isDesktop(surface, E)) {
    const r = size / 2 - 3
    const len = 2 * Math.PI * r
    const arc = frac > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${tone(hex).hex}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(len * frac).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''
    return svg(E, size, size, `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="4"/>${arc}`, `${done} of ${total} done`)
  }
  return E.Text({ color: tone(hex).term, children: [`${Math.round(frac * 100)}%`] })
}

// Where a project's work sits: stages joined by a line, each node filled in
// the project's color when it holds work, with its count inside.
export function pipeline(E, surface, stages, hex) {
  const t = tone(hex)
  if (isDesktop(surface, E)) {
    const step = 66
    const w = stages.length * step
    const nodes = stages
      .map((s, i) => {
        const x = i * step + step / 2
        const full = s.n > 0
        const node = full ? `<circle cx="${x}" cy="11" r="9.5" fill="${t.hex}"/>` : `<circle cx="${x}" cy="11" r="8.75" fill="none" stroke="${TRACK}" stroke-width="1.5"/>`
        const count = `<text x="${x}" y="14.6" text-anchor="middle" font-family="${esc(FONT)}" font-size="10" font-weight="600" fill="${full ? t.ink : LABEL}">${s.n > 99 ? '99+' : s.n}</text>`
        const label = `<text x="${x}" y="33" text-anchor="middle" font-family="${esc(FONT)}" font-size="10" font-weight="500" fill="${LABEL}">${esc(s.label)}</text>`
        return node + count + label
      })
      .join('')
    const line = `<line x1="${step / 2}" y1="11" x2="${w - step / 2}" y2="11" stroke="${TRACK}" stroke-width="2"/>`
    return svg(E, w, 38, line + nodes, stages.map((s) => `${s.n} ${s.label}`).join(', '))
  }
  const parts = []
  stages.forEach((s, i) => {
    if (i) parts.push(E.Text({ dimColor: true, children: [' › '] }))
    parts.push(E.Text({ dimColor: s.n === 0, color: s.n ? t.term : undefined, bold: s.n > 0, children: [`${s.n}`] }))
    parts.push(E.Text({ dimColor: true, children: [' ' + s.label] }))
  })
  return E.Box({ flexDirection: 'row', children: parts })
}

// A progress bar. Desktop: a rounded SVG bar. Terminal: heavy line characters.
export function progress(E, surface, done, total, { width = 160, cells = 12, color = 'muted' } = {}) {
  const frac = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  if (isDesktop(surface, E)) {
    const w = Math.round(width)
    const fill = Math.round(w * frac)
    return svg(E, w, 8, `<rect width="${w}" height="8" rx="4" fill="${TRACK}"/>${fill > 0 ? `<rect width="${Math.max(fill, 8)}" height="8" rx="4" fill="${tone(color).hex}"/>` : ''}`, `${done} of ${total}`)
  }
  const full = Math.round(cells * frac)
  return E.Box({
    flexDirection: 'row',
    children: [E.Text({ color: tone(color).term, children: ['━'.repeat(full)] }), E.Text({ dimColor: true, children: ['━'.repeat(cells - full)] })],
  })
}

// A status pill. Desktop: a rounded filled label. Terminal: a colored dot and word.
export function pill(E, surface, label, name = 'muted') {
  label = sanitize(label, 80).replace(/\n/g, ' ')
  const t = tone(name)
  if (isDesktop(surface, E)) {
    const w = Math.round(String(label).length * 6.3 + 16)
    return svg(E, w, 18, `<rect width="${w}" height="18" rx="9" fill="${t.hex}"/><text x="${w / 2}" y="12.5" text-anchor="middle" font-family="${esc(FONT)}" font-size="11" font-weight="600" fill="${t.ink}">${esc(label)}</text>`, String(label))
  }
  return E.Box({ flexShrink: 0, children: [E.Text({ color: t.term, children: [`● ${label}`] })] })
}

// A row of square cells, each { fill } (a hex: busy), { outline } (a hex: idle)
// or {} (empty): pool slots, and lane capacity colored by the project using it.
// `pad` keeps the strip as wide as `pad` cells, so rows of strips line up.
export function cells(E, surface, list, alt, pad = 0) {
  list = list.slice(0, 48)
  const span = Math.min(48, Math.max(list.length, pad, 1))
  if (isDesktop(surface, E)) {
    const w = span * 18
    const body = list
      .map((c, i) => {
        const x = i * 18 + 1
        if (c.fill) return `<rect x="${x}" y="1" width="14" height="14" rx="4" fill="${tone(c.fill).hex}"/>`
        if (c.outline) return `<rect x="${x + 0.75}" y="1.75" width="12.5" height="12.5" rx="3.5" fill="none" stroke="${tone(c.outline).hex}" stroke-width="1.5"/>`
        return `<rect x="${x}" y="1" width="14" height="14" rx="4" fill="${TRACK}"/>`
      })
      .join('')
    return svg(E, w, 16, body, alt || `${list.filter((c) => c.fill).length} of ${list.length} in use`)
  }
  return E.Box({
    flexDirection: 'row',
    children: [
      ...list.map((c) => E.Text({ color: c.fill || c.outline ? tone(c.fill || c.outline).term : 'gray', dimColor: !c.fill && !c.outline, children: [c.fill ? '■ ' : '□ '] })),
      ...(span > list.length ? [E.Text({ children: ['  '.repeat(span - list.length)] })] : []),
    ],
  })
}

// Recent results, oldest to newest, as dots colored by conclusion.
export function dots(E, surface, results) {
  const toneOf = (c) => (c === 'success' ? 'good' : c === 'failure' || c === 'timed_out' || c === 'startup_failure' ? 'bad' : c === 'cancelled' ? 'muted' : 'warn')
  if (isDesktop(surface, E)) {
    const w = Math.max(results.length, 1) * 11
    return svg(E, w, 12, results.map((c, i) => `<circle cx="${i * 11 + 5}" cy="6" r="4" fill="${tone(toneOf(c)).hex}"/>`).join(''), `${results.filter((c) => c === 'success').length} of ${results.length} recent runs passed`)
  }
  return E.Box({ flexDirection: 'row', children: results.map((c) => E.Text({ color: tone(toneOf(c)).term, children: ['●'] })) })
}

// The tone for a time against its budget: green under 70 percent, amber under 90, red after.
export function budgetTone(seconds, budget) {
  if (!budget) return 'muted'
  const r = seconds / budget
  return r < 0.7 ? 'good' : r < 0.9 ? 'warn' : 'bad'
}
