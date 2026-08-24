// ============================================================================
// Lin Ledger : reminders while the page is open
//
// A message to a telephone needs a server that runs all the time, and this
// application has no such server. Therefore it reminds you in the three ways
// that a web page can:
//
//   1. the list of near payments on the home screen,
//   2. a message from the browser while the page is open, which is this module,
//   3. a calendar file, which gives a real alarm. See the Bills screen.
//
// This module never asks for permission on its own. The user turns the
// reminders on from the Settings screen, therefore no surprise request appears.
// ============================================================================

import { fmt } from './money.js'
import { today, addDays, fmtDate, daysBetween } from './dates.js'

const PREF_KEY = 'lin_ledger_reminders'
const LAST_KEY = 'lin_ledger_reminded_on'

const read = k => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch {} }

/** True when this browser can show a message. */
export const supported = () => typeof Notification !== 'undefined'

/** granted, denied or default. */
export const permission = () => (supported() ? Notification.permission : 'unsupported')

/** True when the user turned the reminders on. */
export const enabled = () =>
  supported() && read(PREF_KEY) === 'on' && Notification.permission === 'granted'

/**
 * Asks the browser for permission, then remembers the answer.
 * Call this only from a button that the user pressed. A browser refuses a
 * request that does not come from an action of the user.
 */
export async function enable () {
  if (!supported()) throw new Error('This browser cannot show a message.')
  let state = Notification.permission
  if (state === 'default') state = await Notification.requestPermission()
  if (state !== 'granted') {
    write(PREF_KEY, 'off')
    throw new Error('The browser did not give permission. Change it in the '
                  + 'settings of the browser, then try again.')
  }
  write(PREF_KEY, 'on')
  return true
}

export function disable () {
  write(PREF_KEY, 'off')
}

/**
 * Shows one message about the payments that need attention.
 *
 * It shows one message for each day and no more. A person who opens the
 * application five times in one day gets one message, not five.
 */
export function showDueReminders (upcoming, { force = false } = {}) {
  if (!enabled()) return null
  const now = today()
  if (!force && read(LAST_KEY) === now) return null

  const soon = addDays(now, 3)
  const late = upcoming.filter(x => x.due_date < now)
  const near = upcoming.filter(x => x.due_date >= now && x.due_date <= soon)
  if (late.length === 0 && near.length === 0) {
    write(LAST_KEY, now)
    return null
  }

  const total = [...late, ...near].reduce((a, x) => a + Math.abs(x.amount), 0)
  const title = late.length
    ? `${late.length} late payment${late.length === 1 ? '' : 's'}`
    : `${near.length} payment${near.length === 1 ? '' : 's'} in 3 days`

  const lines = [...late, ...near].slice(0, 4)
    .map(x => `${x.name} ${fmt(Math.abs(x.amount))} on ${fmtDate(x.due_date)}`)
  if (late.length + near.length > 4) {
    lines.push(`and ${late.length + near.length - 4} more`)
  }
  lines.push(`Total ${fmt(total)}`)

  try {
    const note = new Notification(`Lin Ledger: ${title}`, {
      body: lines.join('\n'),
      tag: 'lin-ledger-due',
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230b1220'/%3E%3Cpath d='M13 43l11-14 9 7 11-19 9 12' fill='none' stroke='%234ade80' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
    })
    note.onclick = () => { window.focus(); location.hash = '#/bills'; note.close() }
    write(LAST_KEY, now)
    return note
  } catch {
    return null
  }
}

/** Lets the Settings screen show a message at once, as a test. */
export function testMessage () {
  if (!enabled()) throw new Error('Turn the reminders on first.')
  const note = new Notification('Lin Ledger', {
    body: 'The reminders work. You get a message when a payment is near, '
        + 'while this page is open.',
    tag: 'lin-ledger-test',
  })
  return note
}
