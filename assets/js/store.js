// ============================================================================
// Lin Ledger : the data layer
//
// This module is the only place that speaks to the database. It changes every
// money value into centavos as soon as it arrives, and back into a decimal
// number when it leaves. No other module handles that change, therefore a
// rounding fault cannot enter through a screen.
// ============================================================================

import { supabase, unwrap } from './supabase.js'
import { cents, toDb, configureMoney } from './money.js'
import * as D from './dates.js'
import { GENERATE_MONTHS } from './config.js'
import { buildEvents, project, analyzePeriods } from './projection.js'

// The money columns of each table. Every other column passes through.
const MONEY = {
  profiles:            ['safety_buffer', 'payroll_default_amount'],
  accounts:            ['opening_balance'],
  categories:          ['budget_amount'],
  transactions:        ['amount'],
  recurring_payments:  ['amount'],
  scheduled_payments:  ['expected_amount', 'actual_amount'],
  loans:               ['principal', 'amount_received', 'fees_upfront',
                        'payment_amount', 'total_payable'],
  loan_payments:       ['amount_due', 'principal_component', 'interest_component',
                        'fees_component', 'balance_after', 'paid_amount'],
  payroll_events:      ['expected_amount', 'actual_amount'],
  v_account_balances:  ['opening_balance', 'balance'],
  v_upcoming:          ['amount', 'interest_part'],
  v_category_month:    ['spent', 'budget_amount'],
  v_loan_stats:        ['principal', 'amount_received', 'fees_upfront', 'total_payable',
                        'interest_paid', 'interest_remaining', 'interest_total',
                        'amount_paid', 'balance_remaining', 'principal_remaining'],
}

/** A row from the database becomes a row with centavos. A null stays null. */
function toCents (row, table) {
  if (!row) return row
  const fields = MONEY[table] || []
  const out = { ...row }
  for (const f of fields) {
    out[f] = row[f] === null || row[f] === undefined ? null : cents(row[f])
  }
  return out
}

/** A row with centavos becomes a row for the database. */
function toNumeric (row, table) {
  const fields = MONEY[table] || []
  const out = { ...row }
  for (const f of fields) {
    if (f in out) out[f] = out[f] === null || out[f] === undefined ? null : toDb(out[f])
  }
  return out
}

const mapRows = (rows, table) => (rows || []).map(r => toCents(r, table))

/**
 * Puts the movements in the order that they happened, with the newest first.
 *
 * The database orders by the date, and a date holds no clock. Therefore this
 * function orders each day by the clock. D.compareWhen holds that rule, and
 * dates.js owns it because the test suite reads that file.
 *
 * The sort happens here and not in the query, because a browser that reaches a
 * database without the occurred_time column would get an error from the query
 * and no data at all. A missing field only makes the comparator fall back.
 */
export const sortByWhen = rows => rows.slice().sort(D.compareWhen)

// ---------------------------------------------------------------------------
// The data that the screens read
// ---------------------------------------------------------------------------

export const state = {
  user: null,
  profile: null,
  accounts: [], balances: [], categories: [], transactions: [],
  recurring: [], scheduled: [], loans: [], loanPayments: [],
  payroll: [], reviews: [], upcoming: [], loanStats: [],
  loaded: false,
}

const listeners = new Set()
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export const notify = () => listeners.forEach(fn => { try { fn() } catch (e) { console.error(e) } })

// Small helpers that the screens use often.
export const accountById  = id => state.accounts.find(a => a.id === id)
export const categoryById = id => state.categories.find(c => c.id === id)
export const loanById     = id => state.loans.find(l => l.id === id)
export const statsForLoan = id => state.loanStats.find(s => s.loan_id === id)
export const paymentsOfLoan = id => state.loanPayments
  .filter(p => p.loan_id === id)
  .sort((a, b) => a.installment_no - b.installment_no)

export const categoryByName = name => state.categories
  .find(c => c.name.toLowerCase() === String(name).toLowerCase())

/** The money that you can spend now. Only the accounts that count. */
export function liquidity () {
  return state.balances
    .filter(b => b.include_in_liquidity && !b.is_archived)
    .reduce((a, b) => a + b.balance, 0)
}

export function liquidityAll () {
  return state.balances.filter(b => !b.is_archived).reduce((a, b) => a + b.balance, 0)
}

/**
 * Your net worth: every account, added together.
 *
 * This figure is not the same as liquidity(). Liquidity leaves out an account
 * that you marked as outside the forecast, because a jar of coins does not pay
 * a bill. Net worth leaves nothing out, because a jar of coins is still money
 * that you own. The home screen shows this figure at the top.
 */
export const netWorth = () => liquidityAll()

/** Every movement of one account, with the newest first. */
export const transactionsOfAccount = accountId =>
  state.transactions.filter(t => t.account_id === accountId)

/** The balance row of one account. */
export const balanceOfAccount = accountId =>
  state.balances.find(b => b.account_id === accountId) ?? null

/** Everything that is still owed on every open loan. */
export function totalDebt () {
  return state.loanStats
    .filter(s => s.status === 'active')
    .reduce((a, s) => a + s.balance_remaining, 0)
}

export function interestPaidAllTime () {
  return state.loanStats.reduce((a, s) => a + s.interest_paid, 0)
}

export function interestRemainingAllTime () {
  return state.loanStats
    .filter(s => s.status === 'active')
    .reduce((a, s) => a + s.interest_remaining, 0)
}

// ---------------------------------------------------------------------------
// Read everything
// ---------------------------------------------------------------------------

export async function loadAll () {
  const { data: sess } = await supabase.auth.getUser()
  state.user = sess?.user ?? null
  if (!state.user) throw new Error('No one is signed in.')

  const [profile, accounts, balances, categories, transactions, recurring,
         scheduled, loans, loanPayments, payroll, reviews, upcoming, loanStats] =
    await Promise.all([
      supabase.from('profiles').select('*').maybeSingle().then(unwrap),
      supabase.from('accounts').select('*').order('sort_order').then(unwrap),
      supabase.from('v_account_balances').select('*').order('sort_order').then(unwrap),
      supabase.from('categories').select('*').order('sort_order').then(unwrap),
      supabase.from('transactions').select('*').order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false }).limit(2000).then(unwrap),
      supabase.from('recurring_payments').select('*').order('name').then(unwrap),
      supabase.from('scheduled_payments').select('*').order('due_date').then(unwrap),
      supabase.from('loans').select('*').order('name').then(unwrap),
      supabase.from('loan_payments').select('*').order('due_date').then(unwrap),
      supabase.from('payroll_events').select('*').order('expected_date').then(unwrap),
      supabase.from('review_items').select('*').eq('status', 'open')
        .order('created_at').then(unwrap),
      supabase.from('v_upcoming').select('*').order('due_date').then(unwrap),
      supabase.from('v_loan_stats').select('*').order('name').then(unwrap),
    ])

  state.profile      = toCents(profile, 'profiles') || defaultProfile()
  state.accounts     = mapRows(accounts, 'accounts')
  state.balances     = mapRows(balances, 'v_account_balances')
  state.categories   = mapRows(categories, 'categories')
  state.transactions = sortByWhen(mapRows(transactions, 'transactions'))
  state.recurring    = mapRows(recurring, 'recurring_payments')
  state.scheduled    = mapRows(scheduled, 'scheduled_payments')
  state.loans        = mapRows(loans, 'loans')
  state.loanPayments = mapRows(loanPayments, 'loan_payments')
  state.payroll      = mapRows(payroll, 'payroll_events')
  state.reviews      = reviews || []
  state.upcoming     = mapRows(upcoming, 'v_upcoming')
  state.loanStats    = mapRows(loanStats, 'v_loan_stats')
  state.loaded = true

  configureMoney(state.profile)
  notify()
  return state
}

/** Reads the tables again after a change. */
export async function refresh () {
  await loadAll()
}

function defaultProfile () {
  return {
    user_id: state.user?.id, display_name: 'Lin', currency: 'PHP',
    currency_symbol: '', negative_style: 'parentheses', locale: 'en-PH',
    safety_buffer: 0, projection_days: 180, horizon_months: 18,
    variable_spend_model: 'lump_at_period_start', payroll_mode: 'semi_monthly',
    payroll_day_1: 13, payroll_day_2: 28, payroll_default_amount: 0,
    weekend_adjust: 'previous_business_day', theme: 'system', onboarded: false,
  }
}

// ---------------------------------------------------------------------------
// Make the bill rows that a recurring rule reaches
// ---------------------------------------------------------------------------

/**
 * Makes the missing bill rows for each active rule, up to the horizon.
 *
 * The check uses a period key and not an exact date. A bill that the user moved
 * by a few days keeps the key of its month, therefore this function does not
 * add a second row for that month. That is what lets rent sit on the payroll
 * date, which moves each month.
 */
export async function ensureHorizon () {
  const from = D.addMonths(D.today(), -1)
  const to = D.addMonths(D.today(), GENERATE_MONTHS)
  const rows = []

  for (const rule of state.recurring) {
    if (!rule.is_active) continue
    const mine = state.scheduled.filter(s => s.recurring_id === rule.id)
    const covered = new Set(mine.map(s => D.periodKey(rule, s.due_date)))

    for (const due of D.expandRecurrence(rule, from, to)) {
      const key = D.periodKey(rule, due)
      if (covered.has(key)) continue
      covered.add(key)
      rows.push({
        recurring_id: rule.id,
        name: rule.name,
        category_id: rule.category_id,
        account_id: rule.account_id,
        due_date: due,
        expected_amount: rule.amount,
        status: 'pending',
        is_estimate: rule.is_estimate,
        is_overridden: false,
      })
    }
  }

  if (rows.length === 0) return 0
  const payload = rows.map(r => toNumeric({ ...r, user_id: state.user.id },
                                          'scheduled_payments'))
  unwrap(await supabase.from('scheduled_payments').insert(payload))
  return rows.length
}

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

/**
 * How much each category cost, between two dates. The answer is in centavos,
 * and the key is the category id. A row with no category keeps the key "null".
 *
 * The sum covers money that went out AND money that came back into a spending
 * category. Change from a purchase and a refund are both money that returns,
 * therefore they reduce the cost of that category.
 *
 * Without this rule, "I paid 500 from Cash and took 15 in Coins as change"
 * would read as 500 of spending. The true cost is 485.
 *
 * Money that comes in against an income category is real income, therefore this
 * function leaves it out. A transfer never counts, because it buys nothing.
 */
export function spentByCategory (from, to) {
  const out = {}
  for (const t of state.transactions) {
    if (t.occurred_on < from || t.occurred_on > to) continue
    if (t.type !== 'expense' && t.type !== 'income') continue
    const cat = t.category_id ? categoryById(t.category_id) : null
    // Money in counts only when it returns to a spending category.
    if (t.type === 'income' && (!cat || cat.kind !== 'expense')) continue
    // Money out counts unless the category is an income category.
    if (t.type === 'expense' && cat && cat.kind !== 'expense') continue
    out[t.category_id] = (out[t.category_id] || 0) - t.amount
  }
  return out
}

/** The payroll date on or before a date, which starts the period that runs. */
export function currentPeriodStart (on = D.today()) {
  const past = state.payroll
    .map(p => p.actual_date || p.expected_date)
    .filter(d => d <= on)
    .sort()
  return past.length ? past[past.length - 1] : D.startOfMonth(on)
}

/**
 * Builds the complete forecast for the screens: the daily balance, the summary
 * and the report for each payroll period.
 */
export function buildProjection (options = {}) {
  const profile = state.profile || defaultProfile()
  const from = options.from || D.today()
  const days = options.days ?? profile.projection_days ?? 180
  const to = options.to || D.addDays(from, days)
  const opening = options.opening ?? liquidity()
  const safetyBuffer = options.safetyBuffer ?? profile.safety_buffer ?? 0

  const periodStart = currentPeriodStart(from)
  // A pay date on or before today proves where the period that runs began.
  const periodStartKnown = state.payroll
    .some(p => (p.actual_date || p.expected_date) <= from)
  const spent = spentByCategory(periodStart, from)

  const { events, boundaries, payrollProposed, payrollProposedFrom,
          payrollLastReal, payrollHasRule } = buildEvents({
    upcoming: state.upcoming,
    payroll: state.payroll,
    categories: state.categories,
    profile, from, to, spentByCategory: spent,
  })

  const run = project({ opening, events, from, to, safetyBuffer })
  const periods = analyzePeriods({
    series: run.series, boundaries, events, categories: state.categories,
    profile, spentByCategory: spent, from,
    currentPeriodStart: periodStart, currentPeriodKnown: periodStartKnown,
  })

  return { ...run, events, boundaries, periods,
           payrollProposed, payrollProposedFrom, payrollLastReal, payrollHasRule,
           from, to, opening, safetyBuffer, periodStart, periodStartKnown, spent }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const withUser = row => ({ ...row, user_id: state.user.id })

// ---------------------------------------------------------------------------
// A database that does not hold occurred_time yet
// ---------------------------------------------------------------------------

/**
 * The clock of a movement lives in transactions.occurred_time, and
 * sql/06_time_emoji_split.sql adds that column. A person who takes the new
 * files but does not run that file yet would lose every save, because the
 * database would refuse a column that it does not hold.
 *
 * Therefore each write tries once with the clock. If the database says that
 * the column is not there, the write happens again without the clock and the
 * application says what is missing. The money is then correct, and only the
 * clock is absent.
 */
export const schema = { hasTime: true, warned: false }

const missingTimeColumn = error =>
  /occurred_time/i.test(error?.message || '')
  && /column|schema|does not exist|could not find/i.test(error?.message || '')

function dropTime (value) {
  if (Array.isArray(value)) return value.map(dropTime)
  const { occurred_time, ...rest } = value
  return rest
}

function warnAboutTime () {
  schema.hasTime = false
  if (schema.warned) return
  schema.warned = true
  console.warn(
    'transactions.occurred_time is not in the database, therefore this '
    + 'movement carries no clock. Run sql/06_time_emoji_split.sql from the '
    + 'setup folder to add it.')
}

/** Runs a write, and runs it again without the clock if the column is absent. */
async function writeWithTime (payload, run) {
  const first = schema.hasTime ? payload : dropTime(payload)
  const result = await run(first)
  if (!result.error) return unwrap(result)
  if (!missingTimeColumn(result.error)) return unwrap(result)
  warnAboutTime()
  return unwrap(await run(dropTime(payload)))
}

async function insertRow (table, row) {
  const payload = toNumeric(withUser(row), table)
  const data = await writeWithTime(payload,
    p => supabase.from(table).insert(p).select().single())
  return toCents(data, table)
}

async function updateRow (table, id, patch) {
  const payload = toNumeric(patch, table)
  const data = await writeWithTime(payload,
    p => supabase.from(table).update(p).eq('id', id).select().single())
  return toCents(data, table)
}

async function deleteRow (table, id) {
  unwrap(await supabase.from(table).delete().eq('id', id))
}

// --- settings ---
export async function saveProfile (patch) {
  const data = unwrap(await supabase.from('profiles')
    .update(toNumeric(patch, 'profiles')).eq('user_id', state.user.id)
    .select().single())
  state.profile = toCents(data, 'profiles')
  configureMoney(state.profile)
  notify()
  return state.profile
}

// --- accounts ---
export const createAccount = row => insertRow('accounts', row)
export const updateAccount = (id, patch) => updateRow('accounts', id, patch)
export const deleteAccount = id => deleteRow('accounts', id)

/**
 * Sets an account to a true balance. It writes the difference as an adjustment,
 * so the user does not have to enter every missing payment. This is what makes
 * the application usable on a telephone.
 */
export async function setAccountBalance (accountId, targetCents, note) {
  const row = state.balances.find(b => b.account_id === accountId)
  const current = row ? row.balance : 0
  const diff = targetCents - current
  if (diff === 0) return null
  return insertRow('transactions', {
    account_id: accountId, category_id: null, type: 'adjustment',
    amount: diff, occurred_on: D.today(), occurred_time: D.nowTime(),
    description: note || 'Balance set by hand',
  })
}

// --- categories ---
export const createCategory = row => insertRow('categories', row)
export const updateCategory = (id, patch) => updateRow('categories', id, patch)
export const deleteCategory = id => deleteRow('categories', id)

// --- transactions ---
export const createTransaction = row => insertRow('transactions', row)

/**
 * Writes many money movements with one request.
 *
 * A loop of single writes would send one request for each row, and a telephone
 * on a slow network would then wait a long time. One request also means that a
 * failure leaves nothing behind, therefore a half finished batch cannot happen.
 */
export async function createTransactions (rows) {
  if (!rows.length) return []
  const payload = rows.map(r => toNumeric(withUser(r), 'transactions'))
  const data = await writeWithTime(payload,
    p => supabase.from('transactions').insert(p).select())
  return mapRows(data, 'transactions')
}
export const updateTransaction = (id, patch) => updateRow('transactions', id, patch)
export const deleteTransaction = id => deleteRow('transactions', id)

/** Moves money between two accounts, as two rows that share one group. */
export async function createTransfer ({ fromId, toId, amount, date, note }) {
  const group = crypto.randomUUID()
  const when = date || D.today()
  const cat = categoryByName('Transfer')?.id ?? null
  const clock = D.nowTime()
  await insertRow('transactions', {
    account_id: fromId, category_id: cat, type: 'transfer_out',
    amount: -Math.abs(amount), occurred_on: when, occurred_time: clock,
    description: note || 'Transfer',
    transfer_group: group, group_kind: 'transfer',
  })
  await insertRow('transactions', {
    account_id: toId, category_id: cat, type: 'transfer_in',
    amount: Math.abs(amount), occurred_on: when, occurred_time: clock,
    description: note || 'Transfer',
    transfer_group: group, group_kind: 'transfer',
  })
}

/**
 * Writes one event that touches more than one account.
 *
 * A purchase can take money from two pockets, and it can give change back.
 * "I paid 500 from Cash and took 15 in Coins as change" is one event with two
 * rows: Cash -500 and Coins +15. The true cost is the sum, which is 485.
 *
 * legs : [{ account_id, direction: 'out' | 'in', amount }]  amount in centavos
 *
 * The rule for the type of each row is short:
 *   money out  -> expense
 *   money in   -> income
 * When the sum is exactly zero the event moved money and bought nothing,
 * therefore the rows become a transfer and no category counts them.
 *
 * Every row carries the same group value. The screens then show one item, and
 * a delete removes the whole event.
 */
export async function createSplit ({ description, category_id, occurred_on, legs }) {
  const clean = legs
    .map(l => ({ ...l, amount: Math.abs(l.amount || 0) }))
    .filter(l => l.account_id && l.amount > 0)
  if (clean.length === 0) throw new Error('Add at least one account with an amount.')

  const net = clean.reduce((a, l) => a + (l.direction === 'in' ? l.amount : -l.amount), 0)
  const isMove = net === 0
  const group = crypto.randomUUID()
  const when = occurred_on || D.today()
  const moveCat = categoryByName('Transfer')?.id ?? null

  const rows = clean.map(l => ({
    account_id: l.account_id,
    category_id: isMove ? moveCat : (category_id || null),
    type: isMove
      ? (l.direction === 'in' ? 'transfer_in' : 'transfer_out')
      : (l.direction === 'in' ? 'income' : 'expense'),
    amount: l.direction === 'in' ? l.amount : -l.amount,
    occurred_on: when,
    description: description || (isMove ? 'Moved money' : 'Purchase'),
    transfer_group: clean.length > 1 ? group : null,
    group_kind: clean.length > 1 ? (isMove ? 'transfer' : 'split') : null,
  }))

  const made = await createTransactions(rows)
  return { rows: made, net, group: clean.length > 1 ? group : null }
}

/** Every row of one event. */
export const transactionsInGroup = groupId =>
  groupId ? state.transactions.filter(t => t.transfer_group === groupId) : []

/** Removes every row of one event. */
export async function deleteGroup (groupId) {
  unwrap(await supabase.from('transactions').delete().eq('transfer_group', groupId))
}

// --- recurring rules ---
export const createRecurring = row => insertRow('recurring_payments', row)

/**
 * Changes a rule, then makes its future rows again.
 * It removes only the rows that are still open, that come later than today and
 * that the user did not edit. A paid row and an edited row both stay.
 */
export async function updateRecurring (id, patch, { regenerate = true } = {}) {
  const rule = await updateRow('recurring_payments', id, patch)
  if (regenerate) {
    unwrap(await supabase.from('scheduled_payments').delete()
      .eq('recurring_id', id).eq('status', 'pending')
      .eq('is_overridden', false).gt('due_date', D.today()))
  }
  return rule
}

export const deleteRecurring = id => deleteRow('recurring_payments', id)

// --- bills ---
export const createScheduled = row => insertRow('scheduled_payments', row)
export const updateScheduled = (id, patch) =>
  updateRow('scheduled_payments', id, { ...patch, is_overridden: true })
export const deleteScheduled = id => deleteRow('scheduled_payments', id)

/** Marks a bill paid and writes the money movement. */
export async function payBill (bill, { amount, date, accountId }) {
  const when = date || D.today()
  const paid = Math.abs(amount ?? bill.expected_amount)
  const tx = await insertRow('transactions', {
    account_id: accountId || bill.account_id,
    category_id: bill.category_id,
    type: 'expense', amount: -paid, occurred_on: when,
    occurred_time: D.nowTime(), description: bill.name,
  })
  return updateRow('scheduled_payments', bill.id, {
    status: 'paid', actual_amount: paid, paid_on: when, transaction_id: tx.id,
  })
}

export const skipBill = id =>
  updateRow('scheduled_payments', id, { status: 'skipped' })

/** Removes the paid mark from a bill, and removes the money movement. */
export async function unpayBill (bill) {
  if (bill.transaction_id) await deleteRow('transactions', bill.transaction_id)
  return updateRow('scheduled_payments', bill.id, {
    status: 'pending', actual_amount: null, paid_on: null, transaction_id: null,
  })
}

// --- loans ---
export const createLoan = row => insertRow('loans', row)
export const updateLoan = (id, patch) => updateRow('loans', id, patch)
export const deleteLoan = id => deleteRow('loans', id)

export const createLoanPayment = row => insertRow('loan_payments', row)
export const updateLoanPayment = (id, patch) => updateRow('loan_payments', id, patch)
export const deleteLoanPayment = id => deleteRow('loan_payments', id)

/** Writes a complete schedule for a loan. */
export async function replaceSchedule (loanId, rows) {
  unwrap(await supabase.from('loan_payments').delete()
    .eq('loan_id', loanId).eq('status', 'pending'))
  if (!rows.length) return
  const payload = rows.map(r => toNumeric(withUser({ ...r, loan_id: loanId }),
                                          'loan_payments'))
  unwrap(await supabase.from('loan_payments').insert(payload))
}

/** Marks one installment paid and writes the money movement. */
export async function payInstallment (row, { amount, date, accountId }) {
  const loan = loanById(row.loan_id)
  const when = date || D.today()
  const paid = Math.abs(amount ?? row.amount_due)
  const tx = await insertRow('transactions', {
    account_id: accountId || loan?.account_id,
    category_id: loan?.category_id ?? categoryByName('Debt Payment')?.id ?? null,
    type: 'expense', amount: -paid, occurred_on: when,
    occurred_time: D.nowTime(),
    description: `${loan?.name ?? 'Loan'} #${row.installment_no}`,
  })
  const updated = await updateRow('loan_payments', row.id, {
    status: 'paid', paid_amount: paid, paid_on: when, transaction_id: tx.id,
  })
  await closeLoanIfDone(row.loan_id)
  return updated
}

export async function unpayInstallment (row) {
  if (row.transaction_id) await deleteRow('transactions', row.transaction_id)
  const updated = await updateRow('loan_payments', row.id, {
    status: 'pending', paid_amount: null, paid_on: null, transaction_id: null,
  })
  const loan = loanById(row.loan_id)
  if (loan && loan.status !== 'active') await updateLoan(loan.id, { status: 'active' })
  return updated
}

async function closeLoanIfDone (loanId) {
  const open = unwrap(await supabase.from('loan_payments').select('id')
    .eq('loan_id', loanId).in('status', ['pending', 'partial']))
  if (open.length === 0) await updateLoan(loanId, { status: 'paid' })
}

/**
 * Closes a loan early.
 *
 * The payments that were already late become paid, because the money covers
 * them and their interest is already earned. The later payments become waived,
 * because the payoff cancels them. Therefore the interest report counts only
 * the interest that you really paid.
 */
export async function applyPayoff (loan, quote, { accountId, date }) {
  const when = date || quote.on_date || D.today()
  const tx = await insertRow('transactions', {
    account_id: accountId || loan.account_id,
    category_id: loan.category_id ?? categoryByName('Debt Payment')?.id ?? null,
    type: 'expense', amount: -Math.abs(quote.amount), occurred_on: when,
    occurred_time: D.nowTime(), description: `${loan.name} closed early`,
  })

  const open = paymentsOfLoan(loan.id)
    .filter(r => r.status === 'pending' || r.status === 'partial')
  const arrears = open.filter(r => r.due_date <= when).map(r => r.id)
  const dropped = open.filter(r => r.due_date > when).map(r => r.id)

  if (arrears.length) {
    unwrap(await supabase.from('loan_payments')
      .update({ status: 'paid', paid_on: when, transaction_id: tx.id })
      .in('id', arrears))
  }
  if (dropped.length) {
    unwrap(await supabase.from('loan_payments')
      .update({ status: 'waived', notes: 'Cancelled by the early payoff' })
      .in('id', dropped))
  }
  await updateLoan(loan.id, { status: 'paid' })
  return tx
}

// --- payroll ---
export const createPayroll = row => insertRow('payroll_events', row)
export const updatePayroll = (id, patch) => updateRow('payroll_events', id, patch)
export const deletePayroll = id => deleteRow('payroll_events', id)

/** Records the pay that really arrived. */
export async function receivePayroll (event, { amount, date, accountId }) {
  const when = date || D.today()
  const got = Math.abs(amount ?? event.expected_amount)
  const tx = await insertRow('transactions', {
    account_id: accountId || event.account_id || state.profile.payroll_account_id,
    category_id: categoryByName('Payroll')?.id ?? null,
    type: 'income', amount: got, occurred_on: when,
    occurred_time: D.nowTime(), description: event.label || 'Payroll',
  })
  return updateRow('payroll_events', event.id, {
    status: 'received', actual_amount: got, actual_date: when, transaction_id: tx.id,
  })
}

export async function unreceivePayroll (event) {
  if (event.transaction_id) await deleteRow('transactions', event.transaction_id)
  return updateRow('payroll_events', event.id, {
    status: 'expected', actual_amount: null, actual_date: null, transaction_id: null,
  })
}

/** Adds the payroll dates that the rule proposes, up to a date. */
export async function generatePayroll (untilIso) {
  const profile = state.profile
  const from = D.today()
  const dates = D.payrollDates(profile, from, untilIso)
  const have = new Set(state.payroll.map(p => p.expected_date))
  const rows = dates.filter(d => !have.has(d)).map(d => withUser({
    label: 'Payroll', expected_date: d,
    expected_amount: toDb(profile.payroll_default_amount || 0),
    account_id: profile.payroll_account_id, status: 'expected',
  }))
  if (!rows.length) return 0
  unwrap(await supabase.from('payroll_events').insert(rows))
  return rows.length
}

// --- the review list ---
export const dismissReview = id =>
  updateRow('review_items', id, { status: 'dismissed' })
