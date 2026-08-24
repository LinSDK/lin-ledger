// ============================================================================
// Lin Ledger : the forecast
//
// This module answers the question that the application exists for:
//   "With the money that I hold now and the payments that come, am I safe?"
//
// It is pure. It reads no database and it writes nothing. It takes a list of
// events and gives a balance for each day. Every "what if" screen calls the
// same function with a changed list of events, therefore a test and a real
// forecast always follow the same rules.
//
// Every amount is in centavos.
// ============================================================================

import { addDays, daysBetween, monthKey, min, max, payrollDates, today as todayIso }
  from './dates.js'

export const VERDICT = {
  SAFE: 'safe',            // the balance stays above the safety amount
  TIGHT: 'tight',          // the balance falls below the safety amount
  SHORT: 'short',          // the balance goes below zero
}

export const VERDICT_LABEL = {
  safe:  'Safe',
  tight: 'Tight',
  short: 'Not possible',
}

// ---------------------------------------------------------------------------
// 1. Make the events
// ---------------------------------------------------------------------------

/**
 * Turns the rows of the database into one list of dated money movements.
 *
 * upcoming      : rows of v_upcoming (bills and loan payments that are open)
 * payroll       : rows of payroll_events
 * categories    : rows of categories, with budget_amount and is_variable
 * profile       : the settings row
 * from, to      : the window of the forecast
 * spentByCategory : { categoryId: centavos } spent in the period that runs now
 *
 * A note about the money for food and travel: the forecast adds an allowance
 * only on a payroll date inside the window. The period that runs now gets no
 * allowance, because the money that you already spent is in your balance. The
 * period report shows how much of the allowance for this period is left.
 */
export function buildEvents ({
  upcoming = [], payroll = [], categories = [], profile = {},
  from, to, spentByCategory = {},
}) {
  const events = []
  const model = profile.variable_spend_model || 'lump_at_period_start'

  // --- bills and loan payments ---
  for (const row of upcoming) {
    const due = row.due_date
    if (due > to) continue
    const overdue = due < from
    events.push({
      date: overdue ? from : due,        // an unpaid past bill is owed now
      amount: -Math.abs(row.amount),
      kind: row.source === 'loan' ? 'loan' : 'bill',
      label: row.name,
      id: row.id,
      source_id: row.source_id,
      category_id: row.category_id,
      is_estimate: !!row.is_estimate,
      interest_part: row.interest_part ?? 0,
      due_date: due,
      overdue,
    })
  }

  // --- pay that is expected ---
  const payrollIn = payroll
    .filter(p => p.status === 'expected' && p.expected_date >= from && p.expected_date <= to)
  for (const p of payrollIn) {
    events.push({
      date: p.expected_date,
      amount: Math.abs(p.expected_amount),
      kind: 'payroll',
      label: p.label || 'Payroll',
      id: p.id,
    })
  }

  // The dates that divide one payroll period from the next.
  //
  // A recorded pay date is always the truth. Beyond the last recorded date the
  // rule in the settings proposes dates, up to the end of the window.
  //
  // This step matters. A loan can run for years, but a person records only a
  // few pay dates ahead. Without the proposed dates the forecast would show
  // the payments and none of the pay, and it would announce a deep loss that
  // will never happen.
  const realDates = payrollIn.map(p => p.expected_date)
  const lastReal = realDates.length ? realDates[realDates.length - 1] : null
  const proposeFrom = lastReal ? addDays(lastReal, 1) : from

  // How many days pass between two pay dates, for this rule.
  const cadence = { monthly: 30, semi_monthly: 15, biweekly: 14, weekly: 7 }
                  [profile.payroll_mode] ?? 15
  // A real pay date often moves a day or two, because a bank does not pay on a
  // weekend. A proposed date that lands close to a real one is that same pay,
  // therefore the forecast drops it. Without this guard the forecast would
  // count one pay twice.
  const guard = Math.max(2, Math.floor(cadence / 2))
  const nearReal = d => realDates.some(r => Math.abs(daysBetween(r, d)) < guard)

  // A rule with no amount can propose nothing useful. Adding a date but no pay
  // would book an allowance with no income to cover it, therefore the forecast
  // proposes nothing and the screen asks for the amount instead.
  const canPropose = (profile.payroll_default_amount || 0) > 0
                     && profile.payroll_mode !== 'manual'
  const proposedDates = canPropose && proposeFrom <= to
    ? payrollDates(profile, proposeFrom, to).filter(d => !nearReal(d))
    : []

  if (profile.payroll_default_amount > 0) {
    for (const d of proposedDates) {
      events.push({
        date: d, amount: Math.abs(profile.payroll_default_amount),
        kind: 'payroll', label: 'Payroll (from your rule)', proposed: true,
      })
    }
  }

  const proposed = proposedDates.length > 0
  const boundaries = [...new Set([...realDates, ...proposedDates])].sort()

  // --- the allowance for food, travel and other changeable spending ---
  const variable = categories.filter(c =>
    c.is_variable && c.kind === 'expense' && Number(c.budget_amount) > 0)

  if (model === 'lump_at_period_start') {
    const monthSeen = new Set()
    for (const d of boundaries) {
      const isFirstOfMonth = !monthSeen.has(monthKey(d))
      monthSeen.add(monthKey(d))
      for (const c of variable) {
        if (c.budget_basis === 'per_month' && !isFirstOfMonth) continue
        events.push({
          date: d,
          amount: -Math.abs(c.budget_amount),
          kind: 'variable',
          label: c.name,
          category_id: c.id,
          is_estimate: true,
        })
      }
    }
  } else if (model === 'daily_drip' || model === 'historical_average') {
    // Spread the allowance of each period across the days of that period.
    const spans = periodSpans(boundaries, from, to)
    for (const span of spans) {
      const days = Math.max(1, daysBetween(span.start, span.end) + 1)
      for (const c of variable) {
        const full = Math.abs(c.budget_amount)
        const budget = c.budget_basis === 'per_month' && spans.length > 1
          ? Math.round(full / 2) : full
        const already = span.isCurrent ? (spentByCategory[c.id] || 0) : 0
        const left = Math.max(0, budget - already)
        if (left === 0) continue
        const perDay = Math.round(left / days)
        let placed = 0
        for (let k = 0; k < days; k++) {
          const amount = k === days - 1 ? left - placed : perDay
          placed += amount
          if (amount === 0) continue
          events.push({
            date: addDays(span.start, k), amount: -amount, kind: 'variable',
            label: c.name, category_id: c.id, is_estimate: true, drip: true,
          })
        }
      }
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return {
    events, boundaries,
    payrollProposed: proposed,
    payrollProposedFrom: proposedDates[0] ?? null,
    payrollLastReal: lastReal,
    payrollHasRule: (profile.payroll_default_amount || 0) > 0,
  }
}

/** Turns a list of payroll dates into the spans between them. */
export function periodSpans (boundaries, from, to) {
  const spans = []
  const marks = boundaries.filter(d => d >= from && d <= to)
  let cursor = from
  for (const d of marks) {
    if (d > cursor) spans.push({ start: cursor, end: addDays(d, -1), isCurrent: cursor === from })
    cursor = d
  }
  if (cursor <= to) spans.push({ start: cursor, end: to, isCurrent: cursor === from })
  return spans
}

// ---------------------------------------------------------------------------
// 2. Walk the days
// ---------------------------------------------------------------------------

/**
 * Gives the balance for each day, and a summary.
 * opening : the money that you hold on the first day
 */
export function project ({ opening = 0, events = [], from, to, safetyBuffer = 0 }) {
  const byDate = new Map()
  for (const e of events) {
    if (e.date < from || e.date > to) continue
    if (!byDate.has(e.date)) byDate.set(e.date, [])
    byDate.get(e.date).push(e)
  }

  const series = []
  let balance = opening
  let minBalance = opening, minDate = from
  let firstNegative = null, firstBelowBuffer = null
  let totalIn = 0, totalOut = 0
  const dayCount = daysBetween(from, to)

  for (let k = 0; k <= dayCount; k++) {
    const date = addDays(from, k)
    const dayEvents = byDate.get(date) || []
    let delta = 0
    for (const e of dayEvents) {
      delta += e.amount
      if (e.amount >= 0) totalIn += e.amount; else totalOut -= e.amount
    }
    balance += delta
    if (balance < minBalance) { minBalance = balance; minDate = date }
    if (balance < 0 && firstNegative === null) firstNegative = date
    if (balance < safetyBuffer && firstBelowBuffer === null) firstBelowBuffer = date
    series.push({ date, delta, balance, events: dayEvents })
  }

  return {
    series,
    summary: {
      from, to, opening,
      end_balance: balance,
      min_balance: minBalance,
      min_date: minDate,
      first_negative: firstNegative,
      first_below_buffer: firstBelowBuffer,
      total_in: totalIn,
      total_out: totalOut,
      net: totalIn - totalOut,
      verdict: firstNegative ? VERDICT.SHORT
             : (safetyBuffer > 0 && firstBelowBuffer) ? VERDICT.TIGHT
             : VERDICT.SAFE,
    },
  }
}

/**
 * The payments that fall on a day when the balance is below zero. These are
 * the payments that would fail. The screen names them, because "you go
 * negative on Nov 4" is less useful than "the GLoan payment on Nov 4 fails".
 */
export function atRiskEvents (series, threshold = 0) {
  const out = []
  for (const day of series) {
    if (day.balance >= threshold) continue
    for (const e of day.events) {
      if (e.amount < 0) out.push({ ...e, balance_after: day.balance })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 3. Is each payroll period enough?
// ---------------------------------------------------------------------------

/**
 * Divides the forecast into payroll periods and judges each one.
 *
 * For each period it gives:
 *   inflow            the pay that arrives
 *   fixed_out         the bills and loan payments that must be paid
 *   variable_budget   the allowance for changeable spending
 *   available         what is left for that allowance
 *   verdict           safe, tight or short
 *   advice            which categories to cut, and by how much
 */
export function analyzePeriods ({
  series, boundaries, events, categories = [], profile = {},
  spentByCategory = {}, from, currentPeriodStart = null,
  currentPeriodKnown = false,
}) {
  const safety = Number(profile.safety_buffer) || 0
  const balanceOn = new Map(series.map(d => [d.date, d.balance]))
  const to = series.length ? series[series.length - 1].date : from
  const spans = periodSpans(boundaries, from, to)

  const variable = categories.filter(c =>
    c.is_variable && c.kind === 'expense' && Number(c.budget_amount) > 0)

  return spans.map((span, index) => {
    const inWindow = e => e.date >= span.start && e.date <= span.end
    const mine = events.filter(inWindow)

    const inflow = mine.filter(e => e.kind === 'payroll')
                       .reduce((a, e) => a + e.amount, 0)
    const fixedOut = mine.filter(e => e.kind === 'bill' || e.kind === 'loan')
                         .reduce((a, e) => a - e.amount, 0)

    // The period that runs now began on an earlier pay date. Its allowance was
    // released then, and the spending already sits in the balance. Therefore
    // the ledger shows only the part that is left.
    //
    // When no pay date on or before today is recorded, the true start of the
    // period is unknown. The ledger then claims no allowance at all, because a
    // full allowance would count money twice.
    const unknownStart = span.isCurrent && !currentPeriodKnown
    const perCategory = unknownStart ? [] : variable.map(c => {
      const full = Math.abs(c.budget_amount)
      const budget = c.budget_basis === 'per_month'
        ? (index === 0 || monthKey(span.start) !== monthKey(spans[index - 1].start) ? full : 0)
        : full
      const spent = span.isCurrent ? (spentByCategory[c.id] || 0) : 0
      return {
        category_id: c.id, name: c.name, color: c.color,
        budget, spent, remaining: Math.max(0, budget - spent),
      }
    })
    const variableBudget = perCategory.reduce((a, c) => a + c.budget, 0)
    const variableSpent = perCategory.reduce((a, c) => a + c.spent, 0)
    const variableRemaining = perCategory.reduce((a, c) => a + c.remaining, 0)

    const startBalance = balanceOn.get(span.start) ?? 0
    // The balance at the start of the period, before the events of that day.
    const openingOfPeriod = index === 0
      ? (series[0]?.balance ?? 0) - (series[0]?.delta ?? 0)
      : startBalance - (series.find(d => d.date === span.start)?.delta ?? 0)

    const available = openingOfPeriod + inflow - fixedOut - safety

    const days = series.filter(d => d.date >= span.start && d.date <= span.end)
    const minBalance = days.length ? Math.min(...days.map(d => d.balance)) : 0
    const endBalance = days.length ? days[days.length - 1].balance : 0

    let verdict = VERDICT.SAFE
    if (available < 0 || minBalance < 0) verdict = VERDICT.SHORT
    else if (available < variableRemaining) verdict = VERDICT.TIGHT

    return {
      index, start: span.start, end: span.end, is_current: span.isCurrent,
      is_partial: span.isCurrent && span.start !== boundaries[0],
      period_started: span.isCurrent ? currentPeriodStart : span.start,
      start_unknown: unknownStart,
      days: daysBetween(span.start, span.end) + 1,
      opening: openingOfPeriod, inflow, fixed_out: fixedOut,
      variable_budget: variableBudget,
      variable_spent: variableSpent,
      variable_remaining: variableRemaining,
      per_category: perCategory,
      available, min_balance: minBalance, end_balance: endBalance,
      verdict,
      advice: verdict === VERDICT.SAFE
        ? null
        : adviseTrim({ perCategory, available, span, safety }),
    }
  })
}

/**
 * Proposes a cut for each changeable category, so the plan fits the money.
 * The cut is in proportion to the amount that is left in each category,
 * because a large allowance can give more than a small one.
 */
export function adviseTrim ({ perCategory, available, span, safety = 0 }) {
  const need = perCategory.reduce((a, c) => a + c.remaining, 0)
  const room = Math.max(0, available)
  const shortfall = need - room
  if (shortfall <= 0) return null

  const pool = perCategory.filter(c => c.remaining > 0)
  const poolTotal = pool.reduce((a, c) => a + c.remaining, 0)

  let cutSoFar = 0
  const trims = pool.map((c, k) => {
    const isLast = k === pool.length - 1
    const share = isLast
      ? shortfall - cutSoFar
      : Math.round(shortfall * c.remaining / poolTotal)
    const cut = Math.min(c.remaining, share)
    cutSoFar += cut
    return {
      category_id: c.category_id, name: c.name, color: c.color,
      from: c.remaining, cut, to: c.remaining - cut,
    }
  }).filter(t => t.cut > 0)

  const daysLeft = Math.max(1, daysBetween(span.start, span.end) + 1)
  const newTotal = Math.max(0, need - shortfall)

  return {
    shortfall,
    possible: cutSoFar >= shortfall,
    uncovered: Math.max(0, shortfall - cutSoFar),
    trims,
    new_total: newTotal,
    per_day: Math.round(newTotal / daysLeft),
    days_left: daysLeft,
  }
}

// ---------------------------------------------------------------------------
// 4. What if?
// ---------------------------------------------------------------------------

/**
 * Runs the forecast a second time over a changed list of events, then compares
 * the two answers.
 *
 * mutate(events) gives back the list for the test. It must not change the
 * list that it receives.
 */
export function runScenario ({ opening, events, from, to, safetyBuffer = 0, mutate }) {
  const baseline = project({ opening, events, from, to, safetyBuffer })
  const changed = mutate([...events])
  const scenario = project({ opening, events: changed, from, to, safetyBuffer })
  return { baseline, scenario, events: changed, comparison: compare(baseline, scenario, safetyBuffer) }
}

export function compare (baseline, scenario, safetyBuffer = 0) {
  const b = baseline.summary, s = scenario.summary
  return {
    verdict: s.verdict,
    possible: s.verdict !== VERDICT.SHORT,
    min_balance: s.min_balance,
    min_date: s.min_date,
    min_balance_delta: s.min_balance - b.min_balance,
    end_balance: s.end_balance,
    end_balance_delta: s.end_balance - b.end_balance,
    first_negative: s.first_negative,
    first_negative_was: b.first_negative,
    new_negative: !!s.first_negative && !b.first_negative,
    at_risk: atRiskEvents(scenario.series, 0),
    at_risk_tight: safetyBuffer > 0 ? atRiskEvents(scenario.series, safetyBuffer) : [],
  }
}

/**
 * Test : close a loan early.
 * It removes the payments that the payoff cancels, and it adds one payment on
 * the chosen date.
 */
export function payoffScenario ({ opening, events, from, to, safetyBuffer = 0,
                                  loanId, quote }) {
  const drop = new Set(quote.dropped_ids || [])
  return runScenario({
    opening, events, from, to, safetyBuffer,
    mutate: list => {
      const kept = list.filter(e =>
        !(e.kind === 'loan' && e.source_id === loanId &&
          (drop.has(e.id) || e.due_date > quote.on_date)))
      kept.push({
        date: quote.on_date, amount: -Math.abs(quote.amount),
        kind: 'payoff', label: 'Early payoff', source_id: loanId,
      })
      return kept
    },
  })
}

/**
 * Test : take a new loan.
 * It adds the money that arrives, then it adds each payment of the schedule.
 */
export function newLoanScenario ({ opening, events, from, to, safetyBuffer = 0,
                                   drawDate, proceeds, rows, label = 'New loan' }) {
  return runScenario({
    opening, events, from, to, safetyBuffer,
    mutate: list => {
      const next = [...list]
      if (proceeds > 0) {
        next.push({ date: drawDate, amount: Math.abs(proceeds), kind: 'proceeds',
                    label: `${label} proceeds` })
      }
      for (const r of rows) {
        next.push({
          date: r.due_date, amount: -Math.abs(r.amount_due), kind: 'loan',
          label: `${label} #${r.installment_no}`,
          interest_part: r.interest_component ?? 0, due_date: r.due_date,
        })
      }
      return next
    },
  })
}

/**
 * Test : one payment that is not in the plan, for example a large purchase.
 */
export function oneOffScenario ({ opening, events, from, to, safetyBuffer = 0,
                                  date, amount, label = 'One time payment' }) {
  return runScenario({
    opening, events, from, to, safetyBuffer,
    mutate: list => [...list, { date, amount: -Math.abs(amount), kind: 'bill', label }],
  })
}

// ---------------------------------------------------------------------------
// 5. Small helpers for the screens
// ---------------------------------------------------------------------------

/** Reduces a long series to at most n points, for a small chart. */
export function thin (series, n = 120) {
  if (series.length <= n) return series
  const step = series.length / n
  const out = []
  for (let k = 0; k < n; k++) out.push(series[Math.floor(k * step)])
  const last = series[series.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** The days from today until the balance first goes below zero. */
export function daysUntilNegative (summary, from = todayIso()) {
  if (!summary.first_negative) return null
  return daysBetween(from, summary.first_negative)
}
