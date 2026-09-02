// ============================================================================
// Lin Ledger : the list of the money that really moved
//
// Two screens show this list: the home screen shows every account, and the
// account screen shows one. Both obey the same three rules, therefore both read
// them from this file and no screen can drift from the other.
//
//   1. The rows of one event join before the list filters or cuts them.
//   2. A day heading totals the whole day, and not only the rows on screen.
//   3. The order inside a day follows the clock, newest first.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { esc, empty, delegate } from '../ui.js'

const TX_STEP = 25
const FIRST_SHOWN = 8

const FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'expense', label: 'Spent' },
  { key: 'income',  label: 'Received' },
]

const TYPE_LABEL = {
  income: 'received', expense: 'spent',
  transfer_in: 'moved in', transfer_out: 'moved out',
  adjustment: 'adjustment',
}

/**
 * The filter and the row count of one list.
 *
 * The values live outside the draw, therefore the screen does not jump back to
 * the top of the list after a person changes one movement.
 */
export function makeListState (shown = FIRST_SHOWN) {
  return { filter: 'all', shown }
}

/**
 * Turns the rows into events, newest first.
 *
 * A purchase that took money from two accounts holds one row for each account.
 * The list must treat those rows as one event, for three reasons: the sum is
 * the true cost, a filter must keep or drop the whole event, and the cut at the
 * end of a page must never divide one event in two.
 *
 * Each event is { key, group, kind, rows, date, time, net }.
 */
export function buildEvents (rows) {
  const out = []
  const seen = new Map()
  for (const t of rows) {
    if (!t.transfer_group) {
      out.push({ key: t.id, group: null, kind: null, rows: [t],
                 date: t.occurred_on, time: t.occurred_time || null, net: t.amount })
      continue
    }
    const hit = seen.get(t.transfer_group)
    if (hit) { hit.rows.push(t); hit.net += t.amount; continue }
    const item = { key: t.transfer_group, group: t.transfer_group,
                   kind: t.group_kind, rows: [t], date: t.occurred_on,
                   time: t.occurred_time || null, net: t.amount }
    seen.set(t.transfer_group, item)
    out.push(item)
  }
  return out
}

/** The events that the chosen filter keeps. The sum of the event decides. */
function filtered (rows, filter) {
  const all = buildEvents(rows)
  if (filter === 'expense') return all.filter(e => e.net < 0)
  if (filter === 'income') return all.filter(e => e.net > 0)
  return all
}

/**
 * The whole card.
 *
 * rows        the movements to show, newest first
 * state       from makeListState
 * title       the heading
 * extra       the link on the right of the heading
 * showAccount false on the account screen, where every row is one account
 */
export function txListCard ({ rows, state, title = 'Transactions', extra = '',
                              showAccount = true, emptyText = '' }) {
  const events = filtered(rows, state.filter)
  const shown = events.slice(0, state.shown)
  const spent = events.filter(e => e.net < 0).reduce((a, e) => a - e.net, 0)
  const got = events.filter(e => e.net > 0).reduce((a, e) => a + e.net, 0)

  const nothing = state.filter === 'income'
    ? 'You have recorded no money that came in.'
    : state.filter === 'expense'
      ? 'You have recorded no spending yet.'
      : emptyText || 'You have recorded no money movement yet. Use the + button to add one.'

  const foot = `
      <div class="tx-foot">
        <span class="hint">
          ${shown.length} of ${events.length}
          ${events.length === 1 ? 'movement' : 'movements'}
        </span>
        ${events.length > shown.length ? `
          <button class="btn btn-ghost btn-sm" data-tx-more>
            Show ${Math.min(TX_STEP, events.length - shown.length)} more</button>` : ''}
        ${state.shown > FIRST_SHOWN ? `
          <button class="btn btn-ghost btn-sm" data-tx-less>Show fewer</button>` : ''}
      </div>`

  const body = events.length === 0
    ? empty(nothing)
    : groupByDay(shown, events, showAccount) + foot

  return `
  <section class="card card-tx">
    <header class="card-head">
      <h3>${esc(title)}</h3>
      ${extra}
    </header>
    <div class="card-body">
      <div class="tx-sums">
        <span class="neg">${fmt(spent)} out</span>
        <span class="pos">${fmt(got)} in</span>
        <span class="${got - spent < 0 ? 'neg' : 'pos'}">${fmt(got - spent)} net</span>
      </div>
      <div class="segment">
        ${FILTERS.map(f => `
          <button class="seg ${f.key === state.filter ? 'is-on' : ''}"
                  data-tx-filter="${f.key}">${f.label}</button>`).join('')}
      </div>
      ${body}
    </div>
  </section>`
}

/**
 * Puts the movements under a heading for each day.
 *
 * The heading totals the whole day, and not only the rows that are on screen.
 * A part of a day would give a total that is too small, and a person would read
 * it as the true amount for that day.
 */
function groupByDay (shown, all, showAccount) {
  const dayTotal = new Map()
  const dayCount = new Map()
  for (const e of all) {
    dayTotal.set(e.date, (dayTotal.get(e.date) || 0) + e.net)
    dayCount.set(e.date, (dayCount.get(e.date) || 0) + 1)
  }

  const days = []
  for (const e of shown) {
    const last = days[days.length - 1]
    if (last && last.date === e.date) last.items.push(e)
    else days.push({ date: e.date, items: [e] })
  }

  return days.map(day => {
    const net = dayTotal.get(day.date) ?? 0
    const total = dayCount.get(day.date) ?? day.items.length
    const hidden = total - day.items.length
    return `
    <div class="tx-day">
      <div class="tx-day-head">
        <span>${D.fmtDay(day.date)}${day.date === D.today() ? ' &middot; today' : ''}</span>
        <span class="${net < 0 ? 'neg' : 'pos'}">${fmt(net)}</span>
      </div>
      ${day.items.map(item => item.group
        ? groupRow(item, showAccount)
        : singleRow(item.rows[0], showAccount)).join('')}
      ${hidden > 0 ? `<p class="tx-hidden">${hidden} more on this day.
        Select "Show more" to see ${hidden === 1 ? 'it' : 'them'}.</p>` : ''}
    </div>`
  }).join('')
}

/**
 * The clock, for the right side of a row.
 *
 * A row with no clock shows nothing at all. Every row that came before the
 * clock column existed carries no time, therefore a label on each one would
 * repeat itself down the whole list and say nothing that the reader needs. The
 * heading of the day already carries the date, and the sheet that changes a
 * movement explains the empty box.
 */
function stamp (value) {
  const text = D.fmtTime(value)
  return text ? `<span class="tx-time">${esc(text)}</span>` : ''
}

/** One event that touched more than one account. */
function groupRow (item, showAccount) {
  const rows = item.rows
  const net = item.net
  const first = rows[0]
  const cat = store.categoryById(first.category_id)
  const isMove = item.kind === 'transfer'
  const names = [...new Set(rows.map(t => store.accountById(t.account_id)?.name)
    .filter(Boolean))]

  const bits = [
    cat && !isMove ? esc(cat.name) : null,
    showAccount ? esc(names.join(', ')) : null,
  ].filter(Boolean)

  return `
  <div class="tx-group">
    <button class="row tx-row" data-tx="${first.id}">
      <span class="dot" style="background:${esc(cat?.color || 'var(--text-3)')}"></span>
      <span class="row-main">
        <span class="row-title">
          ${esc(first.description || (isMove ? 'Moved money' : 'Purchase'))}
          <em class="tx-group-tag">${isMove ? 'moved' : 'split'}</em>
        </span>
        <span class="row-sub">${bits.join(' &middot; ')}</span>
      </span>
      <span class="row-side">
        <span class="row-right ${net < 0 ? 'neg' : net > 0 ? 'pos' : 'muted'}">${fmt(net)}</span>
        ${stamp(item.time)}
      </span>
    </button>
    <div class="tx-legs">
      ${rows.map(t => `
        <div class="tx-leg">
          <span>${esc(store.accountById(t.account_id)?.name ?? '?')}</span>
          <span class="${t.amount < 0 ? 'neg' : 'pos'}">${fmt(t.amount)}</span>
        </div>`).join('')}
    </div>
  </div>`
}

function singleRow (t, showAccount) {
  const cat = store.categoryById(t.category_id)
  const acct = store.accountById(t.account_id)
  const bits = [
    cat ? esc(cat.name) : TYPE_LABEL[t.type] || t.type,
    showAccount && acct ? esc(acct.name) : null,
    t.type === 'adjustment' ? 'set by hand' : null,
  ].filter(Boolean)

  return `
  <button class="row tx-row" data-tx="${t.id}">
    <span class="dot" style="background:${esc(cat?.color || 'var(--text-3)')}"></span>
    <span class="row-main">
      <span class="row-title">${esc(t.description || TYPE_LABEL[t.type] || 'Movement')}</span>
      <span class="row-sub">${bits.join(' &middot; ')}</span>
    </span>
    <span class="row-side">
      <span class="row-right ${t.amount < 0 ? 'neg' : 'pos'}">${fmt(t.amount)}</span>
      ${stamp(t.occurred_time)}
    </span>
  </button>`
}

/**
 * The three controls of the list. The caller gives the function that draws the
 * screen again, because only the caller knows what else is on that screen.
 */
export function wireTxList (host, state, redraw) {
  delegate(host, 'click', '[data-tx-filter]', (e, node) => {
    state.filter = node.dataset.txFilter
    state.shown = FIRST_SHOWN
    redraw()
  })
  delegate(host, 'click', '[data-tx-more]', () => {
    state.shown += TX_STEP
    redraw()
  })
  delegate(host, 'click', '[data-tx-less]', () => {
    state.shown = FIRST_SHOWN
    redraw()
  })
}
