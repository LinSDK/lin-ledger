// ============================================================================
// Lin Ledger : categories and budgets
//
// Two fields decide how the forecast treats a category:
//   budget_basis  says if the amount belongs to a pay period or to a month.
//   is_variable   says if the advisor may propose a cut in that category.
//
// Rent is not variable, because you cannot decide to pay less rent. Food is
// variable, because you can.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, listRow, empty, money, toast, delegate, qs,
         formSheet, confirmSheet } from '../ui.js'

const COLORS = ['#22c55e', '#0ea5e9', '#f59e0b', '#ef4444', '#a855f7',
                '#6366f1', '#14b8a6', '#64748b', '#ec4899', '#84cc16']

export async function render (host) {
  const st = store.state
  const now = D.today()
  const monthStart = D.startOfMonth(now)
  const periodStart = store.currentPeriodStart(now)

  const spentMonth = store.spentByCategory(monthStart, now)
  const spentPeriod = store.spentByCategory(periodStart, now)

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
      list.map(c => categoryRow(c, spentMonth, spentPeriod)).join(''))).join('')}

    <button class="btn btn-ghost btn-block" id="add">
      ${icon('plus')} Add a category</button>

    ${card('How the advice works', `
      <p class="prose">When a pay period does not hold enough money, the home
      screen proposes a cut. It only proposes a cut in a category that you marked
      as variable, and the size of each cut follows the size of each allowance.
      Therefore a large allowance gives more than a small one.</p>
    `)}`

  qs('#add', host)?.addEventListener('click', () => openCategory(null))
  delegate(host, 'click', '[data-cat]', (e, node) => {
    openCategory(store.categoryById(node.dataset.cat))
  })
}

function categoryRow (c, spentMonth, spentPeriod) {
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

function openCategory (cat) {
  const isNew = !cat
  formSheet({
    title: isNew ? 'Add a category' : `Change ${cat.name}`,
    submitLabel: isNew ? 'Add' : 'Save',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'kind', label: 'Type', type: 'segment', options: [
        { value: 'expense', label: 'Spending' },
        { value: 'income', label: 'Income' },
        { value: 'transfer', label: 'Transfer' }] },
      { name: 'group_name', label: 'Group', type: 'text',
        placeholder: 'Essentials, Lifestyle, Debt' },
      { name: 'budget_amount', label: 'Allowance', type: 'money',
        when: v => v.kind === 'expense',
        hint: 'Leave this empty if the category has no allowance.' },
      { name: 'budget_basis', label: 'That allowance is for', type: 'segment',
        when: v => v.kind === 'expense' && v.budget_amount,
        options: [{ value: 'per_period', label: 'each pay period' },
                  { value: 'per_month', label: 'each month' }] },
      { name: 'is_variable', label: '', type: 'switch',
        when: v => v.kind === 'expense',
        onLabel: 'The advisor may propose a cut here' },
      { name: 'color', label: 'Colour', type: 'select',
        options: COLORS.map(c => ({ value: c, label: c })) },
      { name: 'preview', label: 'Each month this is', type: 'static',
        when: v => v.kind === 'expense' && v.budget_amount,
        render: v => v.budget_amount
          ? fmt(v.budget_basis === 'per_period' ? v.budget_amount * 2 : v.budget_amount)
          : '--' },
    ],
    values: cat || {
      kind: 'expense', budget_basis: 'per_period', is_variable: true,
      color: COLORS[store.state.categories.length % COLORS.length],
    },
    extraFooter: isNew ? '' : `
      <div class="row-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">Delete</button>
      </div>`,
    onSubmit: async v => {
      const patch = {
        name: v.name, kind: v.kind, group_name: v.group_name,
        budget_amount: v.kind === 'expense' ? v.budget_amount : null,
        budget_basis: v.budget_basis || 'per_month',
        is_variable: v.kind === 'expense' ? !!v.is_variable : false,
        color: v.color,
      }
      if (isNew) {
        patch.sort_order = store.state.categories.length + 1
        await store.createCategory(patch)
      } else {
        await store.updateCategory(cat.id, patch)
      }
      await store.refresh()
      toast(isNew ? 'The category is added.' : 'The category is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        if (!e.target.closest('[data-act="delete"]')) return
        const ok = await confirmSheet({
          title: `Delete ${cat.name}?`,
          message: 'Money movements in this category stay, but they lose the '
                 + 'category. The statistics then group them as "not in a category".',
          confirmLabel: 'Delete', danger: true,
        })
        if (!ok) return
        try {
          await store.deleteCategory(cat.id)
          sheet.close()
          await store.refresh()
          toast('The category is deleted.', 'ok')
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}
