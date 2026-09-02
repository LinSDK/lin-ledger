// ============================================================================
// Lin Ledger : the Add sheet
//
// One form records one movement. A person who records a whole day of spending
// needs several, therefore the button at the bottom copies the form and puts
// the copy underneath. Each copy carries the account, the date and the category
// of the form above it, because those three rarely change inside one sitting.
//
// The whole list reaches the database with one request. Therefore a failure
// leaves nothing behind, and a half finished list cannot happen.
//
// Two things that earlier versions held are gone. There is no "Moved" choice
// here, because moving money between two accounts needs two accounts and that
// form lives on the account screen. There is no split sheet either. One form
// for each movement is enough, and a person who paid from two pockets writes
// two forms.
//
// The forms are real elements and they stay. Nothing here draws itself again
// while a person types, therefore no keystroke is ever lost.
// ============================================================================

import * as store from '../store.js'
import { fmt, parseMoney } from '../money.js'
import { today, nowTime } from '../dates.js'
import { openSheet, icon, esc, toast, qs, qsa, delegate, confirmSheet, h }
  from '../ui.js'

let uid = 0

export function openQuickAdd (defaults = {}) {
  const accounts = store.state.accounts.filter(a => !a.is_archived)
  if (!accounts.length) {
    toast('Add an account first.', 'error')
    location.hash = '#/accounts'
    return
  }

  const sheet = openSheet({
    title: 'Add',
    size: 'lg',
    dismissable: false,        // a stray tap must not throw away the forms
    body: `
      <div class="add-rows" id="add-rows"></div>

      <button type="button" class="btn btn-ghost btn-block" id="add-another">
        ${icon('plus')} Add another movement</button>

      <div id="add-sums"></div>

      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-block" id="add-save">
          ${icon('save')} Save</button>
      </div>`,
  })

  const rowsHost = qs('#add-rows', sheet.el)
  const sumsHost = qs('#add-sums', sheet.el)

  // ------------------------------------------------------------------------
  // The categories that each kind offers
  // ------------------------------------------------------------------------

  const categoriesFor = kind => [
    { value: '', label: '(no category)' },
    ...store.state.categories
      .filter(c => !c.is_archived && c.kind === (kind === 'income' ? 'income' : 'expense'))
      .map(c => ({ value: c.id, label: c.name })),
  ]

  const options = (list, selected) => list.map(o =>
    `<option value="${esc(o.value)}" ${String(o.value) === String(selected ?? '')
      ? 'selected' : ''}>${esc(o.label)}</option>`).join('')

  // ------------------------------------------------------------------------
  // One form
  // ------------------------------------------------------------------------

  /** Makes one form and puts it at the end of the list. */
  function addEntry (values = {}) {
    const n = ++uid
    const received = values.type === 'income'
    const node = h(`
      <section class="add-entry" data-entry>
        <header class="add-entry-head">
          <span class="add-entry-no"></span>
          <button type="button" class="btn-icon add-entry-del" data-del
                  aria-label="Remove this form">${icon('close')}</button>
        </header>

        <div class="add-line">
          <div class="field add-amount">
            <label for="a-amt-${n}">Amount</label>
            <input id="a-amt-${n}" class="inp inp-money ${received ? 'is-in' : 'is-out'}"
                   type="text" inputmode="decimal" autocomplete="off"
                   enterkeyhint="done" placeholder="0.00" data-amount>
          </div>
          <label class="add-kind" for="a-kind-${n}"
                 title="Leave this empty for money that went out. Tick it for money that came in.">
            <input id="a-kind-${n}" type="checkbox" data-received ${received ? 'checked' : ''}>
            <span class="switch-track"><span class="switch-knob"></span></span>
            <span class="add-kind-text">${received ? 'Received' : 'Spent'}</span>
          </label>
        </div>

        <div class="field">
          <label for="a-desc-${n}">What was it for</label>
          <input id="a-desc-${n}" class="inp" type="text" autocomplete="off"
                 enterkeyhint="done" placeholder="Groceries, fare, load"
                 value="${esc(values.description ?? '')}" data-desc>
        </div>

        <div class="grid2">
          <div class="field">
            <label for="a-date-${n}">Date</label>
            <input id="a-date-${n}" class="inp" type="date" data-date
                   value="${esc(values.occurred_on || today())}">
          </div>
          <div class="field">
            <label for="a-time-${n}">Time</label>
            <input id="a-time-${n}" class="inp" type="time" data-time
                   value="${esc(values.occurred_time || nowTime())}">
          </div>
        </div>

        <div class="grid2">
          <div class="field">
            <label for="a-cat-${n}">Category</label>
            <select id="a-cat-${n}" class="inp" data-cat>
              ${options(categoriesFor(received ? 'income' : 'expense'), values.category_id)}
            </select>
          </div>
          <div class="field">
            <label for="a-acct-${n}">Account</label>
            <select id="a-acct-${n}" class="inp" data-acct>
              ${options(accounts.map(a => ({ value: a.id, label: a.name })),
                        values.account_id || accounts[0].id)}
            </select>
          </div>
        </div>
      </section>`)

    rowsHost.appendChild(node)
    renumber()
    drawSums()
    return node
  }

  /** The number in the corner, and the remove button of a single form. */
  function renumber () {
    const list = qsa('[data-entry]', rowsHost)
    list.forEach((node, i) => {
      qs('.add-entry-no', node).textContent = String(i + 1)
      qs('[data-del]', node).disabled = list.length === 1
    })
  }

  // ------------------------------------------------------------------------
  // Reading the forms
  // ------------------------------------------------------------------------

  /** One form becomes one line. An empty amount gives null. */
  function readEntry (node) {
    const received = qs('[data-received]', node).checked
    const amount = parseMoney(qs('[data-amount]', node).value)
    if (amount === null || Math.abs(amount) === 0) return null
    const time = qs('[data-time]', node).value
    return {
      type: received ? 'income' : 'expense',
      amount: Math.abs(amount),
      account_id: qs('[data-acct]', node).value,
      category_id: qs('[data-cat]', node).value || null,
      occurred_on: qs('[data-date]', node).value || today(),
      occurred_time: time || null,
      description: qs('[data-desc]', node).value.trim() || null,
    }
  }

  const readAll = () => qsa('[data-entry]', rowsHost).map(readEntry).filter(Boolean)

  /** True when a person typed something that a close would throw away. */
  const hasWork = () => qsa('[data-entry]', rowsHost).some(node =>
    qs('[data-amount]', node).value.trim() !== ''
    || qs('[data-desc]', node).value.trim() !== '')

  // ------------------------------------------------------------------------
  // The sums under the forms
  // ------------------------------------------------------------------------

  const balanceOf = id =>
    store.state.balances.find(b => b.account_id === id)?.balance ?? 0

  /**
   * Shows what the list does to the money, before it reaches the database.
   *
   * The per account lines matter most. A person sees that one account falls
   * below zero while the total still looks safe, and that is the fault that a
   * single total would hide.
   */
  function drawSums () {
    const lines = readAll()
    const save = qs('#add-save', sheet.el)
    save.disabled = lines.length === 0
    save.innerHTML = `${icon('save')} ${lines.length
      ? `Save ${lines.length} ${lines.length === 1 ? 'movement' : 'movements'}`
      : 'Save'}`

    if (!lines.length) { sumsHost.innerHTML = ''; return }

    const out = lines.filter(l => l.type === 'expense').reduce((a, l) => a + l.amount, 0)
    const inn = lines.filter(l => l.type === 'income').reduce((a, l) => a + l.amount, 0)

    const perAccount = new Map()
    for (const l of lines) {
      const delta = l.type === 'income' ? l.amount : -l.amount
      perAccount.set(l.account_id, (perAccount.get(l.account_id) || 0) + delta)
    }
    const accountRows = [...perAccount.entries()].map(([id, delta]) => ({
      name: store.accountById(id)?.name ?? '?',
      delta, before: balanceOf(id), after: balanceOf(id) + delta,
    }))
    const negative = accountRows.filter(a => a.after < 0)

    sumsHost.innerHTML = `
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
        ${negative.length ? `<p class="note">${icon('warn')}
          ${negative.map(a => esc(a.name)).join(' and ')}
          ${negative.length === 1 ? 'falls' : 'fall'} below zero with these
          movements. Check the amounts before you save.</p>` : ''}
      </div>`
  }

  // ------------------------------------------------------------------------
  // Save
  // ------------------------------------------------------------------------

  async function saveAll () {
    const lines = readAll()
    if (!lines.length) { toast('Type an amount above zero.', 'error'); return }

    const button = qs('#add-save', sheet.el)
    button.disabled = true
    button.classList.add('is-busy')
    try {
      const rows = lines.map(l => ({
        account_id: l.account_id,
        category_id: l.category_id,
        type: l.type,
        // The sign follows the type, the same rule that the rest of the
        // application uses. Therefore a balance can never drift.
        amount: l.type === 'income' ? l.amount : -l.amount,
        occurred_on: l.occurred_on,
        occurred_time: l.occurred_time,
        description: l.description,
      }))
      const made = await store.createTransactions(rows)
      await store.refresh()
      realClose()
      toast(`${made.length} ${made.length === 1 ? 'movement' : 'movements'} saved.`, 'ok')

      // The database can be older than these files. store.js then writes the
      // movement without its clock, and the money is still correct. A person
      // who typed a time deserves to know why it did not keep.
      if (!store.schema.hasTime) {
        toast('The clock did not keep. Run sql/06_time_emoji_split.sql on your '
              + 'database to add it.', 'error', 8000)
      }
    } catch (ex) {
      button.disabled = false
      button.classList.remove('is-busy')
      toast(ex.message, 'error', 6000)
    }
  }

  // ------------------------------------------------------------------------
  // The controls
  // ------------------------------------------------------------------------

  // A person who leaves with an amount typed would lose it, therefore the close
  // button asks first.
  const realClose = sheet.close
  const closeButton = qs('[data-close]', sheet.el)
  closeButton.replaceWith(closeButton.cloneNode(true))
  qs('[data-close]', sheet.el).addEventListener('click', async () => {
    if (!hasWork()) { realClose(); return }
    const ok = await confirmSheet({
      title: 'Leave without saving?',
      message: 'Nothing reaches the database, and the forms go away.',
      confirmLabel: 'Leave', danger: true,
    })
    if (ok) realClose()
  })

  qs('#add-another', sheet.el).addEventListener('click', () => {
    // The copy carries the four boxes that rarely change inside one sitting.
    const list = qsa('[data-entry]', rowsHost)
    const last = list[list.length - 1]
    const node = addEntry({
      type: qs('[data-received]', last).checked ? 'income' : 'expense',
      account_id: qs('[data-acct]', last).value,
      category_id: qs('[data-cat]', last).value,
      occurred_on: qs('[data-date]', last).value,
      occurred_time: nowTime(),
    })
    const amount = qs('[data-amount]', node)
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (!('ontouchstart' in window)) amount.focus()
  })

  qs('#add-save', sheet.el).addEventListener('click', saveAll)

  // One listener for the whole list. Each form is a child, therefore a new
  // form needs no listener of its own.
  rowsHost.addEventListener('input', drawSums)

  rowsHost.addEventListener('change', e => {
    const box = e.target.closest('[data-received]')
    if (box) {
      // A category belongs to one kind, therefore the list changes with the
      // tick. The amount and the name stay as they are.
      const node = box.closest('[data-entry]')
      const received = box.checked
      qs('.add-kind-text', node).textContent = received ? 'Received' : 'Spent'
      const amount = qs('[data-amount]', node)
      amount.classList.toggle('is-in', received)
      amount.classList.toggle('is-out', !received)
      qs('[data-cat]', node).innerHTML =
        options(categoriesFor(received ? 'income' : 'expense'), '')
    }
    drawSums()
  })

  delegate(rowsHost, 'click', '[data-del]', (e, button) => {
    const list = qsa('[data-entry]', rowsHost)
    if (list.length === 1) return
    button.closest('[data-entry]').remove()
    renumber()
    drawSums()
  })

  // The Enter key in the amount box or the name box adds the next form. An
  // empty form adds nothing, because a stack of empty forms helps nobody.
  rowsHost.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    if (!e.target.matches('[data-amount], [data-desc]')) return
    e.preventDefault()
    const node = e.target.closest('[data-entry]')
    if (!readEntry(node)) { qs('[data-amount]', node).focus(); return }
    qs('#add-another', sheet.el).click()
  })

  // ------------------------------------------------------------------------
  // Start with one form
  // ------------------------------------------------------------------------

  const first = addEntry({
    type: defaults.type === 'income' ? 'income' : 'expense',
    account_id: defaults.account_id || accounts[0].id,
    category_id: defaults.category_id || '',
    occurred_on: defaults.occurred_on || today(),
    occurred_time: defaults.occurred_time || nowTime(),
    description: defaults.description || '',
  })

  const amount = qs('[data-amount]', first)
  if (!('ontouchstart' in window)) setTimeout(() => amount.focus(), 140)

  return sheet
}
