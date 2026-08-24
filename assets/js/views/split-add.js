// ============================================================================
// Lin Ledger : one event that touches more than one account
//
// A purchase does not always come from one pocket.
//
//   "I paid 500 from Cash and took 15 in Coins as change."
//        Cash  -500      Coins  +15      the true cost is 485
//
//   "I paid 100 from Cash and 30 from Coins."
//        Cash  -100      Coins  -30      the true cost is 130
//
// One event, one name, one date, one category, and one line for each account.
// The sheet shows the sum while you type, therefore you can see the true cost
// before you save.
// ============================================================================

import * as store from '../store.js'
import { fmt, parseMoney } from '../money.js'
import { today } from '../dates.js'
import { openSheet, icon, esc, toast, qs, qsa, delegate, confirmSheet } from '../ui.js'

export function openSplitAdd (defaults = {}) {
  const accounts = store.state.accounts.filter(a => !a.is_archived)
  if (accounts.length === 0) {
    toast('Add an account first.', 'error')
    location.hash = '#/accounts'
    return
  }

  const event = {
    description: defaults.description || '',
    category_id: defaults.category_id || '',
    occurred_on: defaults.occurred_on || today(),
  }

  // Two lines to start. Most events use two, and an empty second line invites
  // the user to fill it.
  const legs = defaults.legs || [
    { account_id: defaults.account_id || accounts[0].id, direction: 'out', amount: null },
    { account_id: accounts[1]?.id ?? accounts[0].id, direction: 'out', amount: null },
  ]

  const categories = [
    { value: '', label: '(no category)' },
    ...store.state.categories
      .filter(c => !c.is_archived && c.kind !== 'transfer')
      .map(c => ({ value: c.id, label: c.name })),
  ]

  const balanceOf = id =>
    store.state.balances.find(b => b.account_id === id)?.balance ?? 0
  const accountName = id => store.accountById(id)?.name ?? '?'

  const sheet = openSheet({
    title: 'Split across accounts',
    size: 'lg',
    body: '<div id="split"></div>',
    dismissable: false,
  })

  // A stray tap must not throw away a part filled event.
  const oldClose = qs('[data-close]', sheet.el)
  oldClose.replaceWith(oldClose.cloneNode(true))
  const realClose = sheet.close
  qs('[data-close]', sheet.el).addEventListener('click', async () => {
    readForm()
    const filled = legs.some(l => l.amount) || event.description
    if (!filled) { realClose(); return }
    const ok = await confirmSheet({
      title: 'Leave this event unsaved?',
      message: 'Nothing reaches the database.',
      confirmLabel: 'Leave', danger: true,
    })
    if (ok) realClose()
  })

  /** Copies what is on the screen into the two objects above. */
  function readForm () {
    const d = qs('#sp-desc', sheet.el)
    const c = qs('#sp-cat', sheet.el)
    const t = qs('#sp-date', sheet.el)
    if (d) event.description = d.value
    if (c) event.category_id = c.value
    if (t) event.occurred_on = t.value || today()

    qsa('[data-leg]', sheet.el).forEach(row => {
      const i = Number(row.dataset.leg)
      if (!legs[i]) return
      legs[i].account_id = qs('[data-leg-account]', row).value
      legs[i].direction = qs('[data-leg-dir].is-on', row)?.dataset.legDir ?? 'out'
      legs[i].amount = parseMoney(qs('[data-leg-amount]', row).value)
    })
  }

  /** The sum of the lines. Below zero means that the event cost you money. */
  function netOf () {
    return legs.reduce((a, l) => {
      const size = Math.abs(l.amount || 0)
      return a + (l.direction === 'in' ? size : -size)
    }, 0)
  }

  /** The change to each account, added up per account. */
  function perAccount () {
    const map = new Map()
    for (const l of legs) {
      const size = Math.abs(l.amount || 0)
      if (!l.account_id || size === 0) continue
      const delta = l.direction === 'in' ? size : -size
      map.set(l.account_id, (map.get(l.account_id) || 0) + delta)
    }
    return [...map.entries()].map(([id, delta]) => ({
      id, name: accountName(id), delta,
      before: balanceOf(id), after: balanceOf(id) + delta,
    }))
  }

  function summary () {
    const net = netOf()
    const filled = legs.filter(l => l.amount && l.account_id).length
    if (filled === 0) {
      return { text: 'Fill in at least one line.', cls: 'muted', ready: false }
    }
    if (net === 0) {
      return {
        text: 'The money only moved between your accounts. Nothing was spent, '
            + 'therefore no category counts this event.',
        cls: 'muted', ready: true, isMove: true,
      }
    }
    if (net < 0) {
      return { text: `This event cost you ${fmt(-net)}.`, cls: 'neg', ready: true }
    }
    return { text: `This event gave you ${fmt(net)}.`, cls: 'pos', ready: true }
  }

  function draw () {
    const net = netOf()
    const sum = summary()
    const accountRows = perAccount()
    const negative = accountRows.filter(a => a.after < 0)

    qs('#split', sheet.el).innerHTML = `
      <div class="field">
        <label for="sp-desc">What was it for</label>
        <input id="sp-desc" class="inp" type="text" autocomplete="off"
               value="${esc(event.description)}"
               placeholder="Groceries, fare, load">
      </div>

      <div class="grid2">
        <div class="field">
          <label for="sp-cat">Category</label>
          <select id="sp-cat" class="inp" ${sum.isMove ? 'disabled' : ''}>
            ${categories.map(o => `<option value="${esc(o.value)}"
              ${String(o.value) === String(event.category_id) ? 'selected' : ''}
              >${esc(o.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="sp-date">Date</label>
          <input id="sp-date" class="inp" type="date" value="${event.occurred_on}">
        </div>
      </div>

      <div class="split-legs">
        <div class="split-legs-head">
          <span>Where the money moved</span>
          <span class="hint">${legs.length} ${legs.length === 1 ? 'line' : 'lines'}</span>
        </div>

        ${legs.map((l, i) => `
          <div class="split-leg" data-leg="${i}">
            <select class="inp split-leg-acct" data-leg-account aria-label="Account">
              ${accounts.map(a => `<option value="${a.id}"
                ${a.id === l.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
            <div class="segment split-leg-dir">
              <button type="button" class="seg ${l.direction === 'out' ? 'is-on' : ''}"
                      data-leg-dir="out">Out</button>
              <button type="button" class="seg ${l.direction === 'in' ? 'is-on' : ''}"
                      data-leg-dir="in">In</button>
            </div>
            <input class="inp inp-money split-leg-amt" data-leg-amount type="text"
                   inputmode="decimal" placeholder="0.00" autocomplete="off"
                   value="${l.amount === null || l.amount === undefined ? ''
                            : esc(fmt(Math.abs(l.amount), { style: 'minus' }))}"
                   aria-label="Amount">
            <button type="button" class="btn-icon split-leg-del" data-del-leg="${i}"
                    aria-label="Remove this line"
                    ${legs.length <= 1 ? 'disabled' : ''}>${icon('close')}</button>
          </div>`).join('')}

        <button type="button" class="btn btn-ghost btn-block btn-sm" id="sp-add-leg">
          ${icon('plus')} Add another account</button>
      </div>

      <div class="split-sum">
        <div class="split-net">
          <span>Net</span>
          <strong class="${net < 0 ? 'neg' : net > 0 ? 'pos' : 'muted'}">${fmt(net)}</strong>
        </div>
        <p class="split-msg ${sum.cls}">${esc(sum.text)}</p>
        ${accountRows.length ? `
          <div class="batch-accts">
            ${accountRows.map(a => `
              <div class="batch-acct">
                <span>${esc(a.name)}</span>
                <span class="${a.delta < 0 ? 'neg' : 'pos'}">${fmt(a.delta)}</span>
                <span class="muted">${fmt(a.before)} to
                  <strong class="${a.after < 0 ? 'neg' : ''}">${fmt(a.after)}</strong></span>
              </div>`).join('')}
          </div>` : ''}
        ${negative.length ? `<p class="note">${icon('warn')}
          ${negative.map(a => esc(a.name)).join(' and ')}
          ${negative.length === 1 ? 'falls' : 'fall'} below zero with these lines.</p>` : ''}
      </div>

      <p class="hint">Use <strong>Out</strong> for money that left an account, and
        <strong>In</strong> for money that came back, for example change. The net
        is the true cost of the event.</p>

      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-block" id="sp-save"
                ${sum.ready ? '' : 'disabled'}>
          ${icon('save')} Save this event</button>
      </div>`

    wire()
  }

  function wire () {
    // Keep the two objects current as the user types, so a redraw never loses
    // a value.
    qsa('#split .inp', sheet.el).forEach(n => {
      n.addEventListener('input', () => {
        readForm()
        updateLive()
      })
      n.addEventListener('change', () => { readForm(); draw() })
    })

    delegate(sheet.el, 'click', '[data-leg-dir]', (e, b) => {
      const row = b.closest('[data-leg]')
      qsa('[data-leg-dir]', row).forEach(x => x.classList.remove('is-on'))
      b.classList.add('is-on')
      readForm()
      draw()
    })

    delegate(sheet.el, 'click', '[data-del-leg]', (e, b) => {
      readForm()
      legs.splice(Number(b.dataset.delLeg), 1)
      draw()
    })

    qs('#sp-add-leg', sheet.el).addEventListener('click', () => {
      readForm()
      const used = new Set(legs.map(l => l.account_id))
      const next = accounts.find(a => !used.has(a.id)) || accounts[0]
      legs.push({ account_id: next.id, direction: 'out', amount: null })
      draw()
      // Put the cursor in the amount box of the new line.
      const boxes = qsa('[data-leg-amount]', sheet.el)
      const last = boxes[boxes.length - 1]
      if (last && !('ontouchstart' in window)) last.focus()
    })

    qs('#sp-save', sheet.el).addEventListener('click', save)
  }

  /**
   * Updates only the numbers while the user types.
   * A full redraw would move the cursor out of the box.
   */
  function updateLive () {
    const net = netOf()
    const sum = summary()
    const netBox = qs('.split-net strong', sheet.el)
    if (netBox) {
      netBox.textContent = fmt(net)
      netBox.className = net < 0 ? 'neg' : net > 0 ? 'pos' : 'muted'
    }
    const msg = qs('.split-msg', sheet.el)
    if (msg) { msg.textContent = sum.text; msg.className = `split-msg ${sum.cls}` }
    const save = qs('#sp-save', sheet.el)
    if (save) save.disabled = !sum.ready
  }

  async function save () {
    readForm()
    const button = qs('#sp-save', sheet.el)
    button.disabled = true
    button.classList.add('is-busy')
    try {
      const result = await store.createSplit({
        description: event.description,
        category_id: event.category_id || null,
        occurred_on: event.occurred_on,
        legs: legs.filter(l => l.amount && l.account_id),
      })
      await store.refresh()
      realClose()
      const n = result.rows.length
      toast(result.net === 0
        ? `Money moved across ${n} accounts.`
        : result.net < 0
          ? `${fmt(-result.net)} spent across ${n} ${n === 1 ? 'account' : 'accounts'}.`
          : `${fmt(result.net)} received across ${n} ${n === 1 ? 'account' : 'accounts'}.`,
        'ok')
    } catch (ex) {
      button.disabled = false
      button.classList.remove('is-busy')
      toast(ex.message, 'error', 6000)
    }
  }

  draw()
  const first = qs('#sp-desc', sheet.el)
  if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 140)
  return sheet
}
