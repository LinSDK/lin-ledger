// ============================================================================
// Lin Ledger : the list of categories
//
// This screen is the list. Select a category to open it, and the screen of that
// category holds every movement in it and the form that changes it.
//
// Two fields on a category decide how the forecast treats it. budget_basis says
// if the allowance belongs to a pay period or to a month, and is_variable says
// if the advisor may propose a cut. Rent is not variable, because you cannot
// decide to pay less rent. Food is variable, because you can.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, listRow, delegate, qs } from '../ui.js'
import { openCategorySheet } from './actions.js'

export async function render (host) {
  const st = store.state
  const now = D.today()
  const monthStart = D.startOfMonth(now)

  const spentMonth = store.spentByCategory(monthStart, now)

  const groups = {}
  for (const c of st.categories.filter(x => !x.is_archived)) {
    const key = c.group_name || 'Other'
    ;(groups[key] = groups[key] || []).push(c)
  }

  host.innerHTML = `
    <p class="pane-note">An allowance marked "each pay period" arrives on every
      pay date. An allowance marked "each month" arrives on the first pay date
      of the month.</p>

    ${Object.entries(groups).map(([name, list]) => card(name,
      list.map(c => categoryRow(c, spentMonth)).join(''))).join('')}

    <button class="btn btn-ghost btn-block" id="add">
      ${icon('plus')} Add a category</button>

    ${card('How the advice works', `
      <p class="prose">When a pay period does not hold enough money, the home
      screen proposes a cut. It only proposes a cut in a category that you marked
      as variable, and the size of each cut follows the size of each allowance.
      Therefore a large allowance gives more than a small one.</p>
    `)}`

  qs('#add', host)?.addEventListener('click', () => openCategorySheet(null))

  // A tap opens the category, and not the form. A person who taps a category
  // wants to know where the money went. The form sits inside that screen.
  delegate(host, 'click', '[data-cat]', (e, node) => {
    location.hash = `#/category/${node.dataset.cat}`
  })
}

function categoryRow (c, spentMonth) {
  const isIncome = c.kind === 'income'
  const perMonth = c.budget_amount
    ? (c.budget_basis === 'per_period' ? c.budget_amount * 2 : c.budget_amount)
    : null
  const used = spentMonth[c.id] || 0
  const over = perMonth && used > perMonth

  let sub = []
  if (c.budget_amount) {
    sub.push(`${fmt(c.budget_amount)} ${c.budget_basis === 'per_period'
      ? 'each pay period' : 'each month'}`)
  }
  if (c.is_variable && !isIncome) sub.push('can be cut')
  if (!c.is_variable && !isIncome) sub.push('fixed')

  return listRow({
    title: `<i class="dot" style="background:${esc(c.color || 'var(--accent)')}"></i>${esc(c.name)}`,
    sub: sub.join(' &middot; ') || (isIncome ? 'income' : 'no allowance'),
    right: used ? `<span class="${over ? 'neg' : ''}">${fmt(used)}</span>`
                : '<span class="muted">--</span>',
    rightSub: perMonth ? `of ${fmt(perMonth)} this month` : 'this month',
    attrs: `data-cat="${c.id}"`,
  })
}
