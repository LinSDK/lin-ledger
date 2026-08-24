// ============================================================================
// Lin Ledger : settings
// ============================================================================

import * as store from '../store.js'
import { fmt } from '../money.js'
import * as D from '../dates.js'
import { icon, esc, card, empty, toast, delegate, qs, formSheet, confirmSheet,
         listRow } from '../ui.js'
import { signOut } from '../auth.js'
import { sessionStoreName, sessionCookieInfo, COOKIES_AVAILABLE } from '../supabase.js'
import { APP_VERSION } from '../config.js'
import { applyTheme } from '../app.js'
import * as remind from '../remind.js'

const SPEND_MODELS = [
  { value: 'lump_at_period_start',
    label: 'All on the pay date',
    note: 'The full allowance leaves your balance on each pay date. This matches '
        + 'your workbook, therefore the forecast agrees with the numbers that you '
        + 'already know.' },
  { value: 'daily_drip',
    label: 'A little each day',
    note: 'The allowance leaves your balance day by day. The balance in the middle '
        + 'of a period is closer to the truth, and you get a figure for each day.' },
  { value: 'historical_average',
    label: 'From what you spent before',
    note: 'The forecast uses your own record instead of the allowance. This needs '
        + 'a few months of records before it is reliable.' },
]

export async function render (host) {
  const p = store.state.profile
  const cookie = sessionCookieInfo()

  host.innerHTML = `
    ${card('Money and the forecast', `
      ${settingRow('Money format', p.currency_symbol
        ? `${p.currency_symbol}1,234.56`
        : (p.negative_style === 'parentheses' ? '1,234.56 and (1,234.56)'
                                             : '1,234.56 and -1,234.56'), 'money')}
      ${settingRow('Buffer that you keep', fmt(p.safety_buffer), 'buffer')}
      ${settingRow('How far the forecast looks', `${p.projection_days} days`, 'days')}
      ${settingRow('Daily spending in the forecast',
        SPEND_MODELS.find(m => m.value === p.variable_spend_model)?.label ?? '--', 'model')}
    `)}

    ${card('Payroll rule', `
      ${settingRow('How often', payrollText(p), 'payroll')}
      ${settingRow('If the day is a weekend', {
        none: 'Keep the date',
        previous_business_day: 'Move earlier',
        next_business_day: 'Move later' }[p.weekend_adjust], 'payroll')}
      ${settingRow('Amount that you expect', fmt(p.payroll_default_amount), 'payroll')}
      <p class="note">${icon('info')} This rule only proposes new dates on the
        Payroll screen. It never changes a date that you set.</p>
    `)}

    ${card('Look', `
      <div class="field">
        <label>Theme</label>
        <div class="segment">
          ${['system', 'light', 'dark'].map(t => `
            <button class="seg ${p.theme === t ? 'is-on' : ''}" data-theme="${t}">
              ${t === 'system' ? 'Follow the device' : t === 'light' ? 'Light' : 'Dark'}
            </button>`).join('')}
        </div>
      </div>
    `)}

    ${card('Reminders', reminderCard())}

    ${card('Your session', `
      <div class="grid2">
        <div class="fact"><span>Signed in as</span>
          <strong>${esc(store.state.user?.email ?? '--')}</strong></div>
        <div class="fact"><span>Session kept in</span>
          <strong>${esc(sessionStoreName())}</strong></div>
        ${COOKIES_AVAILABLE ? `
        <div class="fact"><span>Cookie parts</span>
          <strong>${cookie.parts}</strong></div>
        <div class="fact"><span>Cookie size</span>
          <strong>${cookie.bytes} bytes</strong></div>` : ''}
      </div>
      ${COOKIES_AVAILABLE
        ? `<p class="note">${icon('info')} A session is larger than the 4 KB that
            one cookie holds, therefore the application divides it into
            ${cookie.parts} ${cookie.parts === 1 ? 'part' : 'parts'}. The cookie
            lasts 30 days.</p>`
        : `<p class="note">${icon('warn')} This page cannot write a cookie, which
            happens when you open the file directly. The session goes to
            localStorage instead. Open the application through a local server to
            use a cookie.</p>`}
      <button class="btn btn-danger-ghost btn-block" id="signout">Sign out</button>
    `)}

    ${card('Data', `
      ${listRow({ title: 'Reload from the database',
                  sub: 'Read every table again', attrs: 'data-act="reload"' })}
      ${listRow({ title: 'Build the bill rows',
                  sub: 'Make the rows that your rules reach', attrs: 'data-act="horizon"' })}
      ${listRow({ title: 'Save everything as a file',
                  sub: 'One JSON file that holds all of your data', attrs: 'data-act="export"' })}
    `)}

    ${card('About', `
      <div class="grid2">
        <div class="fact"><span>Version</span><strong>${esc(APP_VERSION)}</strong></div>
        <div class="fact"><span>Accounts</span><strong>${store.state.accounts.length}</strong></div>
        <div class="fact"><span>Money movements</span>
          <strong>${store.state.transactions.length}</strong></div>
        <div class="fact"><span>Loan payments</span>
          <strong>${store.state.loanPayments.length}</strong></div>
      </div>
      <p class="note">${icon('info')} This application runs with no build step.
        Every calculation happens in your browser, and your data stays in your
        own database.</p>
    `)}`

  wire(host)
}

const settingRow = (label, value, key) => listRow({
  title: esc(label), right: `<span class="muted">${esc(value)}</span>`,
  attrs: `data-set="${key}"`,
})

function payrollText (p) {
  if (p.payroll_mode === 'monthly') return `Every month, on day ${p.payroll_day_1}`
  if (p.payroll_mode === 'semi_monthly')
    return `Twice each month, on day ${p.payroll_day_1} and day ${p.payroll_day_2}`
  if (p.payroll_mode === 'biweekly') return 'Every 2 weeks'
  if (p.payroll_mode === 'weekly') return 'Every week'
  return 'Only the dates that I add'
}

/**
 * The reminder card.
 * A web page cannot send a message while it is shut, therefore this card says
 * plainly what each of the three methods can do.
 */
function reminderCard () {
  const state = remind.permission()
  const on = remind.enabled()

  if (state === 'unsupported') {
    return `<p class="prose">This browser cannot show a message. Use the
      calendar file on the Bills screen instead. Your telephone then gives you
      an alarm.</p>`
  }

  return `
    <label class="switch switch-inline">
      <input type="checkbox" ${on ? 'checked' : ''} id="remind-toggle"
             ${state === 'denied' ? 'disabled' : ''}>
      <span class="switch-track"><span class="switch-knob"></span></span>
      <span class="switch-text">Show a message about a near payment</span>
    </label>
    ${state === 'denied' ? `<p class="note">${icon('warn')} This browser refused
      permission for a message. Change that permission in the settings of the
      browser, then come back.</p>` : ''}
    <p class="note">${icon('info')} A web page cannot send a message while it is
      shut. This switch shows one message for each day, while this page is open.
      For an alarm that works when the application is shut, use
      <a href="#/bills">the calendar file</a> on the Bills screen.</p>
    ${on ? `<button class="btn btn-ghost btn-sm" id="remind-test">
      Show a test message</button>` : ''}`
}

function wire (host) {
  delegate(host, 'click', '[data-theme]', async (e, b) => {
    try {
      await store.saveProfile({ theme: b.dataset.theme })
      applyTheme(b.dataset.theme)
    } catch (ex) { toast(ex.message, 'error') }
  })

  delegate(host, 'click', '[data-set]', (e, node) => {
    const key = node.dataset.set
    if (key === 'money') openMoney()
    if (key === 'buffer') openBuffer()
    if (key === 'days') openDays()
    if (key === 'model') openModel()
    if (key === 'payroll') openPayrollRule()
  })

  qs('#remind-toggle', host)?.addEventListener('change', async e => {
    try {
      if (e.currentTarget.checked) {
        await remind.enable()
        toast('The reminders are on.', 'ok')
      } else {
        remind.disable()
        toast('The reminders are off.', 'ok')
      }
    } catch (ex) {
      e.currentTarget.checked = false
      toast(ex.message, 'error', 5000)
    }
    render(host)
  })

  qs('#remind-test', host)?.addEventListener('click', () => {
    try { remind.testMessage() } catch (ex) { toast(ex.message, 'error') }
  })

  qs('#signout', host)?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Sign out?',
      message: 'The application forgets the cookie on this browser.',
      confirmLabel: 'Sign out',
    })
    if (ok) await signOut()
  })

  delegate(host, 'click', '[data-act]', async (e, node) => {
    const act = node.dataset.act
    try {
      if (act === 'reload') { await store.refresh(); toast('The data is current.', 'ok') }
      if (act === 'horizon') {
        const made = await store.ensureHorizon()
        if (made) await store.refresh()
        toast(made ? `${made} bill rows added.` : 'Every row is already here.', 'ok')
      }
      if (act === 'export') exportJson()
    } catch (ex) { toast(ex.message, 'error') }
  })
}

// ---------------------------------------------------------------------------

function openMoney () {
  const p = store.state.profile
  formSheet({
    title: 'Money format',
    fields: [
      { name: 'currency_symbol', label: 'Symbol', type: 'text',
        placeholder: 'Leave this empty for no symbol',
        hint: 'Your workbook shows no symbol, therefore this is empty.' },
      { name: 'negative_style', label: 'A negative amount looks like', type: 'segment',
        options: [{ value: 'parentheses', label: '(1,234.56)' },
                  { value: 'minus', label: '-1,234.56' }] },
      { name: 'currency', label: 'Currency code', type: 'text',
        hint: 'The ledger keeps this for a later version. It changes nothing that '
            + 'you see now.' },
      { name: 'display_name', label: 'Your name', type: 'text' },
    ],
    values: p,
    onSubmit: async v => {
      await store.saveProfile({
        currency_symbol: v.currency_symbol ?? '',
        negative_style: v.negative_style, currency: v.currency || 'PHP',
        display_name: v.display_name || 'Lin',
      })
      toast('The format is saved.', 'ok')
    },
  })
}

function openBuffer () {
  formSheet({
    title: 'Buffer that you keep',
    fields: [
      { name: 'safety_buffer', label: 'Never go under this amount', type: 'money',
        hint: 'The forecast calls a period "tight" when the balance falls under '
            + 'this amount, even when the balance stays above zero. Use 0 to '
            + 'switch this off.' },
    ],
    values: store.state.profile,
    onSubmit: async v => {
      await store.saveProfile({ safety_buffer: v.safety_buffer ?? 0 })
      toast('The buffer is saved.', 'ok')
    },
  })
}

function openDays () {
  formSheet({
    title: 'How far the forecast looks',
    fields: [
      { name: 'projection_days', label: 'Days', type: 'number', min: 7, max: 1825,
        required: true,
        hint: 'The home screen chart covers this many days. Your longest loan '
            + 'runs to ' + (longestDue() || 'no date') + '.' },
      { name: 'horizon_months', label: 'Months of bill rows to keep ready',
        type: 'number', min: 1, max: 60 },
    ],
    values: store.state.profile,
    onSubmit: async v => {
      await store.saveProfile({
        projection_days: Number(v.projection_days),
        horizon_months: Number(v.horizon_months),
      })
      toast('The forecast length is saved.', 'ok')
    },
  })
}

const longestDue = () => {
  const dates = store.state.loanPayments
    .filter(r => r.status === 'pending').map(r => r.due_date).sort()
  return dates.length ? D.fmtDate(dates[dates.length - 1]) : null
}

function openModel () {
  formSheet({
    title: 'Daily spending in the forecast',
    fields: [
      { name: 'variable_spend_model', label: 'Method', type: 'select',
        options: SPEND_MODELS.map(m => ({ value: m.value, label: m.label })) },
      { name: 'note', label: '', type: 'static',
        render: v => {
          const m = SPEND_MODELS.find(x => x.value === v.variable_spend_model)
          return `<p class="prose">${esc(m?.note ?? '')}</p>`
        } },
    ],
    values: store.state.profile,
    onSubmit: async v => {
      await store.saveProfile({ variable_spend_model: v.variable_spend_model })
      toast('The method is saved.', 'ok')
    },
  })
}

function openPayrollRule () {
  const accounts = store.state.accounts.filter(a => !a.is_archived)
    .map(a => ({ value: a.id, label: a.name }))
  formSheet({
    title: 'Payroll rule',
    fields: [
      { name: 'payroll_mode', label: 'How often', type: 'select', options: [
        { value: 'semi_monthly', label: 'Twice each month' },
        { value: 'monthly', label: 'Every month' },
        { value: 'biweekly', label: 'Every 2 weeks' },
        { value: 'weekly', label: 'Every week' },
        { value: 'manual', label: 'Only the dates that I add' }] },
      { name: 'payroll_day_1', label: 'First day of the month', type: 'number',
        min: -1, max: 31,
        when: v => ['semi_monthly', 'monthly'].includes(v.payroll_mode) },
      { name: 'payroll_day_2', label: 'Second day of the month', type: 'number',
        min: -1, max: 31, when: v => v.payroll_mode === 'semi_monthly' },
      { name: 'weekend_adjust', label: 'If that day is a weekend', type: 'select',
        options: [
          { value: 'none', label: 'Keep the date' },
          { value: 'previous_business_day', label: 'Move earlier' },
          { value: 'next_business_day', label: 'Move later' }] },
      { name: 'payroll_default_amount', label: 'Amount that you expect', type: 'money' },
      { name: 'payroll_account_id', label: 'It arrives in', type: 'select',
        options: accounts },
      { name: 'warn', label: '', type: 'static',
        render: () => `<p class="note">${icon('info')} Your real pay dates follow
          no exact rule. This rule only proposes new dates, therefore a date that
          you set by hand always stays.</p>` },
    ],
    values: store.state.profile,
    onSubmit: async v => {
      await store.saveProfile({
        payroll_mode: v.payroll_mode,
        payroll_day_1: Number(v.payroll_day_1 ?? 13),
        payroll_day_2: Number(v.payroll_day_2 ?? 28),
        weekend_adjust: v.weekend_adjust,
        payroll_default_amount: v.payroll_default_amount ?? 0,
        payroll_account_id: v.payroll_account_id || null,
      })
      toast('The rule is saved.', 'ok')
    },
  })
}

function exportJson () {
  const s = store.state
  const payload = {
    exported_at: new Date().toISOString(),
    app_version: APP_VERSION,
    note: 'Every amount here is in centavos, which are whole numbers.',
    profile: s.profile, accounts: s.accounts, categories: s.categories,
    transactions: s.transactions, recurring_payments: s.recurring,
    scheduled_payments: s.scheduled, loans: s.loans,
    loan_payments: s.loanPayments, payroll_events: s.payroll,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)],
                        { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lin-ledger-${D.today()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  toast('Your data is saved to a file.', 'ok')
}
