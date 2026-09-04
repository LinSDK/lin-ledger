// ============================================================================
// Lin Ledger : one category
//
// Tap a category anywhere in the application and this screen opens. It answers
// one question: where did the money of this category actually go?
//
// The list comes from views/tx-list.js, the same file that the home screen and
// the account screen read. The figures come from store.categoryTotal, which
// holds the rule that takes change and a refund away from a cost. Therefore
// this screen can never disagree with the card that sent a person here.
//
// The address holds "none" for the movements that carry no category. Those
// movements are money that really moved, therefore they need a screen too.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { monthBars } from '../charts.js'
import { icon, esc, card, empty, delegate, qs } from '../ui.js'
import { openEditTransaction, openCategorySheet } from './actions.js'
import { openQuickAdd } from './quick-add.js'
import { makeListState, txListCard, wireTxList } from './tx-list.js'

/** The address carries "none" for the movements that hold no category. */
export const NONE = 'none'
const idFromParam = param => (param === NONE || !param ? null : param)

// One state for each category, so a person who returns finds the same view.
const listStates = new Map()
const stateFor = key => {
  if (!listStates.has(key)) listStates.set(key, makeListState(25))
  return listStates.get(key)
}

export async function render (host, params) {
  const param = params?.[0]
  const id = idFromParam(param)
  const cat = id ? store.categoryById(id) : null

  // A category that a person deleted while this screen was open.
  if (id && !cat) {
    host.innerHTML = empty('That category is not here any more.',
      '<a class="btn btn-primary" href="#/categories">Back to the categories</a>')
    return
  }

  const name = cat ? cat.name : 'Not in a category'
  const color = cat?.color || 'var(--text-3)'
  const isIncome = cat?.kind === 'income'
  const verb = isIncome ? 'Received' : 'Spent'

  // The bar at the top and the tab of the browser both carry the name. The
  // route can only offer the word "Category", which names nothing.
  const title = qs('#top-title')
  if (title) title.textContent = name
  document.title = `${name} - Lin Ledger`

  const now = D.today()
  const monthStart = D.startOfMonth(now)
  const periodStart = store.currentPeriodStart(now)

  const rows = store.transactionsOfCategory(id)
  const listState = stateFor(param || NONE)

  const month = store.categoryTotal(id, monthStart, now)
  const period = store.categoryTotal(id, periodStart, now)
  const ever = rows.length
    ? store.categoryTotal(id, rows[rows.length - 1].occurred_on, now)
    : 0

  // A per period allowance arrives on every pay date, therefore a month holds
  // two of them. The same rule that the other screens use.
  const perMonth = cat?.budget_amount
    ? (cat.budget_basis === 'per_period' ? cat.budget_amount * 2 : cat.budget_amount)
    : null
  const budgetNow = cat?.budget_amount
    ? (cat.budget_basis === 'per_period' ? cat.budget_amount : perMonth)
    : null
  const spentAgainst = cat?.budget_basis === 'per_period' ? period : month
  const over = budgetNow !== null && spentAgainst > budgetNow

  host.innerHTML = `
    <section class="hero cat-hero">
      <span class="cat-hero-dot" style="background:${esc(color)}"></span>
      <div class="cat-hero-text">
        <p class="hero-label">${esc(name)}</p>
        <p class="hero-value ${isIncome ? 'pos' : over ? 'neg' : ''}">${fmt(month)}</p>
        <p class="hero-note">
          ${verb.toLowerCase()} in ${D.fmtMonth(now)}
          ${cat ? ` &middot; ${esc(kindWord(cat))}` : ' &middot; no category'}
        </p>
      </div>
    </section>

    <div class="pills">
      <div class="pill">
        <span class="pill-label">This pay period</span>
        <span class="pill-value">${fmt(period)}</span>
        <span class="pill-sub">from ${D.fmtShort(periodStart)}</span>
      </div>
      <div class="pill">
        <span class="pill-label">${esc(D.fmtMonth(now))}</span>
        <span class="pill-value">${fmt(month)}</span>
        <span class="pill-sub">this month</span>
      </div>
      <div class="pill">
        <span class="pill-label">All of it</span>
        <span class="pill-value">${fmt(ever)}</span>
        <span class="pill-sub">${rows.length}
          ${rows.length === 1 ? 'movement' : 'movements'}</span>
      </div>
    </div>

    ${budgetNow !== null ? budgetCard(cat, budgetNow, spentAgainst, over) : ''}

    <div class="stack">
      <button class="btn btn-primary btn-block" id="add-here">
        ${icon('plus')} Add a movement here</button>
      ${cat ? `
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" id="edit-category">
            ${icon('edit')} Change this category</button>
          <a class="btn btn-ghost btn-sm" href="#/categories">All categories</a>
        </div>` : ''}
    </div>

    ${txListCard({
      rows,
      state: listState,
      title: `Every movement in ${name}`,
      emptyText: `Nothing is recorded in ${name} yet.`,
    })}

    ${card(`${verb} each month`, monthBars(monthSeries(id, 6)))}

    ${byAccountCard(rows)}

    ${cat && cat.kind === 'expense' ? card('How this total is counted', `
      <p class="prose">Money that comes back into a category lowers the cost of
      that category. Change from a purchase and a refund are both money that
      comes back, therefore the total above is the true cost and not the sum of
      the payments alone. The list shows the money that came back beside the
      money that went out.</p>`) : ''}
  `

  wire(host, cat, id, param, listState)
}

const kindWord = cat => ({ income: 'income', expense: 'spending',
                           transfer: 'transfer' }[cat.kind] || cat.kind)

/** The allowance, and how much of it is left. */
function budgetCard (cat, budget, spent, over) {
  const basis = cat.budget_basis === 'per_period' ? 'this pay period' : 'this month'
  const used = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
  const left = budget - spent

  return card('Your allowance', `
    <div class="cat-budget">
      <div class="cat-budget-head">
        <span>${fmt(spent)} of ${fmt(budget)} ${esc(basis)}</span>
        <span class="${over ? 'neg' : 'pos'}">
          ${over ? `${fmt(-left)} over` : `${fmt(left)} left`}</span>
      </div>
      <span class="cat-budget-track">
        <span class="cat-budget-fill ${over ? 'is-over' : ''}"
              style="width:${used.toFixed(0)}%;background:${esc(cat.color || 'var(--accent)')}"></span>
      </span>
      <p class="hint">
        ${cat.budget_basis === 'per_period'
          ? `This allowance arrives on every pay date, therefore a month holds
             ${fmt(cat.budget_amount * 2)}.`
          : 'This allowance arrives one time each month.'}
        ${cat.is_variable
          ? 'The home screen may propose a cut here when a period is short.'
          : 'The home screen never proposes a cut here.'}
      </p>
    </div>`)
}

/** Which accounts the money of this category came out of, or went into. */
function byAccountCard (rows) {
  const totals = new Map()
  for (const t of rows) {
    if (t.type !== 'expense' && t.type !== 'income') continue
    totals.set(t.account_id, (totals.get(t.account_id) || 0) + t.amount)
  }

  const list = [...totals.entries()]
    .map(([id, value]) => ({ id, name: store.accountById(id)?.name ?? 'A closed account',
                             value }))
    .filter(x => x.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const top = list.length ? Math.max(...list.map(x => Math.abs(x.value))) : 0

  return card('Which account it came from', list.length
    ? `<div class="acct-cats">
        ${list.map(x => `
          <button class="acct-cat is-tap" data-open-account="${esc(x.id)}">
            <span class="acct-cat-name">${esc(x.name)}</span>
            <span class="acct-cat-track">
              <span class="acct-cat-fill"
                    style="width:${top ? Math.max(3, (Math.abs(x.value) / top) * 100).toFixed(0) : 0}%"></span>
            </span>
            <span class="acct-cat-val ${x.value < 0 ? 'neg' : 'pos'}">${fmt(x.value)}</span>
          </button>`).join('')}
      </div>`
    : empty('No account holds a movement in this category yet.'))
}

/**
 * What this category moved in each of the last months.
 *
 * The figure of each month comes from store.categoryTotal, therefore a month
 * here agrees with the same month on the statistics screen.
 */
function monthSeries (id, count) {
  const now = D.today()
  const out = []
  for (let k = count - 1; k >= 0; k--) {
    const start = D.startOfMonth(D.addMonths(now, -k))
    const end = D.min(D.endOfMonth(start), now)
    out.push({
      label: D.fmtMonth(start).split(' ')[0],
      value: store.categoryTotal(id, start, end),
    })
  }
  return out
}

function wire (host, cat, id, param, listState) {
  wireTxList(host, listState, () => render(host, [param]))

  qs('#add-here', host)?.addEventListener('click', () => openQuickAdd({
    type: cat?.kind === 'income' ? 'income' : 'expense',
    category_id: id || '',
  }))

  qs('#edit-category', host)?.addEventListener('click', () => {
    if (cat) openCategorySheet(cat, { onDelete: () => { location.hash = '#/categories' } })
  })

  delegate(host, 'click', '[data-tx]', (e, node) => {
    const t = store.state.transactions.find(x => x.id === node.dataset.tx)
    if (t) openEditTransaction(t)
  })

  delegate(host, 'click', '[data-open-account]', (e, node) => {
    location.hash = `#/account/${node.dataset.openAccount}`
  })
}
