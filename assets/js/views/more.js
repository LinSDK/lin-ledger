// ============================================================================
// Lin Ledger : the "More" hub
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, listRow, money, qs, delegate } from '../ui.js'
import { openTransfer, openAddBill } from './actions.js'
import { openBatchAdd } from './batch-add.js'

export async function render (host) {
  const st = store.state
  const open = st.payroll.filter(p => p.status === 'expected').length
  const variable = st.categories.filter(c => c.is_variable && c.budget_amount).length

  host.innerHTML = `
    ${card('Your money', [
      listRow({ title: 'Accounts', sub: `${st.accounts.length} sources of money`,
                right: money(store.liquidity()), attrs: 'data-go="#/accounts"' }),
      listRow({ title: 'Categories and budgets',
                sub: `${st.categories.length} categories, ${variable} with an allowance`,
                attrs: 'data-go="#/categories"' }),
      listRow({ title: 'Payroll', sub: `${open} pay date${open === 1 ? '' : 's'} ahead`,
                attrs: 'data-go="#/payroll"' }),
    ].join(''))}

    ${card('Plan ahead', [
      listRow({ title: 'What if', sub: 'Test a new loan or a large purchase',
                attrs: 'data-go="#/scenarios"' }),
    ].join(''))}

    ${card('Quick actions', [
      listRow({ title: 'Add several movements',
                sub: 'One list, many accounts, one save',
                attrs: 'data-act="batch"' }),
      listRow({ title: 'Move money between accounts', attrs: 'data-act="transfer"' }),
      listRow({ title: 'Add a bill', attrs: 'data-act="bill"' }),
    ].join(''))}

    ${card('The application', [
      listRow({ title: 'Settings', sub: 'Currency, buffer, forecast, theme',
                attrs: 'data-go="#/settings"' }),
    ].join(''))}
  `

  delegate(host, 'click', '[data-go]', (e, node) => {
    location.hash = node.dataset.go
  })
  delegate(host, 'click', '[data-act]', (e, node) => {
    if (node.dataset.act === 'batch') openBatchAdd()
    if (node.dataset.act === 'transfer') openTransfer()
    if (node.dataset.act === 'bill') openAddBill()
  })
}
