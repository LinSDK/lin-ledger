// ============================================================================
// Lin Ledger : money
//
// Every calculation uses centavos as whole numbers. A float cannot hold 0.01
// exactly, therefore a chain of float additions loses centavos. The database
// holds numeric(14,2), and this module changes those values into whole numbers
// as soon as they arrive.
//
// The display format follows the workbook: no currency symbol, and a negative
// value inside parentheses. Settings can change this format.
// ============================================================================

let SYMBOL = ''
let NEGATIVE_STYLE = 'parentheses'

export function configureMoney (profile) {
  SYMBOL = profile?.currency_symbol ?? ''
  NEGATIVE_STYLE = profile?.negative_style ?? 'parentheses'
}

// --- change between pesos and centavos --------------------------------------

/** A value from the database or a form becomes a whole number of centavos. */
export function cents (value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Math.round(value * 100)
  const n = parseMoney(String(value))
  return n === null ? 0 : n
}

/** Centavos become a number with 2 decimal places, for the database. */
export function pesos (c) {
  return Math.round(c) / 100
}

/** Centavos become the string that the database column needs. */
export function toDb (c) {
  return (Math.round(c) / 100).toFixed(2)
}

// --- read what a person typed ------------------------------------------------

/**
 * Reads a money string and gives centavos, or null if the string is not a
 * number. It accepts "1,234.56", "(1,234.56)", "-1234.56", "1 234,56" and
 * "₱1,234.56".
 */
export function parseMoney (text) {
  if (text === null || text === undefined) return null
  let s = String(text).trim()
  if (s === '') return null

  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }

  s = s.replace(/[^\d.,+-]/g, '')      // remove a symbol or a space
  if (s.startsWith('-')) { negative = true; s = s.slice(1) }
  if (s.startsWith('+')) s = s.slice(1)

  // The last "." or "," in the string decides the split. The digits after it
  // say what that character means:
  //   1 or 2 digits  -> a decimal point.  "1,234.5" and "12.34"
  //   exactly 3      -> a thousands mark. "1.234" means one thousand and 234,
  //                     because money in this application has 2 decimals.
  //   any other count -> a decimal point.
  const mark = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  const digits = str => str.replace(/[^\d]/g, '')

  let whole, frac = ''
  if (mark === -1) {
    whole = digits(s)
  } else {
    const tail = s.slice(mark + 1)
    if (/^\d{3}$/.test(tail)) {
      whole = digits(s)                       // a thousands mark
    } else {
      whole = digits(s.slice(0, mark))        // a decimal point
      frac = digits(tail)
    }
  }

  if (whole === '' && frac === '') return null
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null

  frac = (frac + '00').slice(0, 2)
  const value = Number(whole || '0') * 100 + Number(frac || '0')
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

// --- write a value for a person ----------------------------------------------

const groups = n => n.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * Centavos become a display string.
 * 1300000  -> "13,000.00"
 * -100000  -> "(1,000.00)"   with the parentheses style
 * -100000  -> "-1,000.00"    with the minus style
 */
export function fmt (c, opts = {}) {
  const { symbol = SYMBOL, style = NEGATIVE_STYLE, decimals = 2, sign = false } = opts
  const value = Math.round(Number(c) || 0)
  const negative = value < 0
  const abs = Math.abs(value)

  let text
  if (decimals === 0) {
    text = groups(String(Math.round(abs / 100)))
  } else {
    text = groups(String(Math.floor(abs / 100))) + '.' + String(abs % 100).padStart(2, '0')
  }
  if (symbol) text = symbol + text

  if (negative) return style === 'parentheses' ? `(${text})` : `-${text}`
  return sign ? `+${text}` : text
}

/** The same as fmt, but a positive value keeps a plus character. */
export const fmtSigned = (c, opts = {}) => fmt(c, { ...opts, sign: true })

/** A short form for an axis label: 13,000.00 becomes "13k". */
export function fmtCompact (c) {
  const v = Math.round(Number(c) || 0)
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 100000000) return s + (a / 100000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (a >= 100000)    return s + (a / 100000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return s + groups(String(Math.round(a / 100)))
}

/** A percentage, for the statistics screen. */
export function fmtPct (ratio, decimals = 1) {
  if (!Number.isFinite(ratio)) return '--'
  return (ratio * 100).toFixed(decimals) + '%'
}

// --- share a total across parts ---------------------------------------------

/**
 * Divides a total of centavos into n parts in proportion to the weights.
 * The residue goes on the last part, therefore the parts always add up to the
 * total. Every schedule in this application uses this function, and no
 * schedule loses a centavo.
 */
export function apportion (total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum === 0) return weights.map(() => 0)
  const parts = weights.map(w => Math.round(total * w / sum))
  const drift = total - parts.reduce((a, b) => a + b, 0)
  parts[parts.length - 1] += drift
  return parts
}
