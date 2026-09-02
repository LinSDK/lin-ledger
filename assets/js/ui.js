// ============================================================================
// Lin Ledger : the parts that make the screens
//
// A sheet takes the whole screen on a telephone and becomes a panel in the
// middle of a large screen. Every form comes from one builder, therefore each
// form behaves the same way and each money field accepts the same input.
// ============================================================================

import { fmt, parseMoney, toDb } from './money.js'
import { today as todayIso, fmtDate } from './dates.js'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

/** Turns a piece of HTML into an element. */
export function h (html) {
  const t = document.createElement('template')
  t.innerHTML = String(html).trim()
  return t.content.firstElementChild
}

export const qs = (sel, root = document) => root.querySelector(sel)
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)]

/**
 * Attaches one handler to a parent for many children.
 *
 * A screen draws itself again after every change, and it writes new HTML into
 * the same parent element. That element survives the draw, therefore a plain
 * addEventListener would stay behind and the next draw would add a second one.
 * After ten draws one tap would run the handler ten times, and ten copies of
 * the same sheet would open.
 *
 * Therefore this function keeps one real listener for each parent and each
 * event, and it keeps the handlers in a map with the selector as the key. A
 * second call with the same selector replaces the handler that was there
 * before. The newest handler is the correct one, because it holds the values
 * of the newest draw.
 */
const delegated = new WeakMap()

export function delegate (root, event, selector, fn) {
  let byEvent = delegated.get(root)
  if (!byEvent) { byEvent = new Map(); delegated.set(root, byEvent) }

  let handlers = byEvent.get(event)
  if (!handlers) {
    handlers = new Map()
    byEvent.set(event, handlers)
    root.addEventListener(event, e => {
      // A copy, because a handler may register or remove another one.
      for (const [sel, handler] of [...handlers]) {
        const hit = e.target.closest(sel)
        if (hit && root.contains(hit)) handler(e, hit)
      }
    })
  }

  handlers.set(selector, fn)
}

/** Forgets every delegated handler of one parent. */
export function undelegate (root, event) {
  const byEvent = delegated.get(root)
  if (!byEvent) return
  if (event) byEvent.get(event)?.clear()
  else for (const handlers of byEvent.values()) handlers.clear()
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICONS = {
  home:    'M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  bills:   'M4 3h13l3 3v15l-3-2-3 2-3-2-3 2-3-2zM7 8h9M7 12h9M7 16h6',
  loans:   'M3 7h18v11H3zM3 11h18M7 15h4',
  stats:   'M4 20V9M10 20V4M16 20v-7M22 20H2',
  more:    'M4 6h16M4 12h16M4 18h16',
  plus:    'M12 5v14M5 12h14',
  check:   'M20 6 9 17l-5-5',
  close:   'M18 6 6 18M6 6l12 12',
  chevron: 'M9 18l6-6-6-6',
  back:    'M15 18l-6-6 6-6',
  warn:    'M12 3l9 16H3zM12 9v5M12 17h.01',
  wallet:  'M3 7h15a3 3 0 0 1 3 3v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V6a2 2 0 0 1 2-2h11M17 13h.01',
  cash:    'M2 7h20v10H2zM12 12h.01M6 12h.01M18 12h.01',
  coins:   'M8 8a5 3 0 1 0 10 0 5 3 0 1 0-10 0M8 8v5a5 3 0 0 0 10 0V8M4 13a5 3 0 1 0 10 0M4 13v5a5 3 0 0 0 10 0',
  card:    'M2 6h20v12H2zM2 10h20M6 15h4',
  edit:    'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  trash:   'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  calendar:'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  clock:   'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2',
  down:    'M12 4v12M6 12l6 6 6-6',
  up:      'M12 20V8M6 12l6-6 6 6',
  spark:   'M3 17l5-6 4 3 5-8 4 5',
  info:    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 8h.01',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  search:  'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4',
  play:    'M7 4l12 8-12 8z',
  save:    'M4 4h12l4 4v12H4zM8 4v6h8V6M8 15h8',
  swap:    'M4 8h13l-3-3M20 16H7l3 3',
  wallet2: 'M3 7h15a3 3 0 0 1 3 3v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
}

export function icon (name, cls = '') {
  const d = ICONS[name] || ICONS.info
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
}

// ---------------------------------------------------------------------------
// Short messages
// ---------------------------------------------------------------------------

let toastHost = null

export function toast (message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = h('<div class="toasts" role="status" aria-live="polite"></div>')
    document.body.appendChild(toastHost)
  }
  const node = h(`<div class="toast toast-${esc(kind)}">
    ${kind === 'error' ? icon('warn') : kind === 'ok' ? icon('check') : icon('info')}
    <span>${esc(message)}</span></div>`)
  toastHost.appendChild(node)
  requestAnimationFrame(() => node.classList.add('is-in'))
  setTimeout(() => {
    node.classList.remove('is-in')
    setTimeout(() => node.remove(), 260)
  }, ms)
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const sheetStack = []

/**
 * Opens a sheet. It fills the screen of a telephone and becomes a panel in the
 * middle of a large screen.
 */
export function openSheet ({ title, body, footer = '', onMount, size = 'md',
                             dismissable = true }) {
  const back = h(`
    <div class="sheet-back" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet sheet-${esc(size)}">
        <header class="sheet-head">
          <h2>${esc(title)}</h2>
          <button class="btn-icon" data-close aria-label="Close">${icon('close')}</button>
        </header>
        <div class="sheet-body"></div>
        ${footer ? `<footer class="sheet-foot"></footer>` : ''}
      </div>
    </div>`)

  const bodyHost = qs('.sheet-body', back)
  if (typeof body === 'string') bodyHost.innerHTML = body
  else if (body) bodyHost.appendChild(body)

  if (footer) {
    const footHost = qs('.sheet-foot', back)
    if (typeof footer === 'string') footHost.innerHTML = footer
    else footHost.appendChild(footer)
  }

  const close = () => {
    back.classList.remove('is-in')
    const i = sheetStack.indexOf(api)
    if (i >= 0) sheetStack.splice(i, 1)
    if (sheetStack.length === 0) document.body.classList.remove('sheet-open')
    setTimeout(() => back.remove(), 220)
  }

  const api = { el: back, body: bodyHost, close }

  qs('[data-close]', back).addEventListener('click', close)
  if (dismissable) {
    back.addEventListener('click', e => { if (e.target === back) close() })
  }

  document.body.appendChild(back)
  document.body.classList.add('sheet-open')
  sheetStack.push(api)
  requestAnimationFrame(() => back.classList.add('is-in'))
  onMount?.(api)
  return api
}

/** The Escape key closes the sheet that is on top. */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1].close()
})

export function confirmSheet ({ title, message, confirmLabel = 'Yes', danger = false }) {
  return new Promise(resolve => {
    let answered = false
    const sheet = openSheet({
      title, size: 'sm',
      body: `<p class="prose">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-ghost" data-no>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmLabel)}</button>`,
      onMount: s => {
        qs('[data-no]', s.el).addEventListener('click', () => { answered = true; s.close(); resolve(false) })
        qs('[data-yes]', s.el).addEventListener('click', () => { answered = true; s.close(); resolve(true) })
      },
    })
    const observer = new MutationObserver(() => {
      if (!document.body.contains(sheet.el) && !answered) { answered = true; resolve(false); observer.disconnect() }
    })
    observer.observe(document.body, { childList: true })
  })
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/**
 * Makes a form from a list of fields.
 *
 * Each field is:
 *   { name, label, type, hint, required, options, when, min, max, step, rows }
 *
 * Types: text, money, date, time, number, select, switch, textarea, segment, static
 *
 * "when" is a function that reads the current values and gives true or false.
 * The form hides a field when the answer is false, therefore a form can change
 * as the user fills it, and the code stays in one place.
 *
 * A money field gives centavos to onSubmit. Every other field gives its text.
 */
export function buildForm ({ fields, values = {}, onSubmit, submitLabel = 'Save',
                             extraFooter = '', onInput }) {
  const form = h(`<form class="form" novalidate></form>`)
  const current = { ...values }

  const rowOf = f => {
    const id = `f_${f.name}`
    const v = current[f.name]
    let control = ''

    switch (f.type) {
      case 'money':
        control = `<input id="${id}" name="${f.name}" class="inp inp-money" type="text"
          inputmode="decimal" autocomplete="off"
          value="${v === null || v === undefined || v === '' ? '' : esc(fmt(v, { style: 'minus' }))}"
          placeholder="0.00" ${f.required ? 'required' : ''}>`
        break
      case 'date':
        control = `<input id="${id}" name="${f.name}" class="inp" type="date"
          value="${esc(v ?? '')}" ${f.required ? 'required' : ''}>`
        break
      case 'time':
        control = `<input id="${id}" name="${f.name}" class="inp" type="time"
          value="${esc(v ?? '')}" ${f.required ? 'required' : ''}>`
        break
      case 'number':
        control = `<input id="${id}" name="${f.name}" class="inp" type="number"
          inputmode="numeric" value="${v ?? ''}"
          ${f.min !== undefined ? `min="${f.min}"` : ''}
          ${f.max !== undefined ? `max="${f.max}"` : ''}
          ${f.step !== undefined ? `step="${f.step}"` : ''}
          ${f.required ? 'required' : ''}>`
        break
      case 'select':
        control = `<select id="${id}" name="${f.name}" class="inp">
          ${(f.options || []).map(o =>
            `<option value="${esc(o.value)}" ${String(o.value) === String(v ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`
          ).join('')}</select>`
        break
      case 'segment':
        control = `<div class="segment" role="group">
          ${(f.options || []).map(o =>
            `<button type="button" class="seg ${String(o.value) === String(v ?? '') ? 'is-on' : ''}"
              data-seg="${f.name}" data-value="${esc(o.value)}">${esc(o.label)}</button>`
          ).join('')}
          <input type="hidden" name="${f.name}" value="${esc(v ?? '')}"></div>`
        break
      case 'switch':
        control = `<label class="switch">
          <input id="${id}" name="${f.name}" type="checkbox" ${v ? 'checked' : ''}>
          <span class="switch-track"><span class="switch-knob"></span></span>
          <span class="switch-text">${esc(f.onLabel || 'Yes')}</span></label>`
        break
      case 'textarea':
        control = `<textarea id="${id}" name="${f.name}" class="inp" rows="${f.rows || 3}">${esc(v ?? '')}</textarea>`
        break
      case 'static':
        control = `<div class="static-val">${f.render ? f.render(current) : esc(v ?? '')}</div>`
        break
      default:
        control = `<input id="${id}" name="${f.name}" class="inp" type="text"
          value="${esc(v ?? '')}" ${f.required ? 'required' : ''}
          ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`
    }

    return `<div class="field" data-field="${f.name}">
      ${f.type === 'switch' ? '' : `<label for="${id}">${esc(f.label)}${f.required ? ' <i>*</i>' : ''}</label>`}
      ${control}
      ${f.hint ? `<p class="hint">${f.hint}</p>` : ''}
      <p class="err" data-err="${f.name}"></p>
    </div>`
  }

  form.innerHTML = `
    <div class="fields">${fields.map(rowOf).join('')}</div>
    ${extraFooter ? `<div class="form-extra">${extraFooter}</div>` : ''}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary btn-block">${esc(submitLabel)}</button>
    </div>`

  // Reads every value out of the form. A money field gives centavos.
  const read = () => {
    const out = {}
    for (const f of fields) {
      if (f.type === 'static') continue
      const node = form.elements[f.name]
      if (!node) continue
      if (f.type === 'money') {
        const parsed = parseMoney(node.value)
        out[f.name] = node.value.trim() === '' ? null : parsed
      } else if (f.type === 'switch') {
        out[f.name] = !!node.checked
      } else if (f.type === 'number') {
        out[f.name] = node.value === '' ? null : Number(node.value)
      } else {
        out[f.name] = node.value === '' ? null : node.value
      }
    }
    return out
  }

  // Shows or hides the fields that depend on another field.
  const applyVisibility = () => {
    const v = read()
    Object.assign(current, v)
    for (const f of fields) {
      if (!f.when) continue
      const row = qs(`[data-field="${f.name}"]`, form)
      if (row) row.classList.toggle('is-hidden', !f.when(current))
    }
    for (const f of fields) {
      if (f.type !== 'static' || !f.render) continue
      const row = qs(`[data-field="${f.name}"] .static-val`, form)
      if (row) row.innerHTML = f.render(current)
    }
  }

  form.addEventListener('input', () => { applyVisibility(); onInput?.(read(), form) })
  form.addEventListener('change', () => { applyVisibility(); onInput?.(read(), form) })

  // The buttons of a segment control.
  delegate(form, 'click', '[data-seg]', (e, btn) => {
    const group = btn.parentElement
    qsa('[data-seg]', group).forEach(b => b.classList.remove('is-on'))
    btn.classList.add('is-on')
    qs('input[type=hidden]', group).value = btn.dataset.value
    applyVisibility()
    onInput?.(read(), form)
  })

  form.addEventListener('submit', async e => {
    e.preventDefault()
    qsa('.err', form).forEach(n => (n.textContent = ''))
    const v = read()

    // Check the fields that are necessary and visible.
    let bad = false
    for (const f of fields) {
      if (!f.required) continue
      if (f.when && !f.when(v)) continue
      const empty = v[f.name] === null || v[f.name] === undefined || v[f.name] === ''
      if (empty) {
        const slot = qs(`[data-err="${f.name}"]`, form)
        if (slot) slot.textContent = `${f.label} is necessary.`
        bad = true
      }
    }
    if (bad) return

    const button = qs('button[type=submit]', form)
    button.disabled = true
    button.classList.add('is-busy')
    try {
      await onSubmit(v, form)
    } catch (err) {
      toast(err.message || String(err), 'error', 5000)
    } finally {
      button.disabled = false
      button.classList.remove('is-busy')
    }
  })

  applyVisibility()
  return form
}

/** Opens a sheet that holds a form. */
export function formSheet (opts) {
  let sheet
  const form = buildForm({
    ...opts,
    onSubmit: async (values, f) => {
      const keep = await opts.onSubmit(values, f, sheet)
      if (!keep) sheet.close()
    },
  })
  sheet = openSheet({ title: opts.title, body: form, size: opts.size || 'md' })
  sheet.form = form
  opts.onMount?.(sheet)
  const first = qs('input:not([type=hidden]):not([type=checkbox]), select, textarea', form)
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 120)
  return sheet
}

// ---------------------------------------------------------------------------
// Pieces that many screens use
// ---------------------------------------------------------------------------

export const skeleton = (rows = 3) =>
  `<div class="skel">${Array(rows).fill('<div class="skel-row"></div>').join('')}</div>`

export const empty = (message, action = '') =>
  `<div class="empty">${icon('info')}<p>${esc(message)}</p>${action}</div>`

export function statPill (label, value, kind = '') {
  return `<div class="pill ${kind ? 'pill-' + kind : ''}">
    <span class="pill-label">${esc(label)}</span>
    <span class="pill-value">${value}</span></div>`
}

export function card (title, bodyHtml, extra = '') {
  return `<section class="card">
    ${title ? `<header class="card-head"><h3>${esc(title)}</h3>${extra}</header>` : ''}
    <div class="card-body">${bodyHtml}</div></section>`
}

/** A row in a list, with a name on the left and an amount on the right. */
export function listRow ({ title, sub, right, rightSub, tag, kind = '', attrs = '' }) {
  return `<button class="row ${kind}" ${attrs}>
    <span class="row-main">
      <span class="row-title">${title}${tag ? ` <em class="tag">${esc(tag)}</em>` : ''}</span>
      ${sub ? `<span class="row-sub">${sub}</span>` : ''}
    </span>
    <span class="row-side">
      ${right ? `<span class="row-right">${right}</span>` : ''}
      ${rightSub ? `<span class="row-rsub">${rightSub}</span>` : ''}
    </span>
    ${icon('chevron', 'row-chev')}
  </button>`
}

/** A short line that says how safe a period or a plan is. */
export function verdictBadge (verdict) {
  const map = {
    safe:  { text: 'Safe',         cls: 'ok' },
    tight: { text: 'Tight',        cls: 'warn' },
    short: { text: 'Not possible', cls: 'bad' },
  }
  const v = map[verdict] || map.safe
  return `<span class="badge badge-${v.cls}">${v.text}</span>`
}

/** Sets the colour of an amount: green above zero, red below zero. */
export const moneyClass = c => (c < 0 ? 'neg' : c > 0 ? 'pos' : 'zero')

export const money = (c, opts) => `<span class="${moneyClass(c)}">${fmt(c, opts)}</span>`
