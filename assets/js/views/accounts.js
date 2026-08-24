// ============================================================================
// Lin Ledger : accounts
//
// Each account has a switch that keeps it inside or outside the forecast. Coins
// in a jar are money, but they are not money that pays a bill, therefore the
// user decides.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, listRow, empty, money, toast, delegate, qs,
         formSheet, confirmSheet } from '../ui.js'
import { openSetBalance, openTransfer } from './actions.js'

const KINDS = [
  { value: 'bank', label: 'Bank' },
  { value: 'wallet', label: 'Digital wallet' },
  { value: 'cash', label: 'Cash' },
  { value: 'coins', label: 'Coins' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit' },
  { value: 'other', label: 'Other' },
]

const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
                '#6366f1', '#14b8a6', '#64748b']

export async function render (host) {
  const st = store.state
  const rows = st.balances.filter(b => !b.is_archived)
  const counted = rows.filter(b => b.include_in_liquidity)
  const left = rows.filter(b => !b.include_in_liquidity)

  host.innerHTML = `
    <section class="hero hero-sm">
      <p class="hero-label">Counted in the forecast</p>
      <p class="hero-value">${fmt(counted.reduce((a, b) => a + b.balance, 0))}</p>
      ${left.length ? `<p class="hero-note">${fmt(left.reduce((a, b) => a + b.balance, 0))}
        sits outside the forecast.</p>` : ''}
    </section>

    ${rows.length ? rows.map(accountCard).join('') : empty('You have no account yet.')}

    <div class="stack">
      <button class="btn btn-ghost btn-block" id="add">
        ${icon('plus')} Add an account</button>
      <button class="btn btn-ghost btn-block" id="move">
        ${icon('refresh')} Move money between accounts</button>
    </div>

    ${card('How a balance works', `
      <p class="prose">The balance of an account is its start balance plus every
      money movement that you record. If the true balance is different, use
      <strong>Set the balance</strong>. The ledger writes the difference as one
      adjustment, therefore you never need to find every missing payment.</p>
    `)}`

  qs('#add', host)?.addEventListener('click', () => openAccount(null))
  qs('#move', host)?.addEventListener('click', () => openTransfer())

  delegate(host, 'click', '[data-set]', (e, node) => {
    e.stopPropagation()
    const a = store.accountById(node.dataset.set)
    if (a) openSetBalance(a)
  })
  delegate(host, 'click', '[data-edit]', (e, node) => {
    e.stopPropagation()
    const a = store.accountById(node.dataset.edit)
    if (a) openAccount(a)
  })
  delegate(host, 'click', '[data-toggle]', async (e, node) => {
    e.stopPropagation()
    const a = store.accountById(node.dataset.toggle)
    if (!a) return
    try {
      await store.updateAccount(a.id, { include_in_liquidity: !a.include_in_liquidity })
      await store.refresh()
    } catch (ex) { toast(ex.message, 'error') }
  })
}

function accountCard (b) {
  const recent = store.state.transactions
    .filter(t => t.account_id === b.account_id).slice(0, 3)
  return `
  <section class="card card-account">
    <header class="card-head">
      <h3><i class="dot" style="background:${esc(b.color || 'var(--accent)')}"></i>
        ${esc(b.name)}</h3>
      <span class="muted">${esc(KINDS.find(k => k.value === b.kind)?.label || b.kind)}</span>
    </header>
    <div class="card-body">
      <p class="acct-bal ${b.balance < 0 ? 'neg' : ''}">${fmt(b.balance)}</p>
      <p class="acct-sub">Start ${fmt(b.opening_balance)} &middot;
        ${b.tx_count} movement${b.tx_count === 1 ? '' : 's'}</p>

      <label class="switch switch-inline">
        <input type="checkbox" ${b.include_in_liquidity ? 'checked' : ''}
               data-toggle="${b.account_id}">
        <span class="switch-track"><span class="switch-knob"></span></span>
        <span class="switch-text">Count this in the forecast</span>
      </label>

      ${recent.length ? `<div class="mini-list">
        ${recent.map(t => `<div class="mini-row">
          <span>${esc(t.description || 'Movement')}</span>
          <span class="muted">${D.fmtShort(t.occurred_on)}</span>
          <span class="${t.amount < 0 ? 'neg' : 'pos'}">${fmt(t.amount)}</span>
        </div>`).join('')}
      </div>` : ''}

      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-set="${b.account_id}">
          ${icon('edit')} Set the balance</button>
        <button class="btn btn-ghost btn-sm" data-edit="${b.account_id}">
          Change the account</button>
      </div>
    </div>
  </section>`
}

function openAccount (account) {
  const isNew = !account
  formSheet({
    title: isNew ? 'Add an account' : `Change ${account.name}`,
    submitLabel: isNew ? 'Add the account' : 'Save',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true,
        placeholder: 'GCash, BDO, Cash, Coins' },
      { name: 'kind', label: 'Type', type: 'select', options: KINDS },
      { name: 'institution', label: 'Bank or company', type: 'text' },
      { name: 'opening_balance', label: 'Balance at the start', type: 'money',
        required: true,
        hint: isNew ? 'Type what the account holds now.'
                    : 'Change this only to correct a mistake. To match the bank, '
                    + 'use "Set the balance" instead.' },
      { name: 'opening_date', label: 'Date of that balance', type: 'date' },
      { name: 'color', label: 'Colour', type: 'select',
        options: COLORS.map(c => ({ value: c, label: c })) },
      { name: 'include_in_liquidity', label: '', type: 'switch',
        onLabel: 'Count this in the forecast' },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: account || {
      kind: 'wallet', include_in_liquidity: true, opening_balance: 0,
      opening_date: D.today(), color: COLORS[store.state.accounts.length % COLORS.length],
    },
    extraFooter: isNew ? '' : `
      <div class="row-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">Delete</button>
      </div>`,
    onSubmit: async v => {
      const patch = {
        name: v.name, kind: v.kind, institution: v.institution,
        opening_balance: v.opening_balance ?? 0, opening_date: v.opening_date || null,
        color: v.color, include_in_liquidity: v.include_in_liquidity, notes: v.notes,
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
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}
