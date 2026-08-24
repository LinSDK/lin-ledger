// ============================================================================
// Lin Ledger : the bills screen
//
// Four lists: what comes, what is late, what is paid, and the rules that make
// the rows. The calendar file at the end gives you a real alarm on your
// telephone, which a web page alone cannot do.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, listRow, empty, money, toast, delegate, qs, qsa,
         formSheet, confirmSheet } from '../ui.js'
import { openPayBill, openBillMenu, openPayInstallment, openAddBill } from './actions.js'

let activeTab = 'soon'

const FREQUENCY = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semi_monthly', label: 'Twice each month' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'semi_annual', label: 'Every 6 months' },
  { value: 'annual', label: 'Every year' },
  { value: 'custom_days', label: 'Every N days' },
]

export async function render (host) {
  const st = store.state
  const now = D.today()

  // Bills and loan payments together, in one list.
  const open = [
    ...st.scheduled.filter(b => b.status === 'pending' || b.status === 'partial')
      .map(b => ({ ...b, _type: 'bill', _amount: b.expected_amount, _name: b.name })),
    ...st.loanPayments.filter(p => p.status === 'pending' || p.status === 'partial')
      .filter(p => store.loanById(p.loan_id)?.status === 'active')
      .map(p => ({ ...p, _type: 'loan', _amount: p.amount_due,
                   _name: `${store.loanById(p.loan_id)?.name ?? 'Loan'} #${p.installment_no}` })),
  ].sort((a, b) => (a.due_date < b.due_date ? -1 : 1))

  const late = open.filter(x => x.due_date < now)
  const soon = open.filter(x => x.due_date >= now)

  const paid = [
    ...st.scheduled.filter(b => b.status === 'paid' || b.status === 'skipped')
      .map(b => ({ ...b, _type: 'bill', _amount: b.actual_amount ?? b.expected_amount,
                   _name: b.name, _on: b.paid_on })),
    ...st.loanPayments.filter(p => p.status === 'paid' || p.status === 'waived')
      .map(p => ({ ...p, _type: 'loan', _amount: p.paid_amount ?? p.amount_due,
                   _name: `${store.loanById(p.loan_id)?.name ?? 'Loan'} #${p.installment_no}`,
                   _on: p.paid_on })),
  ].sort((a, b) => ((b._on || '') < (a._on || '') ? -1 : 1)).slice(0, 60)

  const total30 = soon.filter(x => x.due_date <= D.addDays(now, 30))
    .reduce((a, x) => a + x._amount, 0)

  host.innerHTML = `
    <div class="tabs" role="tablist">
      ${tabButton('soon', `Coming (${soon.length})`)}
      ${tabButton('late', `Late (${late.length})`)}
      ${tabButton('paid', 'Paid')}
      ${tabButton('rules', `Rules (${st.recurring.length})`)}
    </div>

    <div class="tab-panes">
      <div class="pane" data-pane="soon">
        <p class="pane-note">The next 30 days need
          <strong>${fmt(total30)}</strong>.</p>
        ${soon.length ? groupByMonth(soon) : empty('Nothing is waiting to be paid.')}
        <div class="stack">
          <button class="btn btn-ghost btn-block" id="add-bill">
            ${icon('plus')} Add a bill</button>
          <button class="btn btn-ghost btn-block" id="ics">
            ${icon('calendar')} Save the next 90 days as a calendar file</button>
        </div>
      </div>

      <div class="pane" data-pane="late">
        ${late.length
          ? `<p class="pane-note warn">${icon('warn')} These payments passed their
              date. The forecast counts them as money that you owe now.</p>
             ${late.map(rowFor).join('')}`
          : empty('Nothing is late. Good.')}
      </div>

      <div class="pane" data-pane="paid">
        ${paid.length ? paid.map(paidRow).join('') : empty('No payment is recorded yet.')}
      </div>

      <div class="pane" data-pane="rules">
        <p class="pane-note">A rule makes the bill rows for the months ahead.
          Change a single row on the Coming list, and the rule leaves that row
          as you set it.</p>
        ${st.recurring.length
          ? st.recurring.map(ruleRow).join('')
          : empty('You have no rules yet.')}
        <button class="btn btn-ghost btn-block" id="add-rule">
          ${icon('plus')} Add a rule</button>
      </div>
    </div>`

  showTab(host, activeTab)
  wire(host, { open, soon })
}

const tabButton = (key, label) =>
  `<button class="tab-btn" data-tab="${key}" role="tab">${esc(label)}</button>`

function showTab (host, key) {
  activeTab = key
  qsa('.tab-btn', host).forEach(b => b.classList.toggle('is-on', b.dataset.tab === key))
  qsa('.pane', host).forEach(p => p.classList.toggle('is-on', p.dataset.pane === key))
}

function groupByMonth (list) {
  const groups = {}
  for (const x of list) {
    const k = D.monthKey(x.due_date)
    ;(groups[k] = groups[k] || []).push(x)
  }
  return Object.entries(groups).map(([k, rows]) => {
    const sum = rows.reduce((a, r) => a + r._amount, 0)
    return `
      <div class="group">
        <div class="group-head">
          <span>${esc(D.fmtMonth(rows[0].due_date))}</span>
          <span class="group-sum">${fmt(sum)}</span>
        </div>
        ${rows.map(rowFor).join('')}
      </div>`
  }).join('')
}

function rowFor (x) {
  const now = D.today()
  const isLate = x.due_date < now
  return listRow({
    title: esc(x._name),
    sub: isLate
      ? `<span class="late">Late since ${D.fmtDate(x.due_date)}</span>`
      : `${D.fmtDate(x.due_date)} &middot; ${D.fmtRelative(x.due_date, now)}`
      + (x.is_estimate ? ' &middot; estimate' : ''),
    right: money(-x._amount),
    rightSub: x._type === 'loan' ? 'loan' : 'bill',
    kind: isLate ? 'row-attn' : '',
    attrs: `data-open="${x.id}" data-type="${x._type}"`,
  })
}

function paidRow (x) {
  const waived = x.status === 'waived'
  const skipped = x.status === 'skipped'
  return listRow({
    title: esc(x._name),
    sub: waived ? 'Cancelled by an early payoff'
       : skipped ? 'Skipped'
       : `Paid ${x._on ? D.fmtDate(x._on) : ''}`,
    right: waived || skipped ? '<span class="muted">--</span>' : money(-x._amount),
    rightSub: x._type === 'loan' ? 'loan' : 'bill',
    kind: 'row-done',
    attrs: `data-open="${x.id}" data-type="${x._type}"`,
  })
}

function ruleRow (r) {
  const cat = store.categoryById(r.category_id)
  const freq = FREQUENCY.find(f => f.value === r.frequency)?.label || r.frequency
  return listRow({
    title: esc(r.name) + (r.is_active ? '' : ' <em class="tag">off</em>'),
    sub: `${esc(freq)}${r.day_of_month ? ` &middot; ${dayText(r.day_of_month)}` : ''}`
       + (cat ? ` &middot; ${esc(cat.name)}` : '')
       + (r.is_estimate ? ' &middot; estimate' : ''),
    right: money(-r.amount),
    attrs: `data-rule="${r.id}"`,
  })
}

const dayText = d => d === -1 ? 'the last day' : `day ${d}`

// ---------------------------------------------------------------------------
// The rule editor
// ---------------------------------------------------------------------------

function openRule (rule) {
  const isNew = !rule
  const accounts = store.state.accounts.filter(a => !a.is_archived)
    .map(a => ({ value: a.id, label: a.name }))
  const cats = [{ value: '', label: '(none)' },
    ...store.state.categories.filter(c => c.kind === 'expense')
      .map(c => ({ value: c.id, label: c.name }))]

  const usesDay = v => ['monthly', 'quarterly', 'semi_annual', 'annual', 'semi_monthly']
    .includes(v.frequency)

  formSheet({
    title: isNew ? 'Add a rule' : `Rule: ${rule.name}`,
    submitLabel: isNew ? 'Add the rule' : 'Save the rule',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true },
      { name: 'frequency', label: 'How often', type: 'select', options: FREQUENCY },
      { name: 'day_of_month', label: 'Day of the month', type: 'number',
        min: -1, max: 31, when: usesDay,
        hint: 'Use -1 for the last day of the month.' },
      { name: 'day_of_month_2', label: 'Second day of the month', type: 'number',
        min: -1, max: 31, when: v => v.frequency === 'semi_monthly' },
      { name: 'weekday', label: 'Day of the week', type: 'select',
        when: v => ['weekly', 'biweekly'].includes(v.frequency),
        options: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
          .map((d, i) => ({ value: i, label: d })) },
      { name: 'custom_days', label: 'Number of days', type: 'number', min: 1,
        when: v => v.frequency === 'custom_days' },
      { name: 'start_date', label: 'First date', type: 'date', required: true },
      { name: 'end_date', label: 'Last date, if it ends', type: 'date' },
      { name: 'category_id', label: 'Category', type: 'select', options: cats },
      { name: 'account_id', label: 'Pay from', type: 'select', options: accounts },
      { name: 'weekend_adjust', label: 'If the day is a weekend', type: 'select',
        options: [
          { value: 'none', label: 'Keep the date' },
          { value: 'previous_business_day', label: 'Move earlier' },
          { value: 'next_business_day', label: 'Move later' }] },
      { name: 'is_estimate', label: '', type: 'switch',
        onLabel: 'The amount changes each time' },
      { name: 'is_active', label: '', type: 'switch', onLabel: 'This rule is on' },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: rule || {
      frequency: 'monthly', day_of_month: 1, start_date: D.today(),
      weekend_adjust: 'none', is_active: true, is_estimate: false,
      account_id: store.state.accounts[0]?.id,
    },
    extraFooter: isNew ? '' : `
      <div class="row-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">
          Delete the rule and its open rows</button>
      </div>`,
    onSubmit: async v => {
      const patch = {
        name: v.name, amount: v.amount, frequency: v.frequency,
        day_of_month: usesDay(v) ? v.day_of_month : null,
        day_of_month_2: v.frequency === 'semi_monthly' ? v.day_of_month_2 : null,
        weekday: ['weekly', 'biweekly'].includes(v.frequency) ? Number(v.weekday) : null,
        custom_days: v.frequency === 'custom_days' ? v.custom_days : null,
        start_date: v.start_date, end_date: v.end_date || null,
        category_id: v.category_id || null, account_id: v.account_id || null,
        weekend_adjust: v.weekend_adjust, is_estimate: v.is_estimate,
        is_active: v.is_active, notes: v.notes,
      }
      if (isNew) await store.createRecurring(patch)
      else await store.updateRecurring(rule.id, patch)
      await store.refresh()
      const made = await store.ensureHorizon()
      if (made) await store.refresh()
      toast(isNew ? 'The rule is added.' : 'The rule is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        if (e.target.closest('[data-act="delete"]')) {
          const ok = await confirmSheet({
            title: 'Delete this rule?',
            message: 'The rows that are still open go away too. Paid rows stay.',
            confirmLabel: 'Delete', danger: true,
          })
          if (!ok) return
          try {
            await store.deleteRecurring(rule.id)
            sheet.close()
            await store.refresh()
            toast('The rule is deleted.', 'ok')
          } catch (ex) { toast(ex.message, 'error') }
        }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// A calendar file, so the telephone can give a real alarm
// ---------------------------------------------------------------------------

function buildIcs (items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lin Ledger//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Lin Ledger bills',
  ]
  for (const x of items) {
    const day = x.due_date.replace(/-/g, '')
    const next = D.addDays(x.due_date, 1).replace(/-/g, '')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${x.id}@lin-ledger`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${icsText(`${x._name} ${fmt(x._amount)}`)}`,
      `DESCRIPTION:${icsText(`Due ${D.fmtDate(x.due_date)}. Amount ${fmt(x._amount)}.`)}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(x._name + ' is due tomorrow')}`, 'END:VALARM',
      'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // A line in a calendar file must not be longer than 75 octets.
  return lines.flatMap(l => l.length <= 74 ? [l]
    : [l.slice(0, 74), ...(l.slice(74).match(/.{1,73}/g) || []).map(s => ' ' + s)])
    .join('\r\n')
}

const icsText = s => String(s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\n/g, '\\n')

function saveIcs (items) {
  const blob = new Blob([buildIcs(items)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'lin-ledger-bills.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wire (host, { open, soon }) {
  delegate(host, 'click', '.tab-btn', (e, b) => showTab(host, b.dataset.tab))

  delegate(host, 'click', '[data-open]', (e, node) => {
    const { open: id, type } = node.dataset
    if (type === 'loan') {
      const row = store.state.loanPayments.find(p => p.id === id)
      if (!row) return
      if (row.status === 'pending' || row.status === 'partial') openPayInstallment(row)
      else location.hash = `#/loans/${row.loan_id}`
      return
    }
    const bill = store.state.scheduled.find(b => b.id === id)
    if (!bill) return
    if (bill.status === 'pending' || bill.status === 'partial') openPayBill(bill)
    else openBillMenu(bill)
  })

  // A long press, or a right click, opens the editor instead of the payment form.
  let timer = null
  host.addEventListener('pointerdown', e => {
    const node = e.target.closest('[data-open][data-type="bill"]')
    if (!node) return
    timer = setTimeout(() => {
      timer = null
      const bill = store.state.scheduled.find(b => b.id === node.dataset.open)
      if (bill) openBillMenu(bill)
    }, 550)
  })
  const clear = () => { clearTimeout(timer); timer = null }
  host.addEventListener('pointerup', clear)
  host.addEventListener('pointermove', clear)
  host.addEventListener('pointercancel', clear)
  host.addEventListener('contextmenu', e => {
    const node = e.target.closest('[data-open][data-type="bill"]')
    if (!node) return
    e.preventDefault()
    const bill = store.state.scheduled.find(b => b.id === node.dataset.open)
    if (bill) openBillMenu(bill)
  })

  delegate(host, 'click', '[data-rule]', (e, node) => {
    openRule(store.state.recurring.find(r => r.id === node.dataset.rule))
  })

  qs('#add-rule', host)?.addEventListener('click', () => openRule(null))
  qs('#add-bill', host)?.addEventListener('click', () => openAddBill())

  qs('#ics', host)?.addEventListener('click', () => {
    const limit = D.addDays(D.today(), 90)
    const items = soon.filter(x => x.due_date <= limit)
    if (!items.length) { toast('Nothing is due in the next 90 days.', 'info'); return }
    saveIcs(items)
    toast(`${items.length} events saved. Open the file to add them to your calendar.`,
          'ok', 5000)
  })
}
