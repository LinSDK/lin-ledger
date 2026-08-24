// ============================================================================
// Lin Ledger : the "what if" screen
//
// Two tests:
//   A new loan on a chosen day. Does the balance go below zero later?
//   One large payment on a chosen day. Can the money take it?
//
// Both tests call the same forecast that the home screen calls. Therefore a
// test and the real forecast can never disagree.
// ============================================================================

import * as store from '../store.js'
import { fmt, fmtPct, parseMoney } from '../money.js'
import * as D from '../dates.js'
import { balanceChart } from '../charts.js'
import { icon, esc, card, empty, toast, delegate, qs, qsa, verdictBadge,
         confirmSheet } from '../ui.js'
import { buildSchedule, INTEREST_METHOD_LABEL, TERM_UNIT_LABEL } from '../amortize.js'
import { newLoanScenario, oneOffScenario, VERDICT } from '../projection.js'
import { openLoanForm } from './loans.js'

let mode = 'loan'
let form = {
  amount: 1000000, fees: 0, rate: 2, method: 'flat', terms: 6, unit: 'month',
  draw: D.today(), firstDue: D.addMonths(D.today(), 1), horizon: 365,
  oneOff: 500000, oneOffDate: D.addDays(D.today(), 14),
}

export async function render (host) {
  host.innerHTML = `
    <div class="segment segment-wide">
      <button class="seg ${mode === 'loan' ? 'is-on' : ''}" data-mode="loan">
        Take a loan</button>
      <button class="seg ${mode === 'buy' ? 'is-on' : ''}" data-mode="buy">
        One large payment</button>
    </div>
    <div id="sim"></div>`

  delegate(host, 'click', '[data-mode]', (e, b) => { mode = b.dataset.mode; render(host) })
  draw(host)
}

function draw (host) {
  const slot = qs('#sim', host)
  const profile = store.state.profile
  const now = D.today()
  const to = D.addDays(now, Number(form.horizon))
  const base = store.buildProjection({ from: now, to })

  let result, built = null, summary
  if (mode === 'loan') {
    built = buildSchedule({
      principal: form.amount, fees: form.fees, feesInInterest: true,
      method: form.method, rate: Number(form.rate) / 100, ratePeriod: 'monthly',
      termCount: Number(form.terms), termUnit: form.unit, firstDue: form.firstDue,
    })
    result = newLoanScenario({
      opening: base.opening, events: base.events, from: base.from, to: base.to,
      safetyBuffer: base.safetyBuffer,
      drawDate: form.draw, proceeds: form.amount - form.fees,
      rows: built.rows, label: 'New loan',
    })
    summary = {
      cash: form.amount - form.fees,
      total: built.total_payable,
      interest: built.interest_total,
      payment: built.payment_amount,
    }
  } else {
    result = oneOffScenario({
      opening: base.opening, events: base.events, from: base.from, to: base.to,
      safetyBuffer: base.safetyBuffer,
      date: form.oneOffDate, amount: form.oneOff, label: 'Large payment',
    })
  }

  const cmp = result.comparison
  const cls = { safe: 'ok', tight: 'warn', short: 'bad' }[cmp.verdict]

  slot.innerHTML = `
    ${mode === 'loan' ? loanForm() : buyForm()}

    <section class="card card-verdict verdict-${cls}">
      <header class="card-head">
        <h3>The answer</h3>${verdictBadge(cmp.verdict)}
      </header>
      <div class="card-body">
        <p class="verdict-msg">${answerText(cmp, mode)}</p>
        <div class="grid2">
          ${mode === 'loan' ? `
            ${fact('Cash you receive', fmt(summary.cash), 'pos')}
            ${fact('Each payment', fmt(summary.payment), 'neg')}
            ${fact('Total you repay', fmt(summary.total), 'neg')}
            ${fact('Interest you pay', fmt(summary.interest), 'neg')}
            ${fact('Cost of the money', summary.cash > 0
              ? fmtPct(summary.interest / summary.cash, 1) : '--', 'neg')}
          ` : `
            ${fact('The payment', fmt(form.oneOff), 'neg')}
            ${fact('On', D.fmtDate(form.oneOffDate))}
          `}
          ${fact('Lowest balance', fmt(cmp.min_balance),
                 cmp.min_balance < 0 ? 'neg' : 'pos')}
          ${fact('On that day', D.fmtDate(cmp.min_date))}
          ${fact('Change to the lowest', fmt(cmp.min_balance_delta),
                 cmp.min_balance_delta < 0 ? 'neg' : 'pos')}
        </div>
      </div>
    </section>

    ${cmp.at_risk.length ? `
      <section class="card">
        <header class="card-head"><h3>${icon('warn')} These payments would fail</h3></header>
        <div class="card-body risk">
          ${cmp.at_risk.slice(0, 10).map(e => `
            <div class="risk-row">
              <span>${esc(e.label)}</span>
              <span>${D.fmtDate(e.due_date || e.date)}</span>
              <span class="neg">${fmt(e.amount)}</span>
              <span class="muted">balance ${fmt(e.balance_after)}</span>
            </div>`).join('')}
          ${cmp.at_risk.length > 10
            ? `<p class="hint">and ${cmp.at_risk.length - 10} more.</p>` : ''}
        </div>
      </section>` : ''}

    ${card('Money over time', `
      <div class="chart-host">
        ${balanceChart(thin(result.scenario.series), {
            compare: thin(result.baseline.series), buffer: profile.safety_buffer })}
        <p class="legend">
          <span class="lg lg-line"></span> with this plan
          <span class="lg lg-dash"></span> as it is now
        </p>
      </div>
      <div class="field">
        <label for="hz">How far ahead: ${horizonText(form.horizon)}</label>
        <input id="hz" class="rng" type="range" min="30" max="1095" step="15"
               value="${form.horizon}">
      </div>
    `)}

    ${mode === 'loan' ? `
      <div class="stack">
        <button class="btn ${cmp.possible ? 'btn-primary' : 'btn-danger'} btn-block"
                id="make-real">
          ${icon('save')} Add this loan for real</button>
        ${!cmp.possible
          ? '<p class="hint center">The ledger advises against this loan.</p>' : ''}
      </div>` : ''}

    ${mode === 'loan' && built ? card('The payments of this loan', `
      <div class="table-scroll">
        <table class="sched">
          <thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Interest</th>
            <th>Left after</th></tr></thead>
          <tbody>
            ${built.rows.map(r => `<tr>
              <td>${r.installment_no}</td>
              <td>${D.fmtShort(r.due_date)}<span class="yr">${D.parts(r.due_date).y}</span></td>
              <td class="num">${fmt(r.amount_due)}</td>
              <td class="num neg">${fmt(r.interest_component)}</td>
              <td class="num muted">${fmt(r.balance_after)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`) : ''}`

  wireSim(host)
}

const fact = (label, value, cls = '') =>
  `<div class="fact"><span>${esc(label)}</span><strong class="${cls}">${value}</strong></div>`

function loanForm () {
  return `
  <section class="card">
    <header class="card-head"><h3>The loan that you are thinking about</h3></header>
    <div class="card-body">
      <div class="grid2 form-grid">
        <div class="field"><label for="s-amount">Amount financed</label>
          <input id="s-amount" class="inp inp-money" inputmode="decimal"
                 value="${fmt(form.amount, { style: 'minus' })}"></div>
        <div class="field"><label for="s-fees">Charge at the start</label>
          <input id="s-fees" class="inp inp-money" inputmode="decimal"
                 value="${fmt(form.fees, { style: 'minus' })}"></div>
        <div class="field"><label for="s-rate">Rate, each month, as a percentage</label>
          <input id="s-rate" class="inp" type="number" step="0.01" value="${form.rate}"></div>
        <div class="field"><label for="s-method">How the interest works</label>
          <select id="s-method" class="inp">
            ${Object.entries(INTEREST_METHOD_LABEL).filter(([k]) => k !== 'custom')
              .map(([k, v]) => `<option value="${k}" ${k === form.method ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="s-terms">Number of payments</label>
          <input id="s-terms" class="inp" type="number" min="1" value="${form.terms}"></div>
        <div class="field"><label for="s-unit">One payment every</label>
          <select id="s-unit" class="inp">
            ${Object.entries(TERM_UNIT_LABEL).map(([k, v]) =>
              `<option value="${k}" ${k === form.unit ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="s-draw">Money arrives on</label>
          <input id="s-draw" class="inp" type="date" value="${form.draw}"></div>
        <div class="field"><label for="s-first">First payment due</label>
          <input id="s-first" class="inp" type="date" value="${form.firstDue}"></div>
      </div>
    </div>
  </section>`
}

function buyForm () {
  return `
  <section class="card">
    <header class="card-head"><h3>The payment that you are thinking about</h3></header>
    <div class="card-body">
      <div class="grid2 form-grid">
        <div class="field"><label for="s-one">Amount</label>
          <input id="s-one" class="inp inp-money" inputmode="decimal"
                 value="${fmt(form.oneOff, { style: 'minus' })}"></div>
        <div class="field"><label for="s-onedate">On</label>
          <input id="s-onedate" class="inp" type="date" value="${form.oneOffDate}"></div>
      </div>
    </div>
  </section>`
}

function answerText (cmp, mode) {
  const what = mode === 'loan' ? 'take this loan' : 'make this payment'
  if (cmp.verdict === VERDICT.SHORT) {
    return `No. If you ${what}, your balance falls below zero on `
         + `${D.fmtDate(cmp.first_negative)}. `
         + (cmp.new_negative
            ? 'Without it, your balance stays above zero for the whole window.'
            : `Your balance already went below zero on ${D.fmtDate(cmp.first_negative_was)}.`)
  }
  if (cmp.verdict === VERDICT.TIGHT) {
    return `Yes, but it is tight. The lowest point is ${fmt(cmp.min_balance)} on `
         + `${D.fmtDate(cmp.min_date)}, which is under the buffer that you keep.`
  }
  return `Yes. Every payment still clears. The lowest point is `
       + `${fmt(cmp.min_balance)} on ${D.fmtDate(cmp.min_date)}.`
}

const horizonText = d => d >= 365 ? `${(d / 365).toFixed(1)} years` : `${d} days`

const thin = series => {
  if (series.length <= 200) return series
  const step = Math.ceil(series.length / 200)
  const out = series.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1])
  return out
}

function wireSim (host) {
  const on = (id, event, fn) => qs(id, host)?.addEventListener(event, fn)
  const num = id => Number(qs(id, host)?.value || 0)
  const cash = id => parseMoney(qs(id, host)?.value || '0') ?? 0

  const update = patch => { Object.assign(form, patch); draw(host) }

  on('#s-amount', 'change', () => update({ amount: cash('#s-amount') }))
  on('#s-fees', 'change', () => update({ fees: cash('#s-fees') }))
  on('#s-rate', 'change', () => update({ rate: num('#s-rate') }))
  on('#s-method', 'change', () => update({ method: qs('#s-method', host).value }))
  on('#s-terms', 'change', () => update({ terms: Math.max(1, num('#s-terms')) }))
  on('#s-unit', 'change', () => update({ unit: qs('#s-unit', host).value }))
  on('#s-draw', 'change', () => update({ draw: qs('#s-draw', host).value }))
  on('#s-first', 'change', () => update({ firstDue: qs('#s-first', host).value }))
  on('#s-one', 'change', () => update({ oneOff: cash('#s-one') }))
  on('#s-onedate', 'change', () => update({ oneOffDate: qs('#s-onedate', host).value }))
  on('#hz', 'change', () => update({ horizon: num('#hz') }))

  on('#make-real', 'click', () => {
    openLoanForm(null)
    // Fill the real form with the numbers of the test.
    setTimeout(() => {
      const set = (name, value) => {
        const node = document.querySelector(`.sheet-back.is-in [name="${name}"]`)
        if (node) node.value = value
      }
      set('principal', fmt(form.amount, { style: 'minus' }))
      set('fees_upfront', fmt(form.fees, { style: 'minus' }))
      set('rate', form.rate)
      set('interest_method', form.method)
      set('term_count', form.terms)
      set('term_unit', form.unit)
      set('start_date', form.draw)
      set('first_due_date', form.firstDue)
    }, 60)
  })
}
