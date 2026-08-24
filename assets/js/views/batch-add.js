// ============================================================================
// Lin Ledger : add many movements in one sitting
//
// The single Add sheet asks for one movement, then it shuts. A person who
// records a day of spending would open it again for each item.
//
// This sheet keeps a list instead. You type an amount, you press Add, and the
// line goes to the list. The category, the account, the type and the date stay
// as you left them, therefore a run of items in the same account needs only an
// amount and a name for each one. Every line can use a different account.
//
// Nothing reaches the database until you press Save. One request then writes
// every line, therefore a failure leaves nothing behind.
// ============================================================================

import * as store from '../store.js'
import { fmt, parseMoney } from '../money.js'
import { today, fmtDate, fmtDay } from '../dates.js'
import { openSheet, icon, esc, toast, qs, qsa, delegate, confirmSheet } from '../ui.js'

const TYPES = [
  { value: 'expense', label: 'Spent' },
  { value: 'income', label: 'Received' },
]

export function openBatchAdd (defaults = {}) {
  const accounts = store.state.accounts.filter(a => !a.is_archived)
  if (!accounts.length) {
    toast('Add an account first.', 'error')
    location.hash = '#/accounts'
    return
  }

  // What the next line inherits. These values stay after each Add.
  const sticky = {
    type: defaults.type || 'expense',
    account_id: defaults.account_id || accounts[0].id,
    category_id: defaults.category_id || '',
    occurred_on: defaults.occurred_on || today(),
  }

  /** The lines that wait. Nothing here is in the database yet. */
  const queue = []

  const sheet = openSheet({
    title: 'Add several',
    size: 'lg',
    body: '<div id="batch"></div>',
    dismissable: false,   // a stray tap must not throw away the list
  })

  // A person who leaves with lines in the list would lose them, therefore the
  // close button asks first.
  const closeButton = qs('[data-close]', sheet.el)
  const realClose = sheet.close
  closeButton.replaceWith(closeButton.cloneNode(true))
  qs('[data-close]', sheet.el).addEventListener('click', async () => {
    if (queue.length === 0) { realClose(); return }
    const ok = await confirmSheet({
      title: `Leave ${queue.length} ${queue.length === 1 ? 'line' : 'lines'} unsaved?`,
      message: 'The list goes away, and nothing reaches the database.',
      confirmLabel: 'Leave', danger: true,
    })
    if (ok) realClose()
  })

  const categoriesFor = kind => [
    { value: '', label: '(no category)' },
    ...store.state.categories
      .filter(c => !c.is_archived && c.kind === (kind === 'income' ? 'income' : 'expense'))
      .map(c => ({ value: c.id, label: c.name })),
  ]

  const accountName = id => store.accountById(id)?.name ?? '?'
  const categoryName = id => store.categoryById(id)?.name ?? null
  const balanceOf = id =>
    store.state.balances.find(b => b.account_id === id)?.balance ?? 0

  /** The change that the list makes to each account. */
  function perAccount () {
    const map = new Map()
    for (const line of queue) {
      const delta = line.type === 'income' ? line.amount : -line.amount
      map.set(line.account_id, (map.get(line.account_id) || 0) + delta)
    }
    return [...map.entries()].map(([id, delta]) => ({
      id, name: accountName(id), delta,
      before: balanceOf(id), after: balanceOf(id) + delta,
    }))
  }

  function draw () {
    const out = queue.filter(l => l.type === 'expense').reduce((a, l) => a + l.amount, 0)
    const inn = queue.filter(l => l.type === 'income').reduce((a, l) => a + l.amount, 0)
    const accountRows = perAccount()
    const willGoNegative = accountRows.filter(a => a.after < 0)

    qs('#batch', sheet.el).innerHTML = `
      <div class="batch-entry">
        <div class="segment">
          ${TYPES.map(t => `<button type="button" class="seg ${t.value === sticky.type ? 'is-on' : ''}"
            data-type="${t.value}">${t.label}</button>`).join('')}
        </div>

        <div class="batch-line">
          <div class="field batch-amount">
            <label for="b-amount">Amount</label>
            <input id="b-amount" class="inp inp-money" type="text" inputmode="decimal"
                   placeholder="0.00" autocomplete="off" enterkeyhint="done">
          </div>
          <button type="button" class="btn btn-primary batch-add-btn" id="b-add">
            ${icon('plus')} Add</button>
        </div>

        <div class="field">
          <label for="b-desc">What was it for</label>
          <input id="b-desc" class="inp" type="text" autocomplete="off"
                 enterkeyhint="done" placeholder="Groceries, fare, load">
        </div>

        <div class="grid2">
          <div class="field">
            <label for="b-cat">Category</label>
            <select id="b-cat" class="inp">
              ${categoriesFor(sticky.type).map(o => `<option value="${esc(o.value)}"
                ${String(o.value) === String(sticky.category_id) ? 'selected' : ''}
                >${esc(o.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="b-acct">Account</label>
            <select id="b-acct" class="inp">
              ${accounts.map(a => `<option value="${a.id}"
                ${a.id === sticky.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="b-date">Date</label>
          <input id="b-date" class="inp" type="date" value="${sticky.occurred_on}">
        </div>

        <p class="hint">These four boxes keep their value after each Add.
          Therefore a run of items in one account needs only an amount and a name.
          Change the account on any line to record for a different account.</p>
      </div>

      <div class="batch-list">
        <div class="batch-list-head">
          <span>${queue.length ? `${queue.length} ${queue.length === 1 ? 'line' : 'lines'} ready`
                               : 'Nothing in the list yet'}</span>
          ${queue.length ? `<button type="button" class="btn btn-ghost btn-sm" id="b-clear">
            Clear the list</button>` : ''}
        </div>

        ${queue.length === 0
          ? `<p class="batch-empty">Type an amount, then press Add. The line comes
             here. Nothing reaches the database until you press Save.</p>`
          : queue.map((l, i) => `
            <div class="batch-row">
              <span class="dot" style="background:${esc(store.categoryById(l.category_id)?.color || 'var(--text-3)')}"></span>
              <span class="batch-row-main">
                <span class="batch-row-title">${esc(l.description || (l.type === 'income' ? 'Received' : 'Spent'))}</span>
                <span class="batch-row-sub">
                  ${categoryName(l.category_id) ? esc(categoryName(l.category_id)) + ' &middot; ' : ''}${esc(accountName(l.account_id))}
                  ${l.occurred_on !== today() ? ' &middot; ' + fmtDate(l.occurred_on) : ''}
                </span>
              </span>
              <span class="batch-row-amt ${l.type === 'income' ? 'pos' : 'neg'}">
                ${fmt(l.type === 'income' ? l.amount : -l.amount)}</span>
              <button type="button" class="btn-icon batch-del" data-del="${i}"
                      aria-label="Remove this line">${icon('close')}</button>
            </div>`).join('')}
      </div>

      ${queue.length ? `
        <div class="batch-sums">
          <div class="grid3">
            <div class="fact"><span>Out</span><strong class="neg">${fmt(out)}</strong></div>
            <div class="fact"><span>In</span><strong class="pos">${fmt(inn)}</strong></div>
            <div class="fact"><span>Net</span>
              <strong class="${inn - out < 0 ? 'neg' : 'pos'}">${fmt(inn - out)}</strong></div>
          </div>
          <div class="batch-accts">
            ${accountRows.map(a => `
              <div class="batch-acct">
                <span>${esc(a.name)}</span>
                <span class="${a.delta < 0 ? 'neg' : 'pos'}">${fmt(a.delta)}</span>
                <span class="muted">${fmt(a.before)} to
                  <strong class="${a.after < 0 ? 'neg' : ''}">${fmt(a.after)}</strong></span>
              </div>`).join('')}
          </div>
          ${willGoNegative.length ? `<p class="note">${icon('warn')}
            ${willGoNegative.map(a => esc(a.name)).join(' and ')}
            ${willGoNegative.length === 1 ? 'falls' : 'fall'} below zero with these
            lines. Check the amounts before you save.</p>` : ''}
        </div>` : ''}

      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-block" id="b-save"
                ${queue.length ? '' : 'disabled'}>
          ${icon('save')} ${queue.length
            ? `Save ${queue.length} ${queue.length === 1 ? 'line' : 'lines'}`
            : 'Save'}</button>
      </div>`

    wire()
  }

  /** Reads the entry boxes and puts one line in the list. */
  function addLine () {
    const amountInput = qs('#b-amount', sheet.el)
    const amount = parseMoney(amountInput.value)
    if (amount === null || Math.abs(amount) === 0) {
      amountInput.focus()
      amountInput.select?.()
      toast('Type an amount above zero.', 'error')
      return
    }

    sticky.type = qsa('[data-type]', sheet.el).find(b => b.classList.contains('is-on'))
      ?.dataset.type ?? sticky.type
    sticky.category_id = qs('#b-cat', sheet.el).value
    sticky.account_id = qs('#b-acct', sheet.el).value
    sticky.occurred_on = qs('#b-date', sheet.el).value || today()

    queue.push({
      type: sticky.type,
      amount: Math.abs(amount),
      account_id: sticky.account_id,
      category_id: sticky.category_id || null,
      occurred_on: sticky.occurred_on,
      description: qs('#b-desc', sheet.el).value.trim(),
    })

    draw()
    // The amount and the name clear. Everything else stays, therefore the next
    // line needs two boxes only.
    const next = qs('#b-amount', sheet.el)
    next.value = ''
    qs('#b-desc', sheet.el).value = ''
    if (!('ontouchstart' in window)) next.focus()
  }

  async function saveAll () {
    if (!queue.length) return
    const button = qs('#b-save', sheet.el)
    button.disabled = true
    button.classList.add('is-busy')
    try {
      const rows = queue.map(l => ({
        account_id: l.account_id,
        category_id: l.category_id,
        type: l.type,
        // The sign follows the type, the same rule that the rest of the
        // application uses.
        amount: l.type === 'income' ? l.amount : -l.amount,
        occurred_on: l.occurred_on,
        description: l.description || null,
      }))
      const made = await store.createTransactions(rows)
      await store.refresh()
      realClose()
      toast(`${made.length} ${made.length === 1 ? 'movement' : 'movements'} saved.`, 'ok')
    } catch (ex) {
      button.disabled = false
      button.classList.remove('is-busy')
      toast(ex.message, 'error', 6000)
    }
  }

  function wire () {
    qs('#b-add', sheet.el).addEventListener('click', addLine)
    qs('#b-save', sheet.el).addEventListener('click', saveAll)
    qs('#b-clear', sheet.el)?.addEventListener('click', () => {
      queue.length = 0
      draw()
    })

    // The Enter key adds a line, from the amount box or from the name box.
    for (const id of ['#b-amount', '#b-desc']) {
      qs(id, sheet.el).addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addLine() }
      })
    }

    delegate(sheet.el, 'click', '[data-type]', (e, b) => {
      qsa('[data-type]', sheet.el).forEach(x => x.classList.remove('is-on'))
      b.classList.add('is-on')
      // A category belongs to one kind, therefore the list changes with the type.
      sticky.type = b.dataset.type
      sticky.category_id = ''
      const amount = qs('#b-amount', sheet.el).value
      const desc = qs('#b-desc', sheet.el).value
      draw()
      qs('#b-amount', sheet.el).value = amount
      qs('#b-desc', sheet.el).value = desc
    })

    delegate(sheet.el, 'click', '[data-del]', (e, b) => {
      queue.splice(Number(b.dataset.del), 1)
      draw()
    })
  }

  draw()
  const first = qs('#b-amount', sheet.el)
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 140)
  return sheet
}
