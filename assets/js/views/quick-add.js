// ============================================================================
// Lin Ledger : the quick add sheet
//
// This is the button that a person uses most, therefore it opens with the
// amount field ready and it needs three taps at most.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import { today } from '../dates.js'
import { formSheet, toast, icon } from '../ui.js'
import { openTransfer } from './actions.js'
import { openBatchAdd } from './batch-add.js'
import { openSplitAdd } from './split-add.js'

export function openQuickAdd (defaults = {}) {
  const accounts = store.state.accounts.filter(a => !a.is_archived)
    .map(a => ({ value: a.id, label: a.name }))

  if (!accounts.length) {
    toast('Add an account first.', 'error')
    location.hash = '#/accounts'
    return
  }

  const catsFor = kind => [
    { value: '', label: '(none)' },
    ...store.state.categories
      .filter(c => !c.is_archived && c.kind === (kind === 'income' ? 'income' : 'expense'))
      .map(c => ({ value: c.id, label: c.name })),
  ]

  formSheet({
    title: 'Add',
    submitLabel: 'Save it',
    fields: [
      { name: 'type', label: '', type: 'segment', options: [
        { value: 'expense', label: 'Spent' },
        { value: 'income', label: 'Received' },
        { value: 'transfer', label: 'Moved' }] },
      { name: 'move', label: '', type: 'static',
        when: v => v.type === 'transfer',
        render: () => `<p class="prose">Moving money between two accounts needs
          both accounts. <button type="button" class="btn btn-ghost btn-sm"
          data-open-transfer>Open the transfer form</button></p>` },
      { name: 'amount', label: 'Amount', type: 'money', required: true,
        when: v => v.type !== 'transfer' },
      { name: 'account_id', label: 'Account', type: 'select', options: accounts,
        when: v => v.type !== 'transfer' },
      { name: 'category_id', label: 'Category', type: 'select',
        options: catsFor('expense'), when: v => v.type === 'expense' },
      { name: 'category_income', label: 'Category', type: 'select',
        options: catsFor('income'), when: v => v.type === 'income' },
      { name: 'occurred_on', label: 'Date', type: 'date', required: true,
        when: v => v.type !== 'transfer' },
      { name: 'description', label: 'What was it for', type: 'text',
        when: v => v.type !== 'transfer',
        placeholder: 'Groceries, load, fare' },
      { name: 'split', label: '', type: 'static',
        when: v => v.type !== 'transfer',
        render: () => `<button type="button" class="btn btn-ghost btn-block btn-sm"
          data-open-split>${icon('swap')} One purchase, several accounts</button>` },
      { name: 'many', label: '', type: 'static',
        when: v => v.type !== 'transfer',
        render: () => `<button type="button" class="btn btn-ghost btn-block btn-sm"
          data-open-batch>${icon('plus')} Add several without closing this</button>` },
    ],
    values: {
      type: 'expense', occurred_on: today(),
      account_id: defaults.account_id || accounts[0].value,
      ...defaults,
    },
    onSubmit: async v => {
      if (v.type === 'transfer') { openTransfer(); return }
      const amount = Math.abs(v.amount || 0)
      if (!amount) throw new Error('Type an amount above zero.')
      await store.createTransaction({
        account_id: v.account_id,
        category_id: (v.type === 'income' ? v.category_income : v.category_id) || null,
        type: v.type,
        amount: v.type === 'income' ? amount : -amount,
        occurred_on: v.occurred_on,
        description: v.description,
      })
      await store.refresh()
      toast(`${fmt(amount)} recorded.`, 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', e => {
        if (e.target.closest('[data-open-transfer]')) {
          sheet.close()
          openTransfer()
        }
        if (e.target.closest('[data-open-split]')) {
          const form = sheet.form
          const carry = {
            account_id: form?.elements?.account_id?.value,
            occurred_on: form?.elements?.occurred_on?.value,
            description: form?.elements?.description?.value,
            category_id: form?.elements?.category_id?.value,
          }
          sheet.close()
          openSplitAdd(carry)
          return
        }
        if (e.target.closest('[data-open-batch]')) {
          const form = sheet.form
          const carry = {
            type: form?.elements?.type?.value || 'expense',
            account_id: form?.elements?.account_id?.value,
            occurred_on: form?.elements?.occurred_on?.value,
          }
          sheet.close()
          openBatchAdd(carry)
        }
      })
    },
  })
}
