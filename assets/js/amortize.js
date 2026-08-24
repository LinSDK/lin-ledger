// ============================================================================
// Lin Ledger : payment schedules
//
// This module makes a payment schedule for a new loan, and it quotes the cost
// to close a loan early.
//
// An important rule: a schedule that this module makes is only a first draft.
// Every row stays editable, and a row that comes from a real lender statement
// is the truth. The application never calculates an imported row again.
// See the note about the workbook in tools/build-seed.mjs.
// ============================================================================

import { apportion } from './money.js'
import { addDays, addMonths, dayInMonth, parts } from './dates.js'

/** How many payments fall in one year, for each term unit. */
export const PERIODS_PER_YEAR = {
  month: 12, semi_month: 24, week: 52, fortnight: 26,
}

export const TERM_UNIT_LABEL = {
  month: 'month', semi_month: 'half month', week: 'week', fortnight: 'fortnight',
}

export const INTEREST_METHOD_LABEL = {
  flat: 'Flat (add-on)',
  reducing: 'Reducing balance',
  none: 'No interest',
  custom: 'Custom (I type each row)',
}

/**
 * Changes a quoted rate into the rate for one payment period.
 * A lender in the Philippines often quotes a rate for one month. A loan that
 * pays twice each month therefore uses one half of that rate for each payment.
 */
export function ratePerPeriod (rate, ratePeriod, termUnit) {
  const perYear = PERIODS_PER_YEAR[termUnit] ?? 12
  const annual = ratePeriod === 'annual' ? Number(rate) : Number(rate) * 12
  return annual / perYear
}

/**
 * Makes the due date of each payment.
 * A half month term uses two days in each month. The two days come from the
 * first due date, therefore the pattern follows what the user typed.
 */
export function dueDateSeries (firstDue, termUnit, count) {
  const out = []
  if (termUnit === 'week')      { for (let i = 0; i < count; i++) out.push(addDays(firstDue, 7 * i));  return out }
  if (termUnit === 'fortnight') { for (let i = 0; i < count; i++) out.push(addDays(firstDue, 14 * i)); return out }
  if (termUnit === 'month')     { for (let i = 0; i < count; i++) out.push(addMonths(firstDue, i));    return out }

  // semi_month : two days in each month, taken from the first due date.
  // A first due date on the 20th gives the pair [5, 20]. A first due date on
  // the 3rd gives the pair [3, 18].
  const d1 = parts(firstDue).d
  const anchors = d1 <= 15 ? [d1, d1 + 15] : [d1 - 15, d1]
  const startIndex = d1 <= 15 ? 0 : 1
  for (let k = 0; k < count; k++) {
    const index = startIndex + k
    const month = addMonths(firstDue, Math.floor(index / 2))
    const { y, m } = parts(month)
    out.push(dayInMonth(y, m, anchors[index % 2]))
  }
  return out
}

/**
 * Makes a complete payment schedule.
 *
 * Every amount is in centavos.
 * The interest methods follow the same rules as the workbook:
 *   flat      : the interest is a percentage of the amount, for each period,
 *               and it does not fall as the balance falls.
 *   reducing  : the interest each period is a percentage of the balance that
 *               is still open.
 *   none      : a plan with no interest.
 *   custom    : no formula. The rows divide the amount, and the user edits them.
 *
 * feesInInterest follows the workbook column "Charges Included":
 *   true  : the charges join the amount, and the interest applies to the sum.
 *   false : the interest applies to the amount alone, and the charges are added
 *           to the total afterwards.
 */
export function buildSchedule (input) {
  const {
    principal = 0,          // centavos
    fees = 0,               // centavos
    feesInInterest = true,
    method = 'flat',
    rate = 0,
    ratePeriod = 'monthly',
    termCount = 1,
    termUnit = 'month',
    firstDue,
    paymentOverride = null, // centavos, when the lender states the payment
    totalOverride = null,   // centavos, when the lender states the total
  } = input

  const n = Math.max(1, Math.round(termCount))
  const dates = dueDateSeries(firstDue, termUnit, n)
  const i = ratePerPeriod(rate, ratePeriod, termUnit)
  const base = feesInInterest ? principal + fees : principal

  let total, interestTotal, feesTotal = fees

  if (totalOverride !== null) {
    total = totalOverride
    interestTotal = Math.max(0, total - principal - (feesInInterest ? 0 : fees))
  } else if (method === 'none') {
    interestTotal = 0
    total = base + (feesInInterest ? 0 : fees)
  } else if (method === 'custom') {
    interestTotal = 0
    total = paymentOverride !== null ? paymentOverride * n : base + (feesInInterest ? 0 : fees)
  } else if (method === 'reducing') {
    // A true annuity. Each payment is the same, and the interest part falls.
    const pay = i === 0
      ? Math.round(base / n)
      : Math.round(base * i * Math.pow(1 + i, n) / (Math.pow(1 + i, n) - 1))
    const payment = paymentOverride ?? pay
    total = payment * n + (feesInInterest ? 0 : fees)
    interestTotal = Math.max(0, payment * n - base)
  } else {
    // flat, which is the add-on method
    interestTotal = Math.round(base * i * n)
    total = base + interestTotal + (feesInInterest ? 0 : fees)
  }

  const payment = paymentOverride ?? Math.round(total / n)
  const amounts = apportion(total, Array(n).fill(1))
  if (paymentOverride !== null) {
    for (let k = 0; k < n - 1; k++) amounts[k] = payment
    amounts[n - 1] = total - payment * (n - 1)
  }

  // Divide the interest across the payments.
  let interestParts
  if (method === 'reducing' && i > 0) {
    // Take the interest from the open balance, one period at a time.
    interestParts = []
    let bal = base
    for (let k = 0; k < n; k++) {
      const int = Math.round(bal * i)
      const principalPart = Math.min(amounts[k] - int, bal)
      interestParts.push(int)
      bal -= principalPart
    }
    // Correct the total, so the parts add up.
    const drift = interestTotal - interestParts.reduce((a, b) => a + b, 0)
    interestParts[n - 1] += drift
  } else {
    interestParts = apportion(interestTotal, amounts)
  }

  const feeParts = feesInInterest ? Array(n).fill(0) : apportion(feesTotal, amounts)

  let balance = principal
  const rows = dates.map((due, k) => {
    const interest = interestParts[k]
    const feeRow = feeParts[k]
    const principalPart = amounts[k] - interest - feeRow
    balance -= principalPart
    return {
      installment_no: k + 1,
      due_date: due,
      amount_due: amounts[k],
      principal_component: principalPart,
      interest_component: interest,
      fees_component: feeRow,
      balance_after: Math.max(0, Math.round(balance)),
      status: 'pending',
    }
  })

  return {
    rows,
    total_payable: total,
    interest_total: interestTotal,
    payment_amount: amounts[0],
    periodic_rate: i,
  }
}

/**
 * The true yearly cost of a loan, including the charges taken at the start.
 * It solves for the rate that makes the payments equal the cash received.
 * A bisection search is used, because the equation has no direct answer.
 */
export function effectiveApr ({ amountReceived, rows, termUnit = 'month' }) {
  const pending = rows.filter(r => r.amount_due > 0)
  if (!amountReceived || amountReceived <= 0 || pending.length === 0) return null
  const perYear = PERIODS_PER_YEAR[termUnit] ?? 12

  const npv = r => pending.reduce(
    (acc, row, k) => acc + row.amount_due / Math.pow(1 + r, k + 1), 0) - amountReceived

  let lo = 0, hi = 3            // 0% to 300% for each period
  if (npv(lo) < 0) return 0     // the payments never reach the cash received
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2
    if (npv(mid) > 0) lo = mid; else hi = mid
  }
  const periodic = (lo + hi) / 2
  return Math.pow(1 + periodic, perYear) - 1
}

/**
 * What it costs to close a loan on one date.
 *
 * Lenders do not agree on this figure. Some ask for the balance that is still
 * open and drop the interest that is not yet earned. Others ask for every
 * remaining payment. This function gives the first answer as a start, and the
 * screen lets the user change both the amount and the part of the interest
 * that the lender returns. Always confirm the figure with the lender.
 */
export function payoffQuote ({ loan, rows, onDate, rebateRatio = 1 }) {
  const open = rows.filter(r => r.status === 'pending' || r.status === 'partial')
  const dropped = open.filter(r => r.due_date > onDate)
  const arrears = open.filter(r => r.due_date <= onDate)

  const principalOpen = open.reduce((a, r) => a + r.principal_component, 0)
  const interestOpen  = open.reduce((a, r) => a + r.interest_component, 0)
  const feesOpen      = open.reduce((a, r) => a + r.fees_component, 0)
  const amountOpen    = open.reduce((a, r) => a + r.amount_due, 0)

  const unknownPrincipal = loan.principal === null || loan.principal === undefined
  const noInterestData = unknownPrincipal || interestOpen === 0

  // The interest that the lender can return is the interest on the payments
  // that the payoff removes.
  const interestDropped = dropped.reduce((a, r) => a + r.interest_component, 0)
  const rebate = Math.round(interestDropped * Math.max(0, Math.min(1, rebateRatio)))

  const amount = noInterestData
    ? amountOpen                       // no interest split, therefore pay all
    : principalOpen + feesOpen + (interestOpen - rebate)

  return {
    on_date: onDate,
    amount,                            // centavos to pay on that date
    principal_open: principalOpen,
    interest_open: interestOpen,
    interest_saved: rebate,
    interest_unknown: noInterestData,
    dropped_count: dropped.length,
    arrears_count: arrears.length,
    arrears_amount: arrears.reduce((a, r) => a + r.amount_due, 0),
    dropped_ids: dropped.map(r => r.id).filter(Boolean),
    total_if_kept: amountOpen,
    saving_vs_kept: amountOpen - amount,
  }
}

/**
 * Reads the interest rate out of a loan that states only its total.
 * This is the calculation that column D of the Loans sheet performs.
 * It gives the rate for one period.
 */
export function impliedRate ({ principal, fees, feesInInterest, total, termCount }) {
  const base = feesInInterest ? principal + fees : principal
  const owed = feesInInterest ? total : total - fees
  if (!base || !termCount) return 0
  return ((owed / base) - 1) / termCount
}
