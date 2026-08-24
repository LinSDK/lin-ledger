// ============================================================================
// Lin Ledger : payroll
//
// Your pay dates in the workbook follow no exact rule: Aug 28, Sep 12, Sep 28,
// Oct 13, Oct 28, Nov 13, Nov 27. A formula cannot give those dates.
// Therefore every pay date is a row that you can move, and the rule in the
// settings only proposes new dates.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, listRow, empty, money, toast, delegate, qs,
         formSheet, confirmSheet } from '../ui.js'
import { openReceivePayroll } from './actions.js'

export async function render (host) {
  const st = store.state
  const now = D.today()
  const ahead = st.payroll.filter(p => p.status === 'expected' && p.expected_date >= now)
  const due = st.payroll.filter(p => p.status === 'expected' && p.expected_date < now)
  const got = st.payroll.filter(p => p.status === 'received')
    .sort((a, b) => (b.actual_date || '') < (a.actual_date || '') ? -1 : 1)

  const next = ahead[0]
  const avgDiff = got.length
    ? Math.round(got.reduce((a, p) =>
        a + ((p.actual_amount ?? 0) - p.expected_amount), 0) / got.length)
    : null

  host.innerHTML = `
    <section class="hero hero-sm">
      <p class="hero-label">Next pay</p>
      <p class="hero-value">${next ? fmt(next.expected_amount) : '--'}</p>
      <p class="hero-note">${next
        ? `${D.fmtDate(next.expected_date)} &middot; ${D.fmtRelative(next.expected_date, now)}`
        : 'No pay date is recorded. Add one below.'}</p>
    </section>

    ${due.length ? card('Waiting for you to record', due.map(p => listRow({
      title: esc(p.label || 'Payroll'),
      sub: `Expected ${D.fmtDate(p.expected_date)} &middot; ${D.fmtRelative(p.expected_date, now)}`,
      right: money(p.expected_amount),
      rightSub: 'tap to record',
      kind: 'row-attn',
      attrs: `data-receive="${p.id}"`,
    })).join('')) : ''}

    ${card('Dates ahead', ahead.length
      ? ahead.map(p => listRow({
          title: esc(p.label || 'Payroll'),
          sub: `${D.fmtDay(p.expected_date)} &middot; ${D.fmtRelative(p.expected_date, now)}`,
          right: money(p.expected_amount),
          rightSub: 'expected',
          attrs: `data-edit="${p.id}"`,
        })).join('')
      : empty('No pay date is ahead.'),
      '')}

    <div class="stack">
      <button class="btn btn-ghost btn-block" id="add">
        ${icon('plus')} Add a pay date</button>
      <button class="btn btn-ghost btn-block" id="gen">
        ${icon('calendar')} Fill the next 12 months from the rule</button>
    </div>

    ${card('Pay that arrived', got.length
      ? got.slice(0, 20).map(p => {
          const d = (p.actual_amount ?? 0) - p.expected_amount
          return listRow({
            title: esc(p.label || 'Payroll'),
            sub: `${D.fmtDate(p.actual_date || p.expected_date)} &middot; expected ${fmt(p.expected_amount)}`,
            right: money(p.actual_amount ?? 0),
            rightSub: d === 0 ? 'the same as expected'
              : d > 0 ? `${fmt(d)} more` : `${fmt(-d)} less`,
            kind: 'row-done',
            attrs: `data-edit="${p.id}"`,
          })
        }).join('')
      : empty('No pay is recorded yet.'),
      avgDiff !== null ? `<span class="card-note">${avgDiff === 0 ? 'always exact'
        : avgDiff > 0 ? `${fmt(avgDiff)} more on average` : `${fmt(-avgDiff)} less on average`}</span>` : '')}

    ${card('How the forecast uses this', `
      <p class="prose">A pay date divides the forecast into periods. The home
      screen judges each period on its own, therefore it can tell you that this
      period is safe and the next one is not. Your allowance for food and travel
      arrives on each pay date.</p>
      <p class="prose">Change the rule that proposes new dates in
      <a href="#/settings">Settings</a>.</p>
    `)}`

  qs('#add', host)?.addEventListener('click', () => openPayrollForm(null))
  qs('#gen', host)?.addEventListener('click', async () => {
    try {
      const made = await store.generatePayroll(D.addMonths(D.today(), 12))
      if (!made) { toast('Every date from the rule is already here.', 'info'); return }
      await store.refresh()
      toast(`${made} pay date${made === 1 ? '' : 's'} added. Change any date that is wrong.`,
            'ok', 5000)
    } catch (ex) { toast(ex.message, 'error') }
  })

  delegate(host, 'click', '[data-receive]', (e, node) => {
    const p = store.state.payroll.find(x => x.id === node.dataset.receive)
    if (p) openReceivePayroll(p)
  })
  delegate(host, 'click', '[data-edit]', (e, node) => {
    const p = store.state.payroll.find(x => x.id === node.dataset.edit)
    if (p) openPayrollForm(p)
  })
}

function openPayrollForm (event) {
  const isNew = !event
  const accounts = store.state.accounts.filter(a => !a.is_archived)
    .map(a => ({ value: a.id, label: a.name }))
  const profile = store.state.profile
  const received = event?.status === 'received'

  formSheet({
    title: isNew ? 'Add a pay date' : `Pay of ${D.fmtDate(event.expected_date)}`,
    submitLabel: isNew ? 'Add' : 'Save',
    fields: [
      { name: 'label', label: 'Name', type: 'text', placeholder: 'Payroll' },
      { name: 'expected_date', label: 'Date that you expect', type: 'date', required: true },
      { name: 'expected_amount', label: 'Amount that you expect', type: 'money',
        required: true },
      { name: 'account_id', label: 'Arrives in', type: 'select', options: accounts },
      { name: 'status', label: 'State', type: 'segment', options: [
        { value: 'expected', label: 'Expected' },
        { value: 'received', label: 'Received' },
        { value: 'missed', label: 'Did not arrive' }] },
      { name: 'actual_date', label: 'Date that it arrived', type: 'date',
        when: v => v.status === 'received' },
      { name: 'actual_amount', label: 'Amount that arrived', type: 'money',
        when: v => v.status === 'received' },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: event || {
      label: 'Payroll', expected_date: D.today(),
      expected_amount: profile.payroll_default_amount,
      account_id: profile.payroll_account_id || store.state.accounts[0]?.id,
      status: 'expected',
    },
    extraFooter: isNew ? '' : `
      <div class="row-actions">
        ${received ? `<button type="button" class="btn btn-ghost" data-act="unreceive">
          Not received after all</button>` : ''}
        <button type="button" class="btn btn-danger-ghost" data-act="delete">Delete</button>
      </div>`,
    onSubmit: async v => {
      const patch = {
        label: v.label || 'Payroll', expected_date: v.expected_date,
        expected_amount: v.expected_amount, account_id: v.account_id || null,
        status: v.status, notes: v.notes,
        actual_date: v.status === 'received' ? v.actual_date : null,
        actual_amount: v.status === 'received' ? v.actual_amount : null,
      }
      if (isNew) await store.createPayroll(patch)
      else await store.updatePayroll(event.id, patch)
      await store.refresh()
      toast(isNew ? 'The pay date is added.' : 'The pay date is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        const act = e.target.closest('[data-act]')?.dataset.act
        if (!act) return
        try {
          if (act === 'unreceive') {
            await store.unreceivePayroll(event)
            toast('The pay is expected again.', 'ok')
          }
          if (act === 'delete') {
            const ok = await confirmSheet({
              title: 'Delete this pay date?',
              message: received
                ? 'The money movement that you recorded goes away too.'
                : 'The forecast loses this date and the period that it starts.',
              confirmLabel: 'Delete', danger: true,
            })
            if (!ok) return
            if (event.transaction_id) await store.unreceivePayroll(event)
            await store.deletePayroll(event.id)
            toast('The pay date is deleted.', 'ok')
          }
          sheet.close()
          await store.refresh()
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}
