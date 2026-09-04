// ============================================================================
// Lin Ledger : the actions that more than one screen needs
//
// Each action opens a sheet, writes to the database, then reloads the data.
// The screens draw themselves again, because the store tells them to.
// ============================================================================

import * as store from '../store.js'
import { formSheet, confirmSheet, toast, esc, icon } from '../ui.js'
import { fmt } from '../money.js'
import { today, clockOf, withClock, fmtDate, fmtTime } from '../dates.js'

const accountOptions = () => store.state.accounts
  .filter(a => !a.is_archived)
  .map(a => ({ value: a.id, label: a.name }))

const categoryOptions = (kind = 'expense') => [
  { value: '', label: '(none)' },
  ...store.state.categories
    .filter(c => !c.is_archived && (kind === 'all' || c.kind === kind))
    .map(c => ({ value: c.id, label: c.name })),
]

const balanceOf = id =>
  store.state.balances.find(b => b.account_id === id)?.balance ?? 0

// ---------------------------------------------------------------------------
// Pay a bill
// ---------------------------------------------------------------------------

export function openPayBill (bill) {
  formSheet({
    title: `Pay ${bill.name}`,
    submitLabel: 'Record the payment',
    fields: [
      { name: 'amount', label: 'Amount paid', type: 'money', required: true,
        hint: bill.is_estimate
          ? 'This bill is an estimate. Type the real amount.'
          : `The plan says ${fmt(bill.expected_amount)}.` },
      { name: 'date', label: 'Date paid', type: 'date', required: true },
      { name: 'account_id', label: 'Paid from', type: 'select',
        options: accountOptions() },
    ],
    values: {
      amount: bill.expected_amount,
      date: today(),
      account_id: bill.account_id || store.state.accounts[0]?.id,
    },
    onSubmit: async v => {
      await store.payBill(bill, {
        amount: v.amount, date: v.date, accountId: v.account_id,
      })
      await store.refresh()
      toast(`${bill.name} is paid.`, 'ok')
    },
  })
}

export function openBillMenu (bill) {
  const isPaid = bill.status === 'paid'
  formSheet({
    title: bill.name,
    submitLabel: 'Save the change',
    size: 'md',
    fields: [
      { name: 'info', label: 'Now', type: 'static',
        render: () => `${esc(bill.status)} &middot; due ${fmtDate(bill.due_date)}`
          + (bill.actual_amount !== null && bill.actual_amount !== undefined
             ? ` &middot; paid ${fmt(bill.actual_amount)}` : '') },
      { name: 'expected_amount', label: 'Amount', type: 'money', required: true },
      { name: 'due_date', label: 'Due date', type: 'date', required: true },
      { name: 'category_id', label: 'Category', type: 'select',
        options: categoryOptions('expense') },
      { name: 'account_id', label: 'Pay from', type: 'select', options: accountOptions() },
      { name: 'is_estimate', label: '', type: 'switch',
        onLabel: 'The amount changes each time' },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: {
      expected_amount: bill.expected_amount, due_date: bill.due_date,
      category_id: bill.category_id || '', account_id: bill.account_id || '',
      is_estimate: bill.is_estimate, notes: bill.notes || '',
    },
    extraFooter: `
      <div class="row-actions">
        ${isPaid
          ? `<button type="button" class="btn btn-ghost" data-act="unpay">Not paid after all</button>`
          : `<button type="button" class="btn btn-ghost" data-act="skip">Skip this one</button>`}
        <button type="button" class="btn btn-danger-ghost" data-act="delete">Delete</button>
      </div>`,
    onSubmit: async v => {
      await store.updateScheduled(bill.id, {
        expected_amount: v.expected_amount, due_date: v.due_date,
        category_id: v.category_id || null, account_id: v.account_id || null,
        is_estimate: v.is_estimate, notes: v.notes,
      })
      await store.refresh()
      toast('The bill is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        const act = e.target.closest('[data-act]')?.dataset.act
        if (!act) return
        try {
          if (act === 'unpay') { await store.unpayBill(bill); toast('The payment is removed.', 'ok') }
          if (act === 'skip')  { await store.skipBill(bill.id); toast('The bill is skipped.', 'ok') }
          if (act === 'delete') {
            const ok = await confirmSheet({
              title: 'Delete this bill?',
              message: 'This removes only this one row. The rule stays.',
              confirmLabel: 'Delete', danger: true,
            })
            if (!ok) return
            await store.deleteScheduled(bill.id)
            toast('The bill is deleted.', 'ok')
          }
          sheet.close()
          await store.refresh()
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Pay one installment of a loan
// ---------------------------------------------------------------------------

export function openPayInstallment (row) {
  const loan = store.loanById(row.loan_id)
  formSheet({
    title: `${loan?.name ?? 'Loan'} payment ${row.installment_no}`,
    submitLabel: 'Record the payment',
    fields: [
      { name: 'amount', label: 'Amount paid', type: 'money', required: true,
        hint: `Due ${fmt(row.amount_due)} on ${fmtDate(row.due_date)}. `
            + `Of that, ${fmt(row.interest_component)} is interest.` },
      { name: 'date', label: 'Date paid', type: 'date', required: true },
      { name: 'account_id', label: 'Paid from', type: 'select', options: accountOptions() },
    ],
    values: {
      amount: row.amount_due, date: today(),
      account_id: loan?.account_id || store.state.accounts[0]?.id,
    },
    onSubmit: async v => {
      await store.payInstallment(row, {
        amount: v.amount, date: v.date, accountId: v.account_id,
      })
      await store.refresh()
      toast('The payment is recorded.', 'ok')
    },
  })
}

// ---------------------------------------------------------------------------
// The pay that arrived
// ---------------------------------------------------------------------------

export function openReceivePayroll (event) {
  const expected = event.expected_amount
  formSheet({
    title: 'Pay received',
    submitLabel: 'Record the pay',
    fields: [
      { name: 'amount', label: 'Amount received', type: 'money', required: true,
        hint: `You expected ${fmt(expected)} on ${fmtDate(event.expected_date)}.` },
      { name: 'date', label: 'Date received', type: 'date', required: true },
      { name: 'account_id', label: 'Received in', type: 'select', options: accountOptions() },
      { name: 'diff', label: 'Difference', type: 'static',
        render: v => {
          const got = v.amount ?? 0
          const d = got - expected
          if (!v.amount) return '<span class="muted">Type the amount.</span>'
          if (d === 0) return '<span class="pos">The same as the estimate.</span>'
          return d > 0
            ? `<span class="pos">${fmt(d)} more than the estimate.</span>`
            : `<span class="neg">${fmt(-d)} less than the estimate.</span>`
        } },
    ],
    values: {
      amount: expected, date: today(),
      account_id: event.account_id || store.state.profile?.payroll_account_id
                  || store.state.accounts[0]?.id,
    },
    onSubmit: async v => {
      await store.receivePayroll(event, {
        amount: v.amount, date: v.date, accountId: v.account_id,
      })
      await store.refresh()
      toast('The pay is recorded.', 'ok')
    },
  })
}

// ---------------------------------------------------------------------------
// Set the true balance of an account
// ---------------------------------------------------------------------------

/**
 * Writes the difference as an adjustment. The user does not need to enter every
 * missing payment, therefore the balance can always match the bank.
 */
export function openSetBalance (account) {
  const current = balanceOf(account.id)
  formSheet({
    title: `Set the balance of ${account.name}`,
    submitLabel: 'Set the balance',
    fields: [
      { name: 'target', label: 'The balance now', type: 'money', required: true,
        hint: `This ledger says ${fmt(current)}. Type what your account really holds.` },
      { name: 'note', label: 'Note', type: 'text', placeholder: 'Balance set by hand' },
      { name: 'diff', label: 'The adjustment', type: 'static',
        render: v => {
          if (v.target === null || v.target === undefined) return '<span class="muted">--</span>'
          const d = v.target - current
          if (d === 0) return 'No change is necessary.'
          return d > 0
            ? `<span class="pos">Adds ${fmt(d)}</span>`
            : `<span class="neg">Removes ${fmt(-d)}</span>`
        } },
    ],
    values: { target: current, note: '' },
    onSubmit: async v => {
      await store.setAccountBalance(account.id, v.target, v.note)
      await store.refresh()
      toast(`${account.name} is now ${fmt(v.target)}.`, 'ok')
    },
  })
}

// ---------------------------------------------------------------------------
// Move money between two accounts
// ---------------------------------------------------------------------------

export function openTransfer () {
  const options = accountOptions()
  if (options.length < 2) {
    toast('You need two accounts to move money.', 'error')
    return
  }
  formSheet({
    title: 'Move money',
    submitLabel: 'Move the money',
    fields: [
      { name: 'from', label: 'From', type: 'select', options, required: true },
      { name: 'to', label: 'To', type: 'select', options, required: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'note', label: 'Note', type: 'text' },
    ],
    values: { from: options[0].value, to: options[1].value, date: today() },
    onSubmit: async v => {
      if (v.from === v.to) throw new Error('Choose two different accounts.')
      await store.createTransfer({
        fromId: v.from, toId: v.to, amount: v.amount, date: v.date, note: v.note,
      })
      await store.refresh()
      toast('The money is moved.', 'ok')
    },
  })
}

// ---------------------------------------------------------------------------
// Add or change an account
// ---------------------------------------------------------------------------

export const ACCOUNT_KINDS = [
  { value: 'bank', label: 'Bank' },
  { value: 'wallet', label: 'Digital wallet' },
  { value: 'cash', label: 'Cash' },
  { value: 'coins', label: 'Coins' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit' },
  { value: 'other', label: 'Other' },
]

export const ACCOUNT_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444',
                               '#a855f7', '#6366f1', '#14b8a6', '#64748b']

/**
 * The sheet that adds an account or changes one.
 *
 * Three screens open this sheet: the "+" card of the home screen, the account
 * screen and the accounts list. It lives here and not in one of those files,
 * because a form that two screens hold twice becomes two different forms.
 *
 * The emoji is not in this form. The card on the home screen changes it with
 * one tap, and a person who wants a different mark does not want a form.
 */
export function openAccountSheet (account, { onDelete } = {}) {
  const isNew = !account
  formSheet({
    title: isNew ? 'Add an account' : `Change ${account.name}`,
    submitLabel: isNew ? 'Add the account' : 'Save',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true,
        placeholder: 'GCash, BDO, Cash, Coins' },
      { name: 'kind', label: 'Type', type: 'select', options: ACCOUNT_KINDS },
      { name: 'institution', label: 'Bank or company', type: 'text' },
      { name: 'opening_balance', label: 'Balance at the start', type: 'money',
        required: true,
        hint: isNew ? 'Type what the account holds now.'
                    : 'Change this only to correct a mistake. To match the bank, '
                    + 'use "Set the balance" instead.' },
      { name: 'opening_date', label: 'Date of that balance', type: 'date' },
      { name: 'color', label: 'Colour', type: 'select',
        options: ACCOUNT_COLORS.map(c => ({ value: c, label: c })) },
      { name: 'include_in_liquidity', label: '', type: 'switch',
        onLabel: 'Count this in the forecast' },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: account || {
      kind: 'wallet', include_in_liquidity: true, opening_balance: 0,
      opening_date: today(),
      color: ACCOUNT_COLORS[store.state.accounts.length % ACCOUNT_COLORS.length],
    },
    extraFooter: isNew ? '' : `
      <div class="row-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">Delete</button>
      </div>`,
    onSubmit: async v => {
      const patch = {
        name: v.name, kind: v.kind, institution: v.institution,
        opening_balance: v.opening_balance ?? 0,
        opening_date: v.opening_date || null,
        color: v.color, include_in_liquidity: v.include_in_liquidity,
        notes: v.notes,
      }
      if (isNew) {
        patch.sort_order = store.state.accounts.length + 1
        await store.createAccount(patch)
      } else {
        await store.updateAccount(account.id, patch)
      }
      await store.refresh()
      toast(isNew ? 'The account is added.' : 'The account is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        if (!e.target.closest('[data-act="delete"]')) return
        const ok = await confirmSheet({
          title: `Delete ${account.name}?`,
          message: 'Every money movement in this account goes away too. This '
                 + 'cannot be undone.',
          confirmLabel: 'Delete', danger: true,
        })
        if (!ok) return
        try {
          await store.deleteAccount(account.id)
          sheet.close()
          await store.refresh()
          toast('The account is deleted.', 'ok')
          // The account screen must not stay open with no account behind it.
          onDelete ? onDelete() : (location.hash = '#/home')
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Add or change a category
// ---------------------------------------------------------------------------

export const CATEGORY_COLORS = ['#22c55e', '#0ea5e9', '#f59e0b', '#ef4444',
                                '#a855f7', '#6366f1', '#14b8a6', '#64748b',
                                '#ec4899', '#84cc16']

/**
 * The sheet that adds a category or changes one.
 *
 * Two fields decide how the forecast treats a category:
 *   budget_basis  says if the amount belongs to a pay period or to a month.
 *   is_variable   says if the advisor may propose a cut in that category.
 *
 * Rent is not variable, because you cannot decide to pay less rent. Food is
 * variable, because you can.
 *
 * The list screen and the screen of one category both open this sheet. It lives
 * here for the same reason as the account sheet: a form that two screens hold
 * twice becomes two different forms.
 */
export function openCategorySheet (cat, { onDelete } = {}) {
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
        options: CATEGORY_COLORS.map(c => ({ value: c, label: c })) },
      { name: 'preview', label: 'Each month this is', type: 'static',
        when: v => v.kind === 'expense' && v.budget_amount,
        render: v => v.budget_amount
          ? fmt(v.budget_basis === 'per_period' ? v.budget_amount * 2 : v.budget_amount)
          : '--' },
    ],
    values: cat || {
      kind: 'expense', budget_basis: 'per_period', is_variable: true,
      color: CATEGORY_COLORS[store.state.categories.length % CATEGORY_COLORS.length],
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
          // The screen of one category must not stay open with none behind it.
          onDelete?.()
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// A bill that happens one time only
// ---------------------------------------------------------------------------

export function openAddBill (defaults = {}) {
  formSheet({
    title: 'Add a bill',
    submitLabel: 'Add the bill',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'expected_amount', label: 'Amount', type: 'money', required: true },
      { name: 'due_date', label: 'Due date', type: 'date', required: true },
      { name: 'category_id', label: 'Category', type: 'select',
        options: categoryOptions('expense') },
      { name: 'account_id', label: 'Pay from', type: 'select', options: accountOptions() },
      { name: 'is_estimate', label: '', type: 'switch',
        onLabel: 'The amount is an estimate' },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: { due_date: today(), account_id: store.state.accounts[0]?.id, ...defaults },
    onSubmit: async v => {
      await store.createScheduled({
        name: v.name, expected_amount: v.expected_amount, due_date: v.due_date,
        category_id: v.category_id || null, account_id: v.account_id || null,
        is_estimate: v.is_estimate, notes: v.notes, status: 'pending',
        is_overridden: true,
      })
      await store.refresh()
      toast('The bill is added.', 'ok')
    },
  })
}

// ---------------------------------------------------------------------------
// Change or remove a money movement
// ---------------------------------------------------------------------------

/**
 * Opens one money movement.
 *
 * A movement that came from a bill, a loan payment or a pay day carries a link
 * to that row. The sheet says so, and it sends the user to the correct screen,
 * because a change here alone would leave the two records different.
 */
export function openEditTransaction (tx) {
  const linked = findLink(tx)
  const clock = clockOf(tx)
  const isTransfer = tx.type === 'transfer_in' || tx.type === 'transfer_out'
  const kind = tx.type === 'income' ? 'income' : 'expense'

  formSheet({
    title: tx.description || 'Money movement',
    submitLabel: 'Save',
    fields: [
      ...(linked ? [{ name: 'link', label: '', type: 'static', render: () => `
        <p class="note">${icon('info')} This movement belongs to
        <strong>${esc(linked.label)}</strong>. To undo it, open
        <a href="${linked.href}">${esc(linked.screen)}</a> and remove the payment
        there. A change here alone would leave the two records different.</p>` }] : []),
      ...(isTransfer ? [{ name: 'moved', label: '', type: 'static', render: () => `
        <p class="note">${icon('warn')} This movement is one half of a transfer.
        Delete it, then make the transfer again.</p>` }] : []),
      { name: 'amount', label: 'Amount', type: 'money', required: true,
        hint: kind === 'income' ? 'Money that came in.' : 'Money that went out.' },
      { name: 'occurred_on', label: 'Date', type: 'date', required: true },
      { name: 'clock', label: 'Time', type: 'time',
        hint: clock
          ? `This movement happened at ${fmtTime(clock)}.`
          : 'This movement carries no time. Set one to put it in order inside '
            + 'its day. The date alone decides every money figure.' },
      { name: 'description', label: 'What was it for', type: 'text' },
      { name: 'category_id', label: 'Category', type: 'select',
        options: categoryOptions(isTransfer ? 'all' : kind) },
      { name: 'account_id', label: 'Account', type: 'select', options: accountOptions() },
    ],
    values: {
      amount: Math.abs(tx.amount), occurred_on: tx.occurred_on,
      clock: clock || '',
      description: tx.description || '', category_id: tx.category_id || '',
      account_id: tx.account_id,
    },
    extraFooter: `
      <div class="row-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">
          Delete this movement</button>
      </div>`,
    onSubmit: async v => {
      const size = Math.abs(v.amount || 0)
      if (!size) throw new Error('Type an amount above zero.')
      // The sign follows the type, therefore a balance can never drift.
      const signed = (tx.type === 'income' || tx.type === 'transfer_in') ? size
                   : tx.type === 'adjustment' ? (tx.amount < 0 ? -size : size)
                   : -size
      // A time that a person typed goes into created_at, with the date beside
      // it. An empty box writes nothing, therefore a movement that never had a
      // clock does not gain a false one.
      const patch = {
        amount: signed, occurred_on: v.occurred_on,
        description: v.description,
        category_id: v.category_id || null, account_id: v.account_id,
      }
      if (v.clock) patch.created_at = withClock(v.occurred_on, v.clock)
      await store.updateTransaction(tx.id, patch)
      await store.refresh()
      toast('The movement is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        if (!e.target.closest('[data-act="delete"]')) return
        const ok = await confirmSheet({
          title: 'Delete this movement?',
          message: linked
            ? `This removes ${fmt(Math.abs(tx.amount))} from ${accountName(tx.account_id)}. `
              + `${linked.label} then stays marked as paid, with no money behind it.`
            : `This removes ${fmt(Math.abs(tx.amount))} from ${accountName(tx.account_id)}.`,
          confirmLabel: 'Delete', danger: true,
        })
        if (!ok) return
        try {
          await store.deleteTransaction(tx.id)
          sheet.close()
          await store.refresh()
          toast('The movement is deleted.', 'ok')
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}

const accountName = id => store.accountById(id)?.name ?? 'the account'

/** Finds the bill, the loan payment or the pay day that owns a movement. */
function findLink (tx) {
  const bill = store.state.scheduled.find(b => b.transaction_id === tx.id)
  if (bill) {
    return { label: `the bill "${bill.name}"`, href: '#/bills', screen: 'Bills' }
  }
  const inst = store.state.loanPayments.find(p => p.transaction_id === tx.id)
  if (inst) {
    const loan = store.loanById(inst.loan_id)
    return { label: `payment ${inst.installment_no} of ${loan?.name ?? 'a loan'}`,
             href: `#/loans/${inst.loan_id}`, screen: 'that loan' }
  }
  const pay = store.state.payroll.find(p => p.transaction_id === tx.id)
  if (pay) {
    return { label: `the pay of ${fmtDate(pay.actual_date || pay.expected_date)}`,
             href: '#/payroll', screen: 'Payroll' }
  }
  return null
}
