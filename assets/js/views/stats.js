// ============================================================================
// Lin Ledger : the statistics screen
//
// Two questions: where does the money go, and what does the borrowing cost?
// ============================================================================

import * as store from '../store.js'
import { fmt, fmtPct, fmtCompact } from '../money.js'
import * as D from '../dates.js'
import { categoryBars, monthBars } from '../charts.js'
import { icon, esc, card, empty, money, delegate, qs, qsa, listRow } from '../ui.js'
import { effectiveApr } from '../amortize.js'

let range = 'month'

const RANGES = [
  { key: 'period', label: 'This pay period' },
  { key: 'month',  label: 'This month' },
  { key: 'm3',     label: '3 months' },
  { key: 'all',    label: 'Everything' },
]

export async function render (host) {
  const st = store.state
  const now = D.today()
  const span = spanFor(range, now)
  const tx = st.transactions.filter(t =>
    t.occurred_on >= span.from && t.occurred_on <= span.to)

  const spend = byCategory(tx, 'expense', span)
  const income = tx.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0)
  const outgo = tx.filter(t => t.type === 'expense').reduce((a, t) => a - t.amount, 0)

  const interestPaid = store.interestPaidAllTime()
  const interestLeft = store.interestRemainingAllTime()
  const debt = store.totalDebt()
  const liquid = store.liquidity()

  const borrowed = st.loans.reduce((a, l) => a + (l.principal ?? 0), 0)
  const charges = st.loans.reduce((a, l) => a + (l.fees_upfront ?? 0), 0)
  const knownLoans = st.loans.filter(l => l.principal !== null)
  const unknownCount = st.loans.length - knownLoans.length

  host.innerHTML = `
    <div class="segment segment-wide" id="range">
      ${RANGES.map(r => `<button class="seg ${r.key === range ? 'is-on' : ''}"
        data-range="${r.key}">${esc(r.label)}</button>`).join('')}
    </div>
    <p class="pane-note">${D.fmtDate(span.from)} to ${D.fmtDate(span.to)}</p>

    ${card('In and out', `
      <div class="grid3">
        <div class="fact"><span>Money in</span><strong class="pos">${fmt(income)}</strong></div>
        <div class="fact"><span>Money out</span><strong class="neg">${fmt(outgo)}</strong></div>
        <div class="fact"><span>Kept</span>
          <strong class="${income - outgo < 0 ? 'neg' : 'pos'}">${fmt(income - outgo)}</strong></div>
      </div>
      ${income > 0 ? `<p class="note">${icon('info')} You kept
        ${fmtPct((income - outgo) / income, 0)} of the money that came in.</p>` : ''}
    `)}

    ${card('Largest spending by category', spend.length
      ? categoryBars(spend)
      : empty('No spending is recorded in this period.'))}

    ${card('Each month', monthBars(monthSeries(6)), '')}

    ${card('What the borrowing costs', `
      <div class="grid2">
        <div class="fact"><span>Interest already paid</span>
          <strong class="neg">${fmt(interestPaid)}</strong></div>
        <div class="fact"><span>Interest still to come</span>
          <strong class="neg">${fmt(interestLeft)}</strong></div>
        <div class="fact"><span>Charges at the start</span>
          <strong class="neg">${fmt(charges)}</strong></div>
        <div class="fact"><span>Total cost of credit</span>
          <strong class="neg">${fmt(interestPaid + interestLeft + charges)}</strong></div>
        <div class="fact"><span>Total borrowed</span><strong>${fmt(borrowed)}</strong></div>
        <div class="fact"><span>Cost for each 100 borrowed</span>
          <strong class="neg">${borrowed > 0
            ? fmt(Math.round((interestPaid + interestLeft + charges) * 10000 / borrowed))
            : '--'}</strong></div>
      </div>
      ${unknownCount ? `<p class="note">${icon('warn')} ${unknownCount}
        plan${unknownCount === 1 ? '' : 's'} ${unknownCount === 1 ? 'has' : 'have'}
        no original amount, therefore the figures above leave
        ${unknownCount === 1 ? 'it' : 'them'} out.</p>` : ''}
    `)}

    ${card('Cost of each loan', st.loanStats.length
      ? loanCostTable(st.loanStats)
      : empty('You have no loan.'))}

    ${card('Money against debt', `
      <div class="grid2">
        <div class="fact"><span>Money on hand</span><strong class="pos">${fmt(liquid)}</strong></div>
        <div class="fact"><span>Debt still open</span><strong class="neg">${fmt(debt)}</strong></div>
        <div class="fact"><span>The difference</span>
          <strong class="${liquid - debt < 0 ? 'neg' : 'pos'}">${fmt(liquid - debt)}</strong></div>
        <div class="fact"><span>Months of debt at your pay</span>
          <strong>${monthsOfPay(debt)}</strong></div>
      </div>
    `)}

    ${card('Pay: the estimate against the true amount', payrollTable())}
  `

  delegate(host, 'click', '[data-range]', (e, b) => {
    range = b.dataset.range
    render(host)
  })
  delegate(host, 'click', '[data-loan]', (e, node) => {
    location.hash = `#/loans/${node.dataset.loan}`
  })
}

// ---------------------------------------------------------------------------

function spanFor (key, now) {
  if (key === 'period') {
    return { from: store.currentPeriodStart(now), to: now }
  }
  if (key === 'month') return { from: D.startOfMonth(now), to: now }
  if (key === 'm3') return { from: D.addMonths(D.startOfMonth(now), -2), to: now }
  const first = store.state.transactions
    .map(t => t.occurred_on).sort()[0] || D.startOfMonth(now)
  return { from: first, to: now }
}

function byCategory (tx, type, span) {
  const months = Math.max(1, Math.round(
    (D.daysBetween(span.from, span.to) + 1) / 30.44))
  const bag = {}
  for (const t of tx) {
    if (t.type !== type) continue
    bag[t.category_id] = (bag[t.category_id] || 0) + Math.abs(t.amount)
  }
  return Object.entries(bag).map(([id, value]) => {
    const c = store.categoryById(id)
    let budget = null
    if (c?.budget_amount) {
      // A per period budget arrives twice each month, therefore a month holds two.
      const perMonth = c.budget_basis === 'per_period'
        ? c.budget_amount * 2 : c.budget_amount
      budget = Math.round(perMonth * months)
    }
    return { label: c?.name || 'Not in a category', value, budget, color: c?.color }
  }).sort((a, b) => b.value - a.value)
}

function monthSeries (count) {
  const now = D.today()
  const out = []
  for (let k = count - 1; k >= 0; k--) {
    const start = D.startOfMonth(D.addMonths(now, -k))
    const end = D.endOfMonth(start)
    const spent = store.state.transactions
      .filter(t => t.type === 'expense' && t.occurred_on >= start && t.occurred_on <= end)
      .reduce((a, t) => a - t.amount, 0)
    out.push({ label: D.fmtMonth(start).split(' ')[0], value: spent })
  }
  return out.filter((x, i) => x.value !== 0 || i >= count - 3)
}

function loanCostTable (stats) {
  return `
  <div class="table-scroll">
    <table class="sched">
      <thead><tr><th>Loan</th><th>Received</th><th>Total to pay</th>
        <th>Interest</th><th>Cost</th><th>True yearly cost</th></tr></thead>
      <tbody>
        ${stats.map(s => {
          const rows = store.paymentsOfLoan(s.loan_id)
          const apr = s.principal === null ? null
            : effectiveApr({ amountReceived: s.amount_received ?? s.principal,
                             rows, termUnit: s.term_unit })
          const cost = s.principal === null ? null
            : (s.total_payable ?? 0) - s.principal
          return `
          <tr data-loan="${s.loan_id}">
            <td>${esc(s.name)}</td>
            <td class="num">${s.principal === null ? '--' : fmt(s.amount_received ?? s.principal)}</td>
            <td class="num">${fmt(s.total_payable ?? 0)}</td>
            <td class="num neg">${s.principal === null ? '--' : fmt(s.interest_total)}</td>
            <td class="num neg">${cost === null ? '--'
              : fmtPct(cost / (s.principal || 1), 1)}</td>
            <td class="num">${apr === null ? '--' : fmtPct(apr, 1)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div>
  <p class="hint">The true yearly cost counts the charge that the lender takes
    at the start, therefore it is higher than the quoted rate.</p>`
}

function monthsOfPay (debt) {
  const pay = store.state.profile?.payroll_default_amount || 0
  const perMonth = store.state.profile?.payroll_mode === 'semi_monthly' ? pay * 2 : pay
  if (!perMonth) return '--'
  return (debt / perMonth).toFixed(1)
}

function payrollTable () {
  const got = store.state.payroll.filter(p => p.status === 'received')
  if (!got.length) {
    return empty('No pay is recorded yet. Record your pay to see how the estimate '
               + 'compares with the true amount.')
  }
  const diff = got.reduce((a, p) => a + ((p.actual_amount ?? 0) - p.expected_amount), 0)
  return `
  <div class="table-scroll">
    <table class="sched">
      <thead><tr><th>Date</th><th>Expected</th><th>Received</th><th>Difference</th></tr></thead>
      <tbody>
        ${got.slice(-12).reverse().map(p => {
          const d = (p.actual_amount ?? 0) - p.expected_amount
          return `<tr>
            <td>${D.fmtDate(p.actual_date || p.expected_date)}</td>
            <td class="num">${fmt(p.expected_amount)}</td>
            <td class="num">${fmt(p.actual_amount ?? 0)}</td>
            <td class="num ${d < 0 ? 'neg' : d > 0 ? 'pos' : 'muted'}">
              ${d === 0 ? 'the same' : fmt(d)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div>
  <p class="hint">Across ${got.length} payments you received
    ${diff === 0 ? 'exactly what you expected'
      : diff > 0 ? `${fmt(diff)} more than you expected`
      : `${fmt(-diff)} less than you expected`}.</p>`
}
