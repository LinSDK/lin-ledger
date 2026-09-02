// ============================================================================
// Lin Ledger : the list of accounts
//
// The home screen holds a card for each account, and that is where a person
// works. This screen is the full list: it holds the switch that keeps an
// account inside or outside the forecast, and it opens the form.
//
// Coins in a jar are money, but they are not money that pays a bill, therefore
// the switch exists and the person decides.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, empty, toast, delegate, qs } from '../ui.js'
import { openSetBalance, openTransfer, openAccountSheet, ACCOUNT_KINDS }
  from './actions.js'
import { accountEmoji, openEmojiPicker } from '../emoji.js'

export async function render (host) {
  const st = store.state
  const rows = st.balances.filter(b => !b.is_archived)
  const counted = rows.filter(b => b.include_in_liquidity)
  const left = rows.filter(b => !b.include_in_liquidity)

  host.innerHTML = `
    <section class="hero hero-sm">
      <p class="hero-label">Net worth</p>
      <p class="hero-value">${fmt(store.netWorth())}</p>
      <p class="hero-note">
        ${fmt(counted.reduce((a, b) => a + b.balance, 0))} counts in the forecast.
        ${left.length
          ? `${fmt(left.reduce((a, b) => a + b.balance, 0))} sits outside it.`
          : ''}
      </p>
    </section>

    ${rows.length ? rows.map(accountCard).join('') : empty('You have no account yet.')}

    <div class="stack">
      <button class="btn btn-ghost btn-block" id="add">
        ${icon('plus')} Add an account</button>
      <button class="btn btn-ghost btn-block" id="move">
        ${icon('swap')} Move money between accounts</button>
    </div>

    ${card('How a balance works', `
      <p class="prose">The balance of an account is its start balance plus every
      money movement that you record. If the true balance is different, use
      <strong>Set the balance</strong>. The ledger writes the difference as one
      adjustment, therefore you never need to find every missing payment.</p>
    `)}`

  qs('#add', host)?.addEventListener('click', () => openAccountSheet(null))
  qs('#move', host)?.addEventListener('click', () => openTransfer())

  delegate(host, 'click', '[data-emoji-for]', (e, node) => {
    e.stopPropagation()
    const a = store.accountById(node.dataset.emojiFor)
    if (a) openEmojiPicker(a)
  })
  delegate(host, 'click', '[data-open]', (e, node) => {
    location.hash = `#/account/${node.dataset.open}`
  })
  delegate(host, 'click', '[data-set]', (e, node) => {
    e.stopPropagation()
    const a = store.accountById(node.dataset.set)
    if (a) openSetBalance(a)
  })
  delegate(host, 'click', '[data-edit]', (e, node) => {
    e.stopPropagation()
    const a = store.accountById(node.dataset.edit)
    if (a) openAccountSheet(a, { onDelete: () => store.refresh() })
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
  const account = store.accountById(b.account_id)
  const recent = store.transactionsOfAccount(b.account_id).slice(0, 3)

  return `
  <section class="card card-account">
    <header class="card-head">
      <button class="acct-emoji acct-emoji-sm" data-emoji-for="${b.account_id}"
              aria-label="Change the mark of ${esc(b.name)}"
              title="Change the mark">${esc(accountEmoji(account || b))}</button>
      <h3>${esc(b.name)}</h3>
      <span class="muted">${esc(ACCOUNT_KINDS.find(k => k.value === b.kind)?.label
                                || b.kind)}</span>
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
          <span class="muted">${D.fmtShort(t.occurred_on)}${D.clockOf(t)
            ? ' ' + D.fmtTime(D.clockOf(t)) : ''}</span>
          <span class="${t.amount < 0 ? 'neg' : 'pos'}">${fmt(t.amount)}</span>
        </div>`).join('')}
      </div>` : ''}

      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-open="${b.account_id}">
          Every movement</button>
        <button class="btn btn-ghost btn-sm" data-set="${b.account_id}">
          ${icon('edit')} Set the balance</button>
        <button class="btn btn-ghost btn-sm" data-edit="${b.account_id}">
          Change the account</button>
      </div>
    </div>
  </section>`
}
