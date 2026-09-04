// ============================================================================
// Lin Ledger : the home screen
//
// The screen reads from the top down, and each part answers one question:
//
//   Net worth            What do I own?
//   The account cards    Where does it sit?
//   Transactions         What already happened?
//   Until your next pay  Am I safe until the money arrives?
//   Money over time      What happens after that?
//   Due, Next pay        What must I do this fortnight?
//   Largest spending     Where does the money go?
//
// The figures at the top are certain. Everything below the transactions is a
// plan, and a plan can be wrong.
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { balanceChart, attachScrubber, categoryBars } from '../charts.js'
import { icon, esc, card, verdictBadge, money, listRow, empty, toast, delegate,
         qs } from '../ui.js'
import { openPayBill, openPayInstallment, openReceivePayroll,
         openEditTransaction, openAccountSheet } from './actions.js'
import { accountEmoji, openEmojiPicker } from '../emoji.js'
import { makeListState, txListCard, wireTxList } from './tx-list.js'
import { NONE as CATEGORY_NONE } from './category.js'

// The filter and the row count of the transaction list stay between draws.
const listState = makeListState()

export async function render (host) {
  const st = store.state
  const profile = st.profile
  const now = D.today()
  const proj = store.buildProjection({ from: now })

  // The payments of the next 14 days, and anything that is late.
  const soon = proj.events
    .filter(e => (e.kind === 'bill' || e.kind === 'loan')
                 && e.date <= D.addDays(now, 14))
    .sort((a, b) => (a.due_date || a.date) < (b.due_date || b.date) ? -1 : 1)

  const nextPay = st.payroll.find(p => p.status === 'expected' && p.expected_date >= now)
  const duePay = st.payroll.filter(p => p.status === 'expected' && p.expected_date <= now)

  const period = proj.periods[0]
  const monthSpend = topCategories(D.startOfMonth(now), now)

  host.innerHTML = `
    ${netWorthHero()}

    ${accountCards()}

    ${txListCard({
      rows: st.transactions,
      state: listState,
      title: 'Transactions',
      extra: `<a class="card-link" href="#/stats">By category ${icon('chevron')}</a>`,
    })}

    ${st.reviews.length ? reviewCard(st.reviews) : ''}

    ${duePay.length ? duePayCard(duePay) : ''}

    ${period ? periodCard(period, profile) : ''}

    ${card('Money over time', `
      <div class="chart-host" id="chart-host">
        ${balanceChart(thinSeries(proj.series), {
            buffer: profile.safety_buffer,
            markers: markersFor(proj),
          })}
        <div class="chart-read" id="chart-read"></div>
      </div>
      <div class="pills">
        ${pill('Lowest', fmt(proj.summary.min_balance),
               D.fmtShort(proj.summary.min_date),
               proj.summary.min_balance < 0 ? 'bad'
               : proj.summary.min_balance < profile.safety_buffer ? 'warn' : 'ok')}
        ${pill('In ' + horizonLabel(proj), fmt(proj.summary.end_balance),
               D.fmtShort(proj.to), proj.summary.end_balance < 0 ? 'bad' : 'ok')}
        ${proj.summary.first_negative
          ? pill('Below zero', D.fmtShort(proj.summary.first_negative),
                 D.fmtRelative(proj.summary.first_negative, now), 'bad')
          : pill('Below zero', 'Never', 'in this window', 'ok')}
      </div>
      ${payrollNote(proj)}
    `, `<a class="card-link" href="#/scenarios">What if ${icon('chevron')}</a>`)}

    ${card('Due in 14 days', soon.length
      ? soon.map(rowForEvent).join('')
      : empty('Nothing is due in the next 14 days.'),
      `<a class="card-link" href="#/bills">All bills ${icon('chevron')}</a>`)}

    ${nextPay ? card('Next pay', `
      ${listRow({
        title: esc(nextPay.label || 'Payroll'),
        sub: `${D.fmtDate(nextPay.expected_date)} &middot; ${D.fmtRelative(nextPay.expected_date, now)}`,
        right: money(nextPay.expected_amount),
        rightSub: 'expected',
        attrs: `data-pay="${nextPay.id}"`,
      })}`) : ''}

    ${card('Largest spending this month', monthSpend.length
      ? categoryBars(monthSpend)
      : empty('No spending is recorded this month yet.'),
      `<a class="card-link" href="#/stats">Statistics ${icon('chevron')}</a>`)}
  `

  wire(host, proj)
}

// ---------------------------------------------------------------------------
// Net worth, and where the money sits
// ---------------------------------------------------------------------------

/**
 * Your net worth: every account, added together.
 *
 * This is the first figure on the screen, because it is the answer to "what do
 * I own". It leaves no account out. The forecast below uses a smaller figure,
 * because an account that you marked as outside the forecast holds money that
 * does not pay a bill. The card says so when the two figures differ.
 */
function netWorthHero () {
  const worth = store.netWorth()
  const liquid = store.liquidity()
  const excluded = worth - liquid

  return `
    <section class="hero">
      <p class="hero-label">Net worth</p>
      <p class="hero-value ${worth < 0 ? 'neg' : ''}">${fmt(worth)}</p>
      <p class="hero-note">
        ${excluded !== 0
          ? `${fmt(liquid)} of this counts in the forecast.
             ${fmt(excluded)} sits in accounts that you left out.`
          : 'Every account counts in the forecast.'}
      </p>
    </section>`
}

/**
 * One card for each account, and a card to add one more.
 *
 * The card holds two targets. The emoji opens the picker, and the rest of the
 * card opens the account. Therefore a person changes the mark without leaving
 * the home screen, and one tap anywhere else still reaches the movements.
 */
function accountCards () {
  const rows = store.state.balances.filter(b => !b.is_archived)

  return `
    <div class="acct-grid">
      ${rows.map(b => {
        const account = store.accountById(b.account_id)
        return `
        <section class="acct-card ${b.include_in_liquidity ? '' : 'is-off'}">
          <button class="acct-emoji" data-emoji-for="${b.account_id}"
                  aria-label="Change the mark of ${esc(b.name)}"
                  title="Change the mark">${esc(accountEmoji(account || b))}</button>
          <button class="acct-open" data-open-account="${b.account_id}">
            <span class="acct-name">${esc(b.name)}</span>
            <span class="acct-value ${b.balance < 0 ? 'neg' : ''}">${fmt(b.balance)}</span>
            <span class="acct-sub">
              ${b.tx_count} ${b.tx_count === 1 ? 'movement' : 'movements'}
              ${b.include_in_liquidity ? '' : ' &middot; not in the forecast'}
            </span>
          </button>
        </section>`
      }).join('')}

      <button class="acct-card acct-add" id="acct-add">
        <span class="acct-add-mark">${icon('plus')}</span>
        <span class="acct-name">Add an account</span>
        <span class="acct-sub">A bank, a wallet, cash or coins</span>
      </button>
    </div>`
}

// ---------------------------------------------------------------------------
// The other pieces
// ---------------------------------------------------------------------------

function reviewCard (reviews) {
  return `
  <details class="card card-review">
    <summary>
      ${icon('warn')}
      <span class="rv-title">Please check ${reviews.length}
        ${reviews.length === 1 ? 'item' : 'items'}</span>
      ${icon('chevron', 'rv-chev')}
    </summary>
    <div class="card-body">
      <p class="note">Your workbook gave two different values in these places.
        The ledger made a choice, and it shows you both values.</p>
      ${reviews.map(r => `
        <details class="review">
          <summary>
            <span>${esc(r.title)}</span>
            ${icon('chevron', 'sum-chev')}
          </summary>
          <div class="review-body">
            <p>${esc(r.detail)}</p>
            <div class="review-pair">
              <span class="tag">${esc(r.source_a || '')}</span>
              <span class="tag">${esc(r.source_b || '')}</span>
            </div>
            <button class="btn btn-ghost btn-sm" data-dismiss="${r.id}">
              ${icon('check')} I understand</button>
          </div>
        </details>`).join('')}
    </div>
  </details>`
}

function duePayCard (list) {
  return card('Pay that is due', list.map(p => listRow({
    title: esc(p.label || 'Payroll'),
    sub: `Expected ${D.fmtDate(p.expected_date)} &middot; ${D.fmtRelative(p.expected_date)}`,
    right: money(p.expected_amount),
    rightSub: 'tap to record',
    kind: 'row-attn',
    attrs: `data-pay="${p.id}"`,
  })).join(''))
}

function periodCard (period, profile) {
  const cls = { safe: 'ok', tight: 'warn', short: 'bad' }[period.verdict]
  const advice = period.advice

  return `
  <section class="card card-verdict verdict-${cls}">
    <header class="card-head">
      <h3>${period.is_partial ? 'Until your next pay' : 'This pay period'}</h3>
      ${verdictBadge(period.verdict)}
    </header>
    <div class="card-body">
      <p class="period-range">
        ${D.fmtDate(period.start)} to ${D.fmtDate(period.end)}
        &middot; ${period.days} ${period.days === 1 ? 'day' : 'days'}
      </p>

      <div class="ledger-lines">
        ${line('Money at the start', period.opening)}
        ${period.inflow ? line('Pay that arrives', period.inflow) : ''}
        ${period.fixed_out ? line('Bills and loans', -period.fixed_out) : ''}
        ${profile.safety_buffer ? line('Buffer that you keep', -profile.safety_buffer) : ''}
        <div class="ledger-line is-total">
          <span>Left for daily spending</span>
          <span class="${period.available < 0 ? 'neg' : 'pos'}">${fmt(period.available)}</span>
        </div>
      </div>

      ${period.start_unknown ? `
        <p class="note">${icon('info')} The allowance for the period that runs now
          arrived on an earlier pay date, and your spending from it is already in
          the balance above. Therefore the ledger adds no allowance here. Your
          next allowance arrives with your next pay.</p>` : ''}

      ${period.variable_budget ? `
        <div class="alw">
          <div class="alw-head">
            <span>Your allowance for this period</span>
            <span>${fmt(period.variable_remaining)} left of ${fmt(period.variable_budget)}</span>
          </div>
          ${period.per_category.map(c => {
            const used = c.budget > 0 ? Math.min(100, (c.spent / c.budget) * 100) : 0
            return `
            <button class="alw-row is-tap" data-category="${esc(c.category_id)}">
              <span class="alw-name"><i class="dot" style="background:${esc(c.color || 'var(--accent)')}"></i>${esc(c.name)}</span>
              <span class="alw-track"><span class="alw-fill" style="width:${used.toFixed(0)}%;background:${esc(c.color || 'var(--accent)')}"></span></span>
              <span class="alw-val">${fmt(c.remaining)}</span>
            </button>`
          }).join('')}
        </div>` : ''}

      ${advice ? adviceBlock(advice, period) : `
        <p class="verdict-msg">
          ${icon('check')} ${period.start_unknown
            ? 'Your money covers every payment before your next pay arrives.'
            : 'Your money covers every payment and your full allowance in this period.'}
        </p>`}
    </div>
  </section>`
}

function adviceBlock (advice, period) {
  return `
  <div class="advice">
    <p class="advice-head">
      ${icon('warn')}
      ${advice.possible
        ? `You are short by ${fmt(advice.shortfall)}. Cut this much to fit:`
        : `You are short by ${fmt(advice.shortfall)}. Cutting every allowance
           still leaves ${fmt(advice.uncovered)} uncovered.`}
    </p>
    <table class="trim">
      <thead><tr><th>Category</th><th>Now</th><th>Cut</th><th>New</th></tr></thead>
      <tbody>
        ${advice.trims.map(t => `
          <tr>
            <td><i class="dot" style="background:${esc(t.color || 'var(--accent)')}"></i>${esc(t.name)}</td>
            <td>${fmt(t.from)}</td>
            <td class="neg">${fmt(t.cut)}</td>
            <td class="pos">${fmt(t.to)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="advice-day">
      That leaves <strong>${fmt(advice.new_total)}</strong> for
      ${advice.days_left} days, which is
      <strong>${fmt(advice.per_day)} each day</strong>.
    </p>
    ${!advice.possible ? `<p class="note">${icon('info')} Cutting daily spending is
      not enough. Move a payment to a later date, or add money to an account.</p>` : ''}
  </div>`
}

const line = (label, value) => `
  <div class="ledger-line">
    <span>${esc(label)}</span>
    <span class="${value < 0 ? 'neg' : ''}">${fmt(value)}</span>
  </div>`

function pill (label, value, sub, kind) {
  return `<div class="pill pill-${kind}">
    <span class="pill-label">${esc(label)}</span>
    <span class="pill-value">${esc(value)}</span>
    <span class="pill-sub">${esc(sub)}</span>
  </div>`
}

function rowForEvent (e) {
  const late = e.overdue
  const dateText = late
    ? `<span class="late">Late since ${D.fmtDate(e.due_date)}</span>`
    : `${D.fmtDate(e.due_date || e.date)} &middot; ${D.fmtRelative(e.due_date || e.date)}`
  return listRow({
    title: esc(e.label),
    sub: dateText + (e.is_estimate ? ' &middot; estimate' : ''),
    right: money(e.amount),
    rightSub: e.kind === 'loan' ? 'loan' : 'bill',
    kind: late ? 'row-attn' : '',
    attrs: `data-item="${e.id}" data-kind="${e.kind}"`,
  })
}

/**
 * Says which pay dates are real and which come from the rule.
 * Without this note a person could read a forecast that holds months of
 * payments and no pay, and believe a loss that will never happen.
 */
function payrollNote (proj) {
  const last = proj.payrollLastReal
  if (!proj.payrollProposed) {
    // No date is proposed. Warn only when payments run past the last pay date.
    if (last && last < proj.to) {
      return `<p class="note">${icon('warn')} Your pay dates end on
        ${D.fmtDate(last)}, and the forecast runs to ${D.fmtDate(proj.to)}.
        Therefore the part after ${D.fmtDate(last)} counts payments and no pay.
        <a href="#/payroll">Add your pay dates</a>, or
        <a href="#/settings">set the amount that you expect</a>.</p>`
    }
    return ''
  }
  return `<p class="note">${icon('info')}
    ${last
      ? `Your recorded pay dates end on ${D.fmtDate(last)}. After that day the
         forecast uses the rule in your settings, which is
         ${fmt(store.state.profile.payroll_default_amount)} on each pay date.`
      : `No pay date is recorded, therefore the forecast uses the rule in your
         settings.`}
    <a href="#/payroll">Add your real dates</a> when you know them.</p>`
}

function markersFor (proj) {
  const out = []
  if (proj.summary.min_date) out.push({ date: proj.summary.min_date, kind: 'min' })
  if (proj.summary.first_negative) out.push({ date: proj.summary.first_negative, kind: 'bad' })
  return out
}

function thinSeries (series) {
  if (series.length <= 200) return series
  const step = Math.ceil(series.length / 200)
  const out = series.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== series[series.length - 1]) out.push(series[series.length - 1])
  return out
}

function horizonLabel (proj) {
  const days = D.daysBetween(proj.from, proj.to)
  if (days >= 360) return Math.round(days / 365) + 'y'
  if (days >= 60) return Math.round(days / 30) + ' months'
  return days + ' days'
}

/** The largest spending of the month, by category. */
function topCategories (from, to, limit = 4) {
  // store.spentByCategory takes change and a refund away from the category,
  // therefore a purchase that gave money back reads at its true cost.
  const byCat = store.spentByCategory(from, to)
  return Object.entries(byCat)
    .filter(([, value]) => value !== 0)
    .map(([id, value]) => {
      const cat = store.categoryById(id)
      const budget = cat?.budget_amount
        ? (cat.budget_basis === 'per_period' ? cat.budget_amount * 2 : cat.budget_amount)
        : null
      // The id makes the bar a button. A row with no category still opens, and
      // it opens on the address "none", because that money really moved too.
      return { id: cat ? cat.id : CATEGORY_NONE,
               label: cat?.name || 'Not in a category', value, budget, color: cat?.color }
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wire (host, proj) {
  // Drag across the chart to read one day.
  const chartHost = qs('#chart-host', host)
  const readout = qs('#chart-read', host)
  if (chartHost && readout) {
    const points = thinSeries(proj.series)
    attachScrubber(chartHost, points, point => {
      if (!point) { readout.innerHTML = ''; return }
      const names = point.events.filter(e => e.amount !== 0)
        .map(e => `${esc(e.label)} ${fmt(e.amount)}`).join(' &middot; ')
      readout.innerHTML = `
        <strong>${D.fmtDay(point.date)}</strong>
        <span class="${point.balance < 0 ? 'neg' : ''}">${fmt(point.balance)}</span>
        ${names ? `<em>${names}</em>` : ''}`
    })
  }

  wireTxList(host, listState, () => render(host))

  qs('#acct-add', host)?.addEventListener('click', () => openAccountSheet(null))

  delegate(host, 'click', '[data-tx]', (e, node) => {
    const t = store.state.transactions.find(x => x.id === node.dataset.tx)
    if (t) openEditTransaction(t)
  })

  delegate(host, 'click', '[data-open-account]', (e, node) => {
    location.hash = `#/account/${node.dataset.openAccount}`
  })

  delegate(host, 'click', '[data-category]', (e, node) => {
    location.hash = `#/category/${node.dataset.category}`
  })

  delegate(host, 'click', '[data-emoji-for]', (e, node) => {
    e.stopPropagation()
    const account = store.accountById(node.dataset.emojiFor)
    if (account) openEmojiPicker(account)
  })

  delegate(host, 'click', '[data-pay]', (e, node) => {
    const event = store.state.payroll.find(p => p.id === node.dataset.pay)
    if (event) openReceivePayroll(event)
  })

  delegate(host, 'click', '[data-item]', (e, node) => {
    const { item, kind } = node.dataset
    if (kind === 'loan') {
      const row = store.state.loanPayments.find(p => p.id === item)
      if (row) openPayInstallment(row)
    } else {
      const bill = store.state.scheduled.find(b => b.id === item)
      if (bill) openPayBill(bill)
    }
  })

  delegate(host, 'click', '[data-dismiss]', async (e, node) => {
    e.preventDefault()
    try {
      await store.dismissReview(node.dataset.dismiss)
      await store.refresh()
    } catch (ex) { toast(ex.message, 'error') }
  })
}
