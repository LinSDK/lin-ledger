// ============================================================================
// Lin Ledger : the loans screen
//
// The list shows what each loan still costs. The detail screen shows every
// payment, with the part that pays the amount and the part that pays interest.
// The payoff test answers "can I close this loan early?" with a clear answer,
// and it names the payments that would fail if the answer is no.
// ============================================================================

import * as store from '../store.js'
import { fmt, fmtPct, parseMoney } from '../money.js'
import * as D from '../dates.js'
import { balanceChart } from '../charts.js'
import { icon, esc, card, listRow, empty, money, toast, delegate, qs, qsa,
         formSheet, confirmSheet, verdictBadge, openSheet } from '../ui.js'
import { openPayInstallment } from './actions.js'
import { buildSchedule, payoffQuote, effectiveApr, INTEREST_METHOD_LABEL,
         TERM_UNIT_LABEL, PERIODS_PER_YEAR } from '../amortize.js'
import { payoffScenario, VERDICT } from '../projection.js'

export async function render (host, params) {
  if (params && params[0]) return renderDetail(host, params[0])
  return renderList(host)
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function renderList (host) {
  const st = store.state
  const active = st.loanStats.filter(s => s.status === 'active')
  const closed = st.loanStats.filter(s => s.status !== 'active')

  const owed = active.reduce((a, s) => a + s.balance_remaining, 0)
  const interestLeft = active.reduce((a, s) => a + s.interest_remaining, 0)
  const interestPaid = st.loanStats.reduce((a, s) => a + s.interest_paid, 0)

  host.innerHTML = `
    <section class="hero hero-sm">
      <p class="hero-label">Still to pay on ${active.length}
        ${active.length === 1 ? 'loan' : 'loans'}</p>
      <p class="hero-value">${fmt(owed)}</p>
      <div class="pills">
        <div class="pill pill-bad">
          <span class="pill-label">Interest already paid</span>
          <span class="pill-value">${fmt(interestPaid)}</span>
        </div>
        <div class="pill pill-warn">
          <span class="pill-label">Interest still to come</span>
          <span class="pill-value">${fmt(interestLeft)}</span>
        </div>
      </div>
    </section>

    ${active.length ? active.map(loanCard).join('') : empty('You have no open loan.')}

    <button class="btn btn-ghost btn-block" id="add-loan">
      ${icon('plus')} Add a loan or an installment plan</button>

    ${closed.length ? card('Closed', closed.map(s => listRow({
      title: esc(s.name),
      sub: `${s.installment_count} payments &middot; interest ${fmt(s.interest_paid)}`,
      right: '<span class="muted">closed</span>',
      attrs: `data-loan="${s.loan_id}"`,
    })).join('')) : ''}`

  qs('#add-loan', host)?.addEventListener('click', () => openLoanForm(null))
  delegate(host, 'click', '[data-loan]', (e, node) => {
    location.hash = `#/loans/${node.dataset.loan}`
  })
}

function loanCard (s) {
  const paidRatio = s.total_payable ? s.amount_paid / s.total_payable : 0
  const unknown = s.principal === null
  return `
  <section class="card card-loan" data-loan="${s.loan_id}">
    <header class="card-head">
      <h3>${esc(s.name)}</h3>
      <span class="muted">${esc(s.lender || '')}</span>
    </header>
    <div class="card-body">
      <div class="loan-top">
        <div>
          <p class="loan-owed">${fmt(s.balance_remaining)}</p>
          <p class="loan-sub">still to pay of ${fmt(s.total_payable)}</p>
        </div>
        <div class="loan-next">
          ${s.next_due_date ? `
            <p class="loan-next-date">${D.fmtDate(s.next_due_date)}</p>
            <p class="loan-sub">${D.fmtRelative(s.next_due_date)}</p>` : ''}
        </div>
      </div>

      <div class="prog">
        <div class="prog-track">
          <div class="prog-fill" style="width:${(paidRatio * 100).toFixed(1)}%"></div>
        </div>
        <div class="prog-label">
          ${s.paid_count} of ${s.installment_count} payments made
        </div>
      </div>

      <div class="loan-facts">
        ${fact('Received', unknown ? 'unknown' : fmt(s.amount_received ?? s.principal))}
        ${fact('Interest paid', fmt(s.interest_paid), 'neg')}
        ${fact('Interest to come', unknown ? 'unknown' : fmt(s.interest_remaining), 'neg')}
      </div>
      ${unknown ? `<p class="note">${icon('info')} The original amount of this plan
        is unknown, therefore the ledger cannot calculate its interest. Open the
        loan and add the amount.</p>` : ''}
    </div>
  </section>`
}

const fact = (label, value, cls = '') =>
  `<div class="fact"><span>${esc(label)}</span><strong class="${cls}">${value}</strong></div>`

// ---------------------------------------------------------------------------
// One loan
// ---------------------------------------------------------------------------

function renderDetail (host, loanId) {
  const loan = store.loanById(loanId)
  if (!loan) {
    host.innerHTML = empty('That loan is not here.',
      '<a class="btn btn-ghost" href="#/loans">Back to the loans</a>')
    return
  }
  const s = store.statsForLoan(loanId) || {}
  const rows = store.paymentsOfLoan(loanId)
  const unknown = loan.principal === null
  const apr = unknown ? null : effectiveApr({
    amountReceived: loan.amount_received ?? loan.principal,
    rows, termUnit: loan.term_unit,
  })

  host.innerHTML = `
    <div class="detail-head">
      <a class="btn-icon" href="#/loans" aria-label="Back">${icon('back')}</a>
      <div>
        <h2>${esc(loan.name)}</h2>
        <p class="muted">${esc(loan.lender || '')}
          ${loan.external_ref ? `&middot; ${esc(loan.external_ref)}` : ''}</p>
      </div>
      <button class="btn-icon" id="edit-loan" aria-label="Change the loan">${icon('edit')}</button>
    </div>

    <section class="hero hero-sm">
      <p class="hero-label">Still to pay</p>
      <p class="hero-value">${fmt(s.balance_remaining ?? 0)}</p>
      <p class="hero-note">${s.paid_count ?? 0} of ${s.installment_count ?? 0}
        payments made &middot; ${esc(INTEREST_METHOD_LABEL[loan.interest_method])}</p>
    </section>

    ${card('The numbers', `
      <div class="grid2">
        ${fact('Amount received', unknown ? 'unknown' : fmt(loan.amount_received ?? loan.principal))}
        ${fact('Total to pay', fmt(loan.total_payable ?? 0))}
        ${fact('Charge at the start', fmt(loan.fees_upfront))}
        ${fact('Each payment', fmt(loan.payment_amount ?? 0))}
        ${fact('Interest paid', fmt(s.interest_paid ?? 0), 'neg')}
        ${fact('Interest to come', unknown ? 'unknown' : fmt(s.interest_remaining ?? 0), 'neg')}
        ${fact('Total interest', unknown ? 'unknown' : fmt(s.interest_total ?? 0), 'neg')}
        ${fact('Rate', unknown ? 'unknown'
          : `${(loan.rate * 100).toFixed(2)}% each ${loan.rate_period === 'annual' ? 'year' : 'month'}`)}
        ${fact('True yearly cost', apr === null ? 'unknown' : fmtPct(apr, 1))}
        ${fact('Term', `${loan.term_count} ${TERM_UNIT_LABEL[loan.term_unit]}${loan.term_count === 1 ? '' : 's'}`)}
      </div>
      ${apr !== null && loan.fees_upfront > 0 ? `<p class="note">${icon('info')}
        The true yearly cost is above the quoted rate, because the charge of
        ${fmt(loan.fees_upfront)} at the start reduces the money that you received.</p>` : ''}
      ${loan.notes ? `<p class="note">${icon('info')} ${esc(loan.notes)}</p>` : ''}
    `)}

    <div class="stack">
      <button class="btn btn-primary btn-block" id="simulate">
        ${icon('play')} Test an early payoff</button>
    </div>

    ${card('Every payment', scheduleTable(rows), `
      <button class="card-link" id="rebuild">Build the schedule again</button>`)}`

  qs('#edit-loan', host)?.addEventListener('click', () => openLoanForm(loan))
  qs('#simulate', host)?.addEventListener('click', () => openPayoffSheet(loan, rows))
  qs('#rebuild', host)?.addEventListener('click', () => openRebuild(loan, rows))
  delegate(host, 'click', '[data-inst]', (e, node) => {
    const row = rows.find(r => r.id === node.dataset.inst)
    if (!row) return
    if (row.status === 'pending' || row.status === 'partial') openPayInstallment(row)
    else openInstallmentEditor(row)
  })
}

function scheduleTable (rows) {
  if (!rows.length) return empty('This loan has no payments yet.')
  const now = D.today()
  return `
  <div class="table-scroll">
    <table class="sched">
      <thead>
        <tr><th>#</th><th>Due</th><th>Amount</th><th>Of that, interest</th>
            <th>Left after</th><th>State</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const late = (r.status === 'pending' || r.status === 'partial') && r.due_date < now
          return `
          <tr class="st-${r.status} ${late ? 'is-late' : ''}" data-inst="${r.id}">
            <td>${r.installment_no}</td>
            <td>${D.fmtShort(r.due_date)}<span class="yr">${D.parts(r.due_date).y}</span></td>
            <td class="num">${fmt(r.paid_amount ?? r.amount_due)}</td>
            <td class="num neg">${r.interest_component ? fmt(r.interest_component) : '--'}</td>
            <td class="num muted">${r.balance_after === null ? '--' : fmt(r.balance_after)}</td>
            <td>${stateTag(r, late)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div>
  <p class="hint">Tap a payment to record it or to change it.</p>`
}

function stateTag (r, late) {
  if (r.status === 'paid') return `<em class="tag tag-ok">paid</em>`
  if (r.status === 'waived') return `<em class="tag">cancelled</em>`
  if (r.status === 'skipped') return `<em class="tag">skipped</em>`
  if (late) return `<em class="tag tag-bad">late</em>`
  return `<em class="tag">open</em>`
}

// ---------------------------------------------------------------------------
// The early payoff test
// ---------------------------------------------------------------------------

function openPayoffSheet (loan, rows) {
  const profile = store.state.profile
  const now = D.today()
  const base = store.buildProjection({ from: now })
  const accounts = store.state.accounts.filter(a => !a.is_archived)
    .map(a => ({ value: a.id, label: a.name }))

  let quote = payoffQuote({ loan, rows, onDate: now, rebateRatio: 1 })

  const sheet = openSheet({
    title: `Close ${loan.name} early`,
    size: 'lg',
    body: `<div id="payoff-body">${skeletonBlock()}</div>`,
  })

  const draw = (state) => {
    quote = payoffQuote({
      loan, rows, onDate: state.date,
      rebateRatio: state.rebate / 100,
    })
    if (state.amount !== null) quote = { ...quote, amount: state.amount }

    const result = payoffScenario({
      opening: base.opening, events: base.events, from: base.from, to: base.to,
      safetyBuffer: base.safetyBuffer, loanId: loan.id, quote,
    })
    const cmp = result.comparison
    const cls = { safe: 'ok', tight: 'warn', short: 'bad' }[cmp.verdict]

    qs('#payoff-body', sheet.el).innerHTML = `
      <div class="payoff-form">
        <div class="field">
          <label for="pd">Pay it off on</label>
          <input id="pd" class="inp" type="date" value="${state.date}" min="${now}">
        </div>
        <div class="field">
          <label for="pa">Amount that the lender asks for</label>
          <input id="pa" class="inp inp-money" type="text" inputmode="decimal"
                 value="${fmt(quote.amount, { style: 'minus' })}">
          <p class="hint">The ledger proposes this amount. Lenders differ, so
            confirm the figure with your lender and type the true one.</p>
        </div>
        ${quote.interest_unknown ? '' : `
        <div class="field">
          <label for="pr">Interest that the lender gives back: ${state.rebate}%</label>
          <input id="pr" class="rng" type="range" min="0" max="100" step="5"
                 value="${state.rebate}">
          <p class="hint">100% means the lender drops every future interest
            charge. 0% means you still pay all of it.</p>
        </div>`}
      </div>

      <div class="verdict-box verdict-${cls}">
        <div class="verdict-top">
          ${verdictBadge(cmp.verdict)}
          <span>${verdictText(cmp, quote)}</span>
        </div>
        <div class="grid2">
          ${fact('You pay now', fmt(quote.amount), 'neg')}
          ${fact('Instead of', fmt(quote.total_if_kept))}
          ${fact('You keep', fmt(quote.saving_vs_kept), 'pos')}
          ${fact('Interest saved', quote.interest_unknown ? 'unknown'
                 : fmt(quote.interest_saved), 'pos')}
          ${fact('Payments cancelled', String(quote.dropped_count))}
          ${fact('Lowest balance after', fmt(cmp.min_balance),
                 cmp.min_balance < 0 ? 'neg' : '')}
        </div>
        ${quote.arrears_count ? `<p class="note">${icon('warn')}
          ${quote.arrears_count} payment${quote.arrears_count === 1 ? '' : 's'}
          passed the due date already. The amount above includes
          ${fmt(quote.arrears_amount)} for ${quote.arrears_count === 1 ? 'it' : 'them'}.</p>` : ''}
      </div>

      ${cmp.at_risk.length ? `
        <div class="risk">
          <p class="risk-head">${icon('warn')} These payments would fail:</p>
          ${cmp.at_risk.slice(0, 8).map(e => `
            <div class="risk-row">
              <span>${esc(e.label)}</span>
              <span>${D.fmtDate(e.due_date || e.date)}</span>
              <span class="neg">${fmt(e.amount)}</span>
              <span class="muted">balance ${fmt(e.balance_after)}</span>
            </div>`).join('')}
          ${cmp.at_risk.length > 8
            ? `<p class="hint">and ${cmp.at_risk.length - 8} more.</p>` : ''}
        </div>` : ''}

      <div class="chart-host">
        ${balanceChart(thin(result.scenario.series), {
            compare: thin(result.baseline.series),
            buffer: profile.safety_buffer,
          })}
        <p class="legend">
          <span class="lg lg-line"></span> after the payoff
          <span class="lg lg-dash"></span> as it is now
        </p>
      </div>

      <div class="form-actions">
        <button class="btn ${cmp.possible ? 'btn-primary' : 'btn-danger'} btn-block"
                id="apply-payoff">
          ${cmp.possible ? 'Do it: record this payoff' : 'Record it anyway'}
        </button>
        ${!cmp.possible ? `<p class="hint center">The ledger advises against this.
          Choose a later date, or a smaller amount.</p>` : ''}
      </div>`

    // Keep the controls working after each redraw.
    const dateInput = qs('#pd', sheet.el)
    const amountInput = qs('#pa', sheet.el)
    const rebateInput = qs('#pr', sheet.el)

    dateInput.addEventListener('change', () =>
      draw({ ...state, date: dateInput.value || now, amount: null }))
    amountInput.addEventListener('change', () =>
      draw({ ...state, amount: parseMoney(amountInput.value) }))
    rebateInput?.addEventListener('change', () =>
      draw({ ...state, rebate: Number(rebateInput.value), amount: null }))

    qs('#apply-payoff', sheet.el).addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Record this payoff?',
        message: `This writes a payment of ${fmt(quote.amount)} on `
               + `${D.fmtDate(state.date)}, cancels ${quote.dropped_count} later `
               + `payments and closes the loan. You can undo it by hand.`,
        confirmLabel: 'Record it',
        danger: !cmp.possible,
      })
      if (!ok) return
      try {
        await store.applyPayoff(loan, { ...quote, on_date: state.date },
                                { accountId: loan.account_id, date: state.date })
        sheet.close()
        await store.refresh()
        location.hash = '#/loans'
        toast(`${loan.name} is closed.`, 'ok')
      } catch (ex) { toast(ex.message, 'error') }
    })
  }

  draw({ date: now, rebate: 100, amount: null })
}

function verdictText (cmp, quote) {
  if (cmp.verdict === VERDICT.SHORT) {
    return `Your balance falls below zero on ${D.fmtDate(cmp.first_negative)}. `
         + `You cannot pay this off on that date and still pay everything else.`
  }
  if (cmp.verdict === VERDICT.TIGHT) {
    return `You can pay this off, but your balance drops below the buffer that `
         + `you keep. The lowest point is ${fmt(cmp.min_balance)} on `
         + `${D.fmtDate(cmp.min_date)}.`
  }
  return `You can pay this off. Every other payment still clears, and the lowest `
       + `balance is ${fmt(cmp.min_balance)} on ${D.fmtDate(cmp.min_date)}.`
}

const thin = series => {
  if (series.length <= 200) return series
  const step = Math.ceil(series.length / 200)
  const out = series.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1])
  return out
}

const skeletonBlock = () => `<div class="skel"><div class="skel-row"></div>
  <div class="skel-row"></div><div class="skel-row"></div></div>`

// ---------------------------------------------------------------------------
// Add a loan, or change one
// ---------------------------------------------------------------------------

export function openLoanForm (loan) {
  const isNew = !loan
  const accounts = store.state.accounts.filter(a => !a.is_archived)
    .map(a => ({ value: a.id, label: a.name }))
  const cats = [{ value: '', label: '(none)' },
    ...store.state.categories.filter(c => c.kind === 'expense')
      .map(c => ({ value: c.id, label: c.name }))]

  formSheet({
    title: isNew ? 'Add a loan' : `Change ${loan.name}`,
    size: 'lg',
    submitLabel: isNew ? 'Add the loan and build the schedule' : 'Save the loan',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'lender', label: 'Lender', type: 'text' },
      { name: 'external_ref', label: 'Reference number', type: 'text' },
      { name: 'kind', label: 'Type', type: 'select', options: [
        { value: 'loan', label: 'Loan' },
        { value: 'installment', label: 'Installment plan' },
        { value: 'credit_card', label: 'Card plan' },
        { value: 'salary_advance', label: 'Pay advance' },
        { value: 'other', label: 'Other' }] },
      { name: 'principal', label: 'Amount financed', type: 'money',
        hint: 'Leave this empty if you do not know it. The ledger then reports '
            + 'the interest as unknown instead of guessing.' },
      { name: 'fees_upfront', label: 'Charge at the start', type: 'money' },
      { name: 'fees_in_interest', label: '', type: 'switch',
        onLabel: 'The charge joins the amount before the interest' },
      { name: 'interest_method', label: 'How the interest works', type: 'select',
        options: Object.entries(INTEREST_METHOD_LABEL)
          .map(([value, label]) => ({ value, label })) },
      { name: 'rate', label: 'Rate, as a percentage', type: 'number', step: '0.0001',
        when: v => v.interest_method === 'flat' || v.interest_method === 'reducing',
        hint: 'Type 1.89 for 1.89%.' },
      { name: 'rate_period', label: 'That rate is for', type: 'segment',
        when: v => v.interest_method === 'flat' || v.interest_method === 'reducing',
        options: [{ value: 'monthly', label: 'each month' },
                  { value: 'annual', label: 'each year' }] },
      { name: 'term_count', label: 'Number of payments', type: 'number', min: 1,
        required: true },
      { name: 'term_unit', label: 'One payment every', type: 'select', options:
        Object.entries(TERM_UNIT_LABEL).map(([value, label]) => ({ value, label })) },
      { name: 'start_date', label: 'Start date', type: 'date', required: true },
      { name: 'first_due_date', label: 'First payment due', type: 'date', required: true },
      { name: 'total_payable', label: 'Total to pay, if the lender states it',
        type: 'money',
        hint: 'When you give this, the ledger uses it and does not calculate a total.' },
      { name: 'payment_amount', label: 'Each payment, if the lender states it',
        type: 'money' },
      { name: 'account_id', label: 'Pay from', type: 'select', options: accounts },
      { name: 'proceeds_account_id', label: 'The money arrived in', type: 'select',
        options: [{ value: '', label: '(not recorded)' }, ...accounts] },
      { name: 'category_id', label: 'Category', type: 'select', options: cats },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: loan ? { ...loan, rate: Number((loan.rate * 100).toFixed(4)) } : {
      kind: 'loan', interest_method: 'flat', rate_period: 'monthly',
      fees_in_interest: true, term_count: 12, term_unit: 'month',
      start_date: D.today(), first_due_date: D.addMonths(D.today(), 1),
      fees_upfront: 0, account_id: store.state.accounts[0]?.id,
    },
    extraFooter: isNew ? '' : `
      <div class="row-actions">
        <button type="button" class="btn btn-danger-ghost" data-act="delete">
          Delete this loan and its schedule</button>
      </div>`,
    onSubmit: async v => {
      const patch = {
        name: v.name, lender: v.lender, external_ref: v.external_ref, kind: v.kind,
        principal: v.principal, amount_received: v.principal,
        fees_upfront: v.fees_upfront ?? 0, fees_in_interest: v.fees_in_interest,
        interest_method: v.interest_method,
        rate: (Number(v.rate) || 0) / 100, rate_period: v.rate_period || 'monthly',
        term_count: Number(v.term_count), term_unit: v.term_unit,
        start_date: v.start_date, first_due_date: v.first_due_date,
        total_payable: v.total_payable, payment_amount: v.payment_amount,
        account_id: v.account_id || null,
        proceeds_account_id: v.proceeds_account_id || null,
        category_id: v.category_id || null, notes: v.notes,
      }

      if (isNew) {
        const created = await store.createLoan(patch)
        const built = buildSchedule({
          principal: v.principal ?? 0, fees: v.fees_upfront ?? 0,
          feesInInterest: v.fees_in_interest, method: v.interest_method,
          rate: (Number(v.rate) || 0) / 100, ratePeriod: v.rate_period || 'monthly',
          termCount: Number(v.term_count), termUnit: v.term_unit,
          firstDue: v.first_due_date,
          paymentOverride: v.payment_amount ?? null,
          totalOverride: v.total_payable ?? null,
        })
        await store.replaceSchedule(created.id, built.rows)
        await store.updateLoan(created.id, {
          total_payable: v.total_payable ?? built.total_payable,
          payment_amount: v.payment_amount ?? built.payment_amount,
        })
        await store.refresh()
        toast(`${v.name} is added with ${built.rows.length} payments.`, 'ok')
        location.hash = `#/loans/${created.id}`
      } else {
        await store.updateLoan(loan.id, patch)
        await store.refresh()
        toast('The loan is saved.', 'ok')
      }
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        if (!e.target.closest('[data-act="delete"]')) return
        const ok = await confirmSheet({
          title: 'Delete this loan?',
          message: 'The loan and every payment row go away. Money movements that '
                 + 'you already recorded stay in your accounts.',
          confirmLabel: 'Delete', danger: true,
        })
        if (!ok) return
        try {
          await store.deleteLoan(loan.id)
          sheet.close()
          await store.refresh()
          location.hash = '#/loans'
          toast('The loan is deleted.', 'ok')
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Build the schedule again
// ---------------------------------------------------------------------------

function openRebuild (loan, rows) {
  const paid = rows.filter(r => r.status === 'paid').length
  formSheet({
    title: 'Build the schedule again',
    submitLabel: 'Build it',
    fields: [
      { name: 'warn', label: '', type: 'static', render: () => `
        <p class="note">${icon('warn')} This replaces every payment that is still
        open. ${paid} paid payment${paid === 1 ? '' : 's'} stay${paid === 1 ? 's' : ''}
        as ${paid === 1 ? 'it is' : 'they are'}.</p>
        <p class="note">${icon('info')} A row that came from your workbook holds
        the exact figure that your lender bills. Build the schedule again only
        when the terms of the loan changed.</p>` },
      { name: 'first_due_date', label: 'First open payment due', type: 'date',
        required: true },
      { name: 'term_count', label: 'How many payments remain', type: 'number',
        min: 1, required: true },
    ],
    values: {
      first_due_date: rows.find(r => r.status === 'pending')?.due_date || D.today(),
      term_count: Math.max(1, rows.filter(r => r.status !== 'paid').length),
    },
    onSubmit: async v => {
      const paidRows = rows.filter(r => r.status === 'paid')
      const paidPrincipal = paidRows.reduce((a, r) => a + r.principal_component, 0)
      const left = (loan.principal ?? 0) - paidPrincipal
      const built = buildSchedule({
        principal: Math.max(0, left), fees: 0, feesInInterest: loan.fees_in_interest,
        method: loan.interest_method, rate: loan.rate, ratePeriod: loan.rate_period,
        termCount: Number(v.term_count), termUnit: loan.term_unit,
        firstDue: v.first_due_date,
        paymentOverride: loan.payment_amount ?? null,
      })
      const offset = paidRows.length
      await store.replaceSchedule(loan.id, built.rows.map((r, i) => ({
        ...r, installment_no: offset + i + 1,
      })))
      await store.refresh()
      toast('The schedule is new.', 'ok')
    },
  })
}

function openInstallmentEditor (row) {
  formSheet({
    title: `Payment ${row.installment_no}`,
    submitLabel: 'Save',
    fields: [
      { name: 'due_date', label: 'Due date', type: 'date', required: true },
      { name: 'amount_due', label: 'Amount', type: 'money', required: true },
      { name: 'principal_component', label: 'Part that pays the amount', type: 'money' },
      { name: 'interest_component', label: 'Part that pays interest', type: 'money' },
      { name: 'status', label: 'State', type: 'select', options: [
        { value: 'pending', label: 'Open' }, { value: 'paid', label: 'Paid' },
        { value: 'partial', label: 'Part paid' }, { value: 'skipped', label: 'Skipped' },
        { value: 'waived', label: 'Cancelled' }] },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: row,
    extraFooter: row.status === 'paid' ? `
      <div class="row-actions">
        <button type="button" class="btn btn-ghost" data-act="unpay">
          Not paid after all</button>
      </div>` : '',
    onSubmit: async v => {
      await store.updateLoanPayment(row.id, {
        due_date: v.due_date, amount_due: v.amount_due,
        principal_component: v.principal_component ?? 0,
        interest_component: v.interest_component ?? 0,
        status: v.status, notes: v.notes,
      })
      await store.refresh()
      toast('The payment is saved.', 'ok')
    },
    onMount (sheet) {
      sheet.el.addEventListener('click', async e => {
        if (!e.target.closest('[data-act="unpay"]')) return
        try {
          await store.unpayInstallment(row)
          sheet.close()
          await store.refresh()
          toast('The payment is open again.', 'ok')
        } catch (ex) { toast(ex.message, 'error') }
      })
    },
  })
}
