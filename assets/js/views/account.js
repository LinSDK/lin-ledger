// ============================================================================
// Lin Ledger : one account
//
// The home screen shows one card for each account. This screen opens behind
// that card, and it holds the breakdown: every movement of that account, and
// nothing from any other account.
//
// The list comes from views/tx-list.js, the same file that the home screen
// reads. Therefore the two lists group the days the same way and total them the
// same way, and a change to the rule reaches both.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, empty, delegate, qs } from '../ui.js'
import { openSetBalance, openTransfer, openEditTransaction, openAccountSheet }
  from './actions.js'
import { openQuickAdd } from './quick-add.js'
import { accountEmoji, openEmojiPicker } from '../emoji.js'
import { makeListState, txListCard, wireTxList } from './tx-list.js'

// One state for each account, so a person who returns finds the same view.
const listStates = new Map()
const stateFor = id => {
  if (!listStates.has(id)) listStates.set(id, makeListState(25))
  return listStates.get(id)
}

export async function render (host, params) {
  const id = params?.[0]
  const account = store.accountById(id)
  const balance = store.balanceOfAccount(id)

  if (!account) {
    host.innerHTML = empty('That account is not here any more.',
      '<a class="btn btn-primary" href="#/home">Back to the home screen</a>')
    return
  }

  // The bar at the top of the application carries the name of the account,
  // because "Account" alone says nothing on a screen that holds one of them.
  const title = qs('#top-title')
  if (title) title.textContent = account.name

  const rows = store.transactionsOfAccount(id)
  const listState = stateFor(id)
  const now = D.today()
  const monthStart = D.startOfMonth(now)
  const month = rows.filter(t => t.occurred_on >= monthStart)
  const monthOut = month.filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0)
  const monthIn = month.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0)
  const share = shareOfNetWorth(balance?.balance ?? 0)

  host.innerHTML = `
    <section class="hero acct-hero">
      <button class="acct-hero-emoji" data-emoji-for="${account.id}"
              aria-label="Change the mark of ${esc(account.name)}"
              title="Change the mark">${esc(accountEmoji(account))}</button>
      <div class="acct-hero-text">
        <p class="hero-label">${esc(account.name)}</p>
        <p class="hero-value ${(balance?.balance ?? 0) < 0 ? 'neg' : ''}">
          ${fmt(balance?.balance ?? 0)}</p>
        <p class="hero-note">
          ${share} of your net worth
          ${account.include_in_liquidity
            ? ' &middot; counted in the forecast'
            : ' &middot; left out of the forecast'}
        </p>
      </div>
    </section>

    <div class="pills">
      <div class="pill">
        <span class="pill-label">Start</span>
        <span class="pill-value">${fmt(account.opening_balance ?? 0)}</span>
        <span class="pill-sub">${account.opening_date
          ? D.fmtShort(account.opening_date) : 'no date'}</span>
      </div>
      <div class="pill">
        <span class="pill-label">Out this month</span>
        <span class="pill-value neg">${fmt(monthOut)}</span>
        <span class="pill-sub">${D.fmtMonth(now)}</span>
      </div>
      <div class="pill">
        <span class="pill-label">In this month</span>
        <span class="pill-value pos">${fmt(monthIn)}</span>
        <span class="pill-sub">${D.fmtMonth(now)}</span>
      </div>
    </div>

    <div class="stack">
      <button class="btn btn-primary btn-block" id="add-here">
        ${icon('plus')} Add a movement here</button>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" id="set-balance">
          ${icon('edit')} Set the balance</button>
        <button class="btn btn-ghost btn-sm" id="edit-account">
          Change the account</button>
        <button class="btn btn-ghost btn-sm" id="move-money">
          ${icon('swap')} Move money</button>
      </div>
    </div>

    ${txListCard({
      rows,
      state: listState,
      title: `Every movement of ${account.name}`,
      showAccount: false,
      emptyText: `${account.name} holds no movement yet.`,
    })}

    ${byCategoryCard(rows, monthStart, now)}

    ${card('How this balance works', `
      <p class="prose">The balance is the start balance plus every movement in
      this list. If your real account holds a different amount, use
      <strong>Set the balance</strong>. The ledger writes the difference as one
      adjustment, therefore you never have to find every payment that you
      forgot.</p>`)}
  `

  wire(host, account, listState)
}

/** The part of your net worth that sits in this account. */
function shareOfNetWorth (balance) {
  const worth = store.netWorth()
  if (!worth) return '0%'
  return Math.round((balance / worth) * 100) + '%'
}

/** Where the money of this account went this month, by category. */
function byCategoryCard (rows, from, to) {
  const totals = new Map()
  for (const t of rows) {
    if (t.occurred_on < from || t.occurred_on > to) continue
    if (t.type !== 'expense') continue
    totals.set(t.category_id, (totals.get(t.category_id) || 0) - t.amount)
  }

  const list = [...totals.entries()]
    .map(([id, value]) => ({ name: store.categoryById(id)?.name || 'Not in a category',
                             color: store.categoryById(id)?.color, value }))
    .filter(x => x.value !== 0)
    .sort((a, b) => b.value - a.value)

  const largest = list.length ? list[0].value : 0

  return card(`Spending from this account in ${D.fmtMonth(to)}`, list.length
    ? `<div class="acct-cats">
        ${list.map(x => `
          <div class="acct-cat">
            <span class="acct-cat-name">
              <i class="dot" style="background:${esc(x.color || 'var(--accent)')}"></i>
              ${esc(x.name)}</span>
            <span class="acct-cat-track">
              <span class="acct-cat-fill"
                    style="width:${largest ? Math.max(3, (x.value / largest) * 100).toFixed(0) : 0}%;
                           background:${esc(x.color || 'var(--accent)')}"></span>
            </span>
            <span class="acct-cat-val">${fmt(x.value)}</span>
          </div>`).join('')}
      </div>`
    : empty('No spending from this account this month.'))
}

function wire (host, account, listState) {
  wireTxList(host, listState, () => render(host, [account.id]))

  qs('#add-here', host)?.addEventListener('click',
    () => openQuickAdd({ account_id: account.id }))
  qs('#set-balance', host)?.addEventListener('click', () => openSetBalance(account))
  qs('#edit-account', host)?.addEventListener('click',
    () => openAccountSheet(account, { onDelete: () => { location.hash = '#/home' } }))
  qs('#move-money', host)?.addEventListener('click', () => openTransfer())

  delegate(host, 'click', '[data-emoji-for]', (e, node) => {
    const a = store.accountById(node.dataset.emojiFor)
    if (a) openEmojiPicker(a)
  })

  delegate(host, 'click', '[data-tx]', (e, node) => {
    const t = store.state.transactions.find(x => x.id === node.dataset.tx)
    if (t) openEditTransaction(t)
  })
}
