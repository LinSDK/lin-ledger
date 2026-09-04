// ============================================================================
// Lin Ledger : charts
//
// Every chart is SVG that this module writes as text. There is no chart
// library, for three reasons: the application must run with no build step, the
// colours must follow the light theme and the dark theme, and a touch must
// work correctly on a telephone.
// ============================================================================

import { fmtCompact, fmt } from './money.js'
import { fmtShort, fmtDate, parts, monthKey } from './dates.js'

/** The mark that says a bar opens a screen. charts.js asks nothing of ui.js. */
const CHEVRON = '<svg class="ic bar-chev" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M9 18l6-6-6-6"/></svg>'

const esc = s => String(s).replace(/[&<>"]/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

let uid = 0
const nextId = () => `c${++uid}`

// ---------------------------------------------------------------------------
// A line chart of the balance over time
// ---------------------------------------------------------------------------

/**
 * points   : [{date, balance}]
 * compare  : a second series, drawn as a broken line (used by the what if screens)
 * markers  : [{date, kind, label}]
 * buffer   : the safety amount, drawn as a broken line across the chart
 */
export function balanceChart (points, opts = {}) {
  const {
    width = 720, height = 220, compare = null, buffer = 0,
    markers = [], showAxis = true, pad = { t: 14, r: 10, b: 22, l: 44 },
  } = opts

  if (!points || points.length < 2) {
    return `<div class="chart-empty">Not enough data for a chart.</div>`
  }

  const all = [...points.map(p => p.balance),
               ...(compare ? compare.map(p => p.balance) : []), 0]
  if (buffer > 0) all.push(buffer)
  let lo = Math.min(...all), hi = Math.max(...all)
  if (hi === lo) { hi = lo + 100; lo -= 100 }
  const span = hi - lo
  lo -= span * 0.08; hi += span * 0.08

  const iw = width - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const x = i => pad.l + (i / (points.length - 1)) * iw
  const y = v => pad.t + ih - ((v - lo) / (hi - lo)) * ih

  const path = pts => pts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('')

  const gid = nextId()
  const zeroY = y(0)
  const clipTop = nextId()
  const clipBottom = nextId()

  // Month names along the bottom.
  const ticks = []
  let seenMonth = null
  points.forEach((p, i) => {
    const mk = monthKey(p.date)
    if (mk !== seenMonth) {
      seenMonth = mk
      if (i > 0 || points.length < 40) ticks.push({ i, label: fmtShort(p.date) })
    }
  })

  const area = `${path(points)}L${x(points.length - 1).toFixed(1)},${y(lo).toFixed(1)}L${x(0).toFixed(1)},${y(lo).toFixed(1)}Z`

  // Zero always sits inside the scale, so the reader can judge the height.
  // The red parts appear only when a real value falls below zero.
  const hasNegative = points.some(p => p.balance < 0)
                      || (compare ? compare.some(p => p.balance < 0) : false)

  return `
<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
     role="img" aria-label="The balance over time">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="var(--ok)" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="var(--ok)" stop-opacity="0.02"/>
    </linearGradient>
    <clipPath id="${clipTop}">
      <rect x="0" y="0" width="${width}" height="${Math.max(0, zeroY).toFixed(1)}"/>
    </clipPath>
    <clipPath id="${clipBottom}">
      <rect x="0" y="${Math.max(0, zeroY).toFixed(1)}" width="${width}"
            height="${Math.max(0, height - zeroY).toFixed(1)}"/>
    </clipPath>
  </defs>

  ${showAxis ? gridLines(lo, hi, pad, iw, ih, width, y) : ''}

  ${buffer > 0 && buffer >= lo && buffer <= hi ? `
  <line x1="${pad.l}" y1="${y(buffer).toFixed(1)}" x2="${width - pad.r}"
        y2="${y(buffer).toFixed(1)}" class="chart-buffer"/>
  <text x="${width - pad.r}" y="${(y(buffer) - 4).toFixed(1)}"
        class="chart-buffer-label" text-anchor="end">buffer</text>` : ''}

  ${hasNegative && zeroY > pad.t && zeroY < pad.t + ih ? `
  <line x1="${pad.l}" y1="${zeroY.toFixed(1)}" x2="${width - pad.r}"
        y2="${zeroY.toFixed(1)}" class="chart-zero"/>` : ''}

  <path d="${area}" fill="url(#${gid})" clip-path="url(#${clipTop})"/>
  ${hasNegative
    ? `<path d="${area}" class="chart-area-bad" clip-path="url(#${clipBottom})"/>` : ''}

  ${compare ? `<path d="${path(compare)}" class="chart-line-compare"/>` : ''}
  <path d="${path(points)}" class="chart-line" clip-path="url(#${clipTop})"/>
  ${hasNegative
    ? `<path d="${path(points)}" class="chart-line-neg" clip-path="url(#${clipBottom})"/>` : ''}

  ${markers.map(m => {
    const i = points.findIndex(p => p.date === m.date)
    if (i < 0) return ''
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(points[i].balance).toFixed(1)}"
              r="4" class="chart-dot chart-dot-${esc(m.kind)}"/>`
  }).join('')}

  ${showAxis ? ticks.map(t =>
    `<text x="${x(t.i).toFixed(1)}" y="${height - 6}" class="chart-tick"
           text-anchor="middle">${esc(t.label)}</text>`).join('') : ''}
</svg>`
}

function gridLines (lo, hi, pad, iw, ih, width, y) {
  const steps = 4
  let out = ''
  for (let k = 0; k <= steps; k++) {
    const v = lo + (hi - lo) * (k / steps)
    const yy = y(v).toFixed(1)
    out += `<line x1="${pad.l}" y1="${yy}" x2="${width - pad.r}" y2="${yy}" class="chart-grid"/>`
    out += `<text x="${pad.l - 6}" y="${(Number(yy) + 3).toFixed(1)}" class="chart-tick"
             text-anchor="end">${esc(fmtCompact(v))}</text>`
  }
  return out
}

// ---------------------------------------------------------------------------
// A small line with no axis, for a card
// ---------------------------------------------------------------------------

export function sparkline (points, opts = {}) {
  const { width = 320, height = 48 } = opts
  if (!points || points.length < 2) return ''
  const values = points.map(p => p.balance)
  let lo = Math.min(...values, 0), hi = Math.max(...values)
  if (hi === lo) hi = lo + 100
  const x = i => (i / (points.length - 1)) * width
  const y = v => height - 2 - ((v - lo) / (hi - lo)) * (height - 4)
  const d = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('')
  const zeroY = y(0)
  const negative = values.some(v => v < 0)
  return `
<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
  ${negative ? `<line x1="0" y1="${zeroY.toFixed(1)}" x2="${width}" y2="${zeroY.toFixed(1)}" class="chart-zero"/>` : ''}
  <path d="${d}" class="${negative ? 'spark-line spark-bad' : 'spark-line'}"/>
</svg>`
}

// ---------------------------------------------------------------------------
// Bars across the screen, for spending by category
// ---------------------------------------------------------------------------

/**
 * items : [{label, value, budget, color}]
 * The bar shows the amount spent. A thin line marks the budget, therefore the
 * user sees at once which category went past its budget.
 */
/**
 * One bar for each category.
 *
 * An item that carries an id becomes a button, and the button says which
 * category it holds. The screen that drew the bars then sends a tap to that
 * category. An item with no id stays a plain block, therefore a caller that has
 * nothing to open loses nothing.
 */
export function categoryBars (items, opts = {}) {
  const { max = null, showBudget = true } = opts
  if (!items.length) return `<div class="chart-empty">Nothing spent in this period.</div>`
  const top = max ?? Math.max(...items.map(i => Math.max(i.value, i.budget || 0)), 1)
  const total = items.reduce((a, i) => a + i.value, 0)

  return `<div class="bars">` + items.map(i => {
    const pct = Math.max(0.5, (i.value / top) * 100)
    const bpct = i.budget ? Math.min(100, (i.budget / top) * 100) : null
    const over = i.budget && i.value > i.budget
    const tag = i.id ? 'button' : 'div'
    const attrs = i.id
      ? ` type="button" class="bar-row is-tap" data-category="${esc(i.id)}"`
      : ' class="bar-row"'
    return `
    <${tag}${attrs}>
      <div class="bar-head">
        <span class="bar-label"><i class="dot" style="background:${esc(i.color || 'var(--accent)')}"></i>${esc(i.label)}</span>
        <span class="bar-value ${over ? 'is-over' : ''}">${fmt(i.value)}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${over ? 'is-over' : ''}"
             style="width:${pct.toFixed(1)}%;background:${esc(i.color || 'var(--accent)')}"></div>
        ${showBudget && bpct !== null
          ? `<div class="bar-budget" style="left:${bpct.toFixed(1)}%"
                  title="Budget ${fmt(i.budget)}"></div>` : ''}
      </div>
      <div class="bar-foot">
        ${total > 0 ? `${((i.value / total) * 100).toFixed(0)}% of the total` : ''}
        ${i.budget ? ` &middot; budget ${fmt(i.budget)}${over ? ` &middot; over by ${fmt(i.value - i.budget)}` : ''}` : ''}
      </div>
      ${i.id ? CHEVRON : ''}
    </${tag}>`
  }).join('') + `</div>`
}

// ---------------------------------------------------------------------------
// A bar of progress, for a loan
// ---------------------------------------------------------------------------

export function progressBar (done, total, opts = {}) {
  const { label = '', color = 'var(--accent)' } = opts
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0
  return `
  <div class="prog">
    <div class="prog-track">
      <div class="prog-fill" style="width:${pct.toFixed(1)}%;background:${esc(color)}"></div>
    </div>
    ${label ? `<div class="prog-label">${esc(label)}</div>` : ''}
  </div>`
}

// ---------------------------------------------------------------------------
// Bars up the screen, for the amount in each month
// ---------------------------------------------------------------------------

export function monthBars (items, opts = {}) {
  const { height = 130 } = opts
  if (!items.length) return `<div class="chart-empty">No history yet.</div>`
  const top = Math.max(...items.map(i => Math.abs(i.value)), 1)
  return `<div class="mbars" style="--mb-h:${height}px">` + items.map(i => {
    const h = Math.max(2, (Math.abs(i.value) / top) * height)
    return `
    <div class="mbar">
      <div class="mbar-col">
        <div class="mbar-fill ${i.value < 0 ? 'is-neg' : ''}" style="height:${h.toFixed(1)}px"
             title="${esc(i.label)}: ${fmt(i.value)}"></div>
      </div>
      <div class="mbar-value">${esc(fmtCompact(i.value))}</div>
      <div class="mbar-label">${esc(i.label)}</div>
    </div>`
  }).join('') + `</div>`
}

// ---------------------------------------------------------------------------
// Follow a finger or a pointer across the balance chart
// ---------------------------------------------------------------------------

/**
 * Lets the user drag across the chart to read the balance of one day.
 * It works with a mouse and with a touch, because it uses pointer events.
 */
export function attachScrubber (host, points, onPoint) {
  const svg = host.querySelector('svg.chart')
  if (!svg || points.length < 2) return

  const pick = clientX => {
    const box = svg.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width))
    // The chart has a left margin for the labels. Undo it.
    const padL = 44 / 720, padR = 10 / 720
    const inner = Math.max(0, Math.min(1, (ratio - padL) / (1 - padL - padR)))
    return points[Math.round(inner * (points.length - 1))]
  }

  let active = false
  const move = e => { if (active) { onPoint(pick(e.clientX), e); e.preventDefault() } }
  const stop = () => { active = false; onPoint(null); host.classList.remove('is-scrub') }

  host.addEventListener('pointerdown', e => {
    active = true
    host.classList.add('is-scrub')
    onPoint(pick(e.clientX), e)
    host.setPointerCapture?.(e.pointerId)
  })
  host.addEventListener('pointermove', move)
  host.addEventListener('pointerup', stop)
  host.addEventListener('pointercancel', stop)
  host.addEventListener('pointerleave', () => { if (active) stop() })
}
