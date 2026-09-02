// ============================================================================
// Lin Ledger : dates
//
// Every date in this application is a string in the form "YYYY-MM-DD".
// A string has no time and no time zone, therefore a date cannot move by one
// day when the browser is in a different zone. The functions use UTC inside,
// where a Date object is necessary.
// ============================================================================

const MS_DAY = 86400000
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun',
                     'Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/** The date of today, in the zone of the browser. */
export function today () {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export const ymd = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * The time of now, as "HH:MM" in the zone of the browser.
 *
 * A time is a separate value from a date, and it is optional. Every money
 * calculation reads the date alone, therefore a missing time changes no figure.
 * The time only puts the movements of one day in the order that they happened.
 */
export function nowTime () {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const isValidTime = t => /^\d{2}:\d{2}(:\d{2})?$/.test(t || '')

/** "14:05" becomes "2:05 pm". An empty value gives an empty string. */
export function fmtTime (t) {
  if (!isValidTime(t)) return ''
  const [h, m] = t.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/** The value that a time input needs. It holds "HH:MM" and nothing more. */
export const toTimeInput = t => (isValidTime(t) ? t.slice(0, 5) : '')

/** "2026-08-24" becomes a UTC Date. */
export const toDate = iso => new Date(iso + 'T00:00:00Z')

/** A UTC Date becomes "2026-08-24". */
export const toIso = d =>
  ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())

export const isValid = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '')

export const parts = iso => {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

export function addDays (iso, n) {
  return toIso(new Date(toDate(iso).getTime() + n * MS_DAY))
}

export const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function addMonths (iso, n) {
  const { y, m, d } = parts(iso)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return ymd(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)))
}

/** The difference in whole days. A later second value gives a positive count. */
export const daysBetween = (a, b) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_DAY)

export const startOfMonth = iso => { const { y, m } = parts(iso); return ymd(y, m, 1) }
export const endOfMonth   = iso => { const { y, m } = parts(iso); return ymd(y, m, lastDayOfMonth(y, m)) }
export const monthKey     = iso => iso.slice(0, 7)

/** 0 is Sunday and 6 is Saturday. */
export const weekday = iso => toDate(iso).getUTCDay()
export const isWeekend = iso => { const w = weekday(iso); return w === 0 || w === 6 }

export function prevBusinessDay (iso) {
  let d = iso
  while (isWeekend(d)) d = addDays(d, -1)
  return d
}

export function nextBusinessDay (iso) {
  let d = iso
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}

export function applyWeekendAdjust (iso, mode) {
  if (mode === 'previous_business_day') return prevBusinessDay(iso)
  if (mode === 'next_business_day') return nextBusinessDay(iso)
  return iso
}

/**
 * Puts a day number on a month. The value -1 means the last day of the month,
 * and a number larger than the length of the month also gives the last day.
 */
export function dayInMonth (y, m, day) {
  const last = lastDayOfMonth(y, m)
  if (day === -1 || day > last) return ymd(y, m, last)
  return ymd(y, m, Math.max(1, day))
}

export const min = (a, b) => (a <= b ? a : b)
export const max = (a, b) => (a >= b ? a : b)
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// --- text for the screen -----------------------------------------------------

/** "Aug 24, 2026" */
export function fmtDate (iso) {
  if (!isValid(iso)) return '--'
  const { y, m, d } = parts(iso)
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`
}

/** "Aug 24" */
export function fmtShort (iso) {
  if (!isValid(iso)) return '--'
  const { m, d } = parts(iso)
  return `${MONTH_NAMES[m - 1]} ${d}`
}

/** "Mon, Aug 24" */
export function fmtDay (iso) {
  if (!isValid(iso)) return '--'
  return `${DAY_NAMES[weekday(iso)]}, ${fmtShort(iso)}`
}

/** "Aug 2026" */
export function fmtMonth (iso) {
  const { y, m } = parts(iso)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/** "in 6 days", "today", "3 days late" */
export function fmtRelative (iso, from = today()) {
  const n = daysBetween(from, iso)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 0) return n < 14 ? `in ${n} days` : `in ${Math.round(n / 7)} weeks`
  const late = -n
  return late < 14 ? `${late} days late` : `${Math.round(late / 7)} weeks late`
}

// --- the clock of a movement, and the order that things happened in ----------

/*
 * The database holds no column for a clock, and this application asks for no
 * change to the database. Therefore the clock lives in created_at, which every
 * row already carries.
 *
 * The pair of functions below is the whole rule. Nothing else in the
 * application reads created_at for a clock, therefore the rule has one home.
 */

/**
 * The clock of a movement, as "HH:MM", or null when it has none.
 *
 * The rule carries one guard: a clock counts only when the local day of
 * created_at is the same day as occurred_on. Two kinds of row fail that guard.
 * A row that an importer wrote carries the instant of the import, and a row
 * that a person back dated carries the instant of the typing. Neither instant
 * says anything about the purchase, therefore the guard drops it and the row
 * shows no clock at all. A wrong clock reads as a fact. An absent clock does
 * not.
 *
 * A row that this application writes always passes the guard, because
 * withClock builds created_at out of occurred_on.
 */
export function clockOf (row) {
  if (!row || !row.created_at || !isValid(row.occurred_on)) return null
  const d = new Date(row.created_at)
  if (Number.isNaN(d.getTime())) return null
  if (ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) !== row.occurred_on) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The created_at value that carries one date and one clock.
 *
 * The date and the clock are both local, because the person typed both of them
 * on a local keyboard. The result is an instant, therefore clockOf gives the
 * same clock back on the same device.
 */
export function withClock (occurredOn, hhmm) {
  if (!isValid(occurredOn)) return null
  const { y, m, d } = parts(occurredOn)
  const [h, min] = (isValidTime(hhmm) ? hhmm : nowTime()).split(':').map(Number)
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString()
}

/**
 * Orders two movements, with the newest first.
 *
 * It reads three things in order: the day, then the clock inside that day, then
 * the instant that the row reached the database. A row with no clock goes after
 * every row of the same day that has one, therefore an imported row sits at the
 * end of its day instead of jumping to the front of it.
 *
 * The rule lives here and not in a screen, because two screens show this list
 * and a second copy of the rule would drift from the first.
 */
export function compareWhen (a, b) {
  if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1
  const ta = clockOf(a) || ''
  const tb = clockOf(b) || ''
  if (ta !== tb) {
    if (!ta) return 1                 // no clock goes after a known clock
    if (!tb) return -1
    return ta < tb ? 1 : -1
  }
  return String(b.created_at || '').localeCompare(String(a.created_at || ''))
}

// --- recurrence --------------------------------------------------------------

/**
 * Makes every date that a recurring rule reaches, from "from" to "to".
 * The rule uses these fields:
 *   frequency, interval_count, day_of_month, day_of_month_2, weekday,
 *   custom_days, start_date, end_date, weekend_adjust
 */
export function expandRecurrence (rule, from, to) {
  const out = []
  const start = rule.start_date
  const stop = rule.end_date ? min(to, rule.end_date) : to
  if (start > stop) return out

  const push = iso => {
    const d = applyWeekendAdjust(iso, rule.weekend_adjust || 'none')
    if (d >= start && d <= stop && d >= from) out.push(d)
  }

  const step = Math.max(1, rule.interval_count || 1)

  switch (rule.frequency) {
    case 'weekly':
    case 'biweekly': {
      const every = (rule.frequency === 'biweekly' ? 2 : 1) * step * 7
      // Move to the first wanted weekday on or after the start date.
      let cursor = start
      if (rule.weekday !== null && rule.weekday !== undefined) {
        while (weekday(cursor) !== rule.weekday) cursor = addDays(cursor, 1)
      }
      // Skip forward in whole periods until the window begins.
      while (cursor < from && cursor <= stop) cursor = addDays(cursor, every)
      for (; cursor <= stop; cursor = addDays(cursor, every)) push(cursor)
      break
    }

    case 'custom_days': {
      const every = Math.max(1, rule.custom_days || 1)
      let cursor = start
      while (cursor < from && cursor <= stop) cursor = addDays(cursor, every)
      for (; cursor <= stop; cursor = addDays(cursor, every)) push(cursor)
      break
    }

    case 'semi_monthly': {
      const d1 = rule.day_of_month ?? 15
      const d2 = rule.day_of_month_2 ?? -1
      let cursor = startOfMonth(start)
      while (cursor <= stop) {
        const { y, m } = parts(cursor)
        for (const day of [d1, d2]) {
          if (day === null || day === undefined) continue
          push(dayInMonth(y, m, day))
        }
        cursor = addMonths(cursor, step)
      }
      out.sort()
      break
    }

    default: {
      // monthly, quarterly, semi_annual and annual all move by whole months.
      const monthStep = ({ monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 }
                        [rule.frequency] ?? 1) * step
      const day = rule.day_of_month ?? parts(start).d
      let cursor = startOfMonth(start)
      while (cursor <= stop) {
        const { y, m } = parts(cursor)
        push(dayInMonth(y, m, day))
        cursor = addMonths(cursor, monthStep)
      }
      break
    }
  }

  return out
}

/**
 * The key that says which period a bill row belongs to.
 *
 * The generator compares keys, and not dates. A bill that the user moved by a
 * few days keeps the same key, therefore the generator does not make a second
 * row for the same month. This is what lets rent sit on the payroll date, which
 * moves each month, without a duplicate row.
 */
export function periodKey (rule, iso) {
  switch (rule.frequency) {
    case 'weekly':
    case 'biweekly':
    case 'custom_days':
      return iso                                    // an exact date
    case 'semi_monthly': {
      const { d } = parts(iso)
      return `${monthKey(iso)}:${d <= 20 ? 'a' : 'b'}`
    }
    case 'quarterly':   return `${parts(iso).y}:Q${Math.ceil(parts(iso).m / 3)}`
    case 'semi_annual': return `${parts(iso).y}:H${parts(iso).m <= 6 ? 1 : 2}`
    case 'annual':      return String(parts(iso).y)
    default:            return monthKey(iso)        // one for each month
  }
}

/**
 * Makes the payroll dates that a profile describes, for a window of time.
 * The application uses this only to propose dates. Every real payroll row
 * stays in the database, where the user can change it, because a real payroll
 * date follows no exact rule.
 */
export function payrollDates (profile, from, to) {
  const mode = profile.payroll_mode || 'semi_monthly'
  if (mode === 'manual') return []
  const adjust = profile.weekend_adjust || 'none'
  const out = []

  if (mode === 'weekly' || mode === 'biweekly') {
    const every = mode === 'biweekly' ? 14 : 7
    let cursor = from
    for (; cursor <= to; cursor = addDays(cursor, every)) {
      out.push(applyWeekendAdjust(cursor, adjust))
    }
    return out
  }

  const days = mode === 'monthly'
    ? [profile.payroll_day_1 ?? 28]
    : [profile.payroll_day_1 ?? 13, profile.payroll_day_2 ?? 28]

  let cursor = startOfMonth(from)
  while (cursor <= to) {
    const { y, m } = parts(cursor)
    for (const day of days) {
      const d = applyWeekendAdjust(dayInMonth(y, m, day), adjust)
      if (d >= from && d <= to) out.push(d)
    }
    cursor = addMonths(cursor, 1)
  }
  return out.sort()
}
