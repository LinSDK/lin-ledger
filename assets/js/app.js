// ============================================================================
// Lin Ledger : the shell, the router and the first start
//
// The router reads the part of the address after the "#" character. That kind
// of address needs no rule on the server, therefore the application runs from
// any folder and from any static host.
// ============================================================================

import { APP_NAME, APP_VERSION } from './config.js'
import { supabase, COOKIES_AVAILABLE, sessionStoreName } from './supabase.js'
import { signIn, signOut, currentSession, onAuthChange } from './auth.js'
import * as store from './store.js'
import { h, qs, qsa, icon, toast, openSheet, formSheet, skeleton, esc, delegate }
  from './ui.js'
import { fmt } from './money.js'
import { today } from './dates.js'

import * as home      from './views/home.js'
import * as bills     from './views/bills.js'
import * as loans     from './views/loans.js'
import * as stats     from './views/stats.js'
import * as more      from './views/more.js'
import * as accounts  from './views/accounts.js'
import * as categories from './views/categories.js'
import * as payroll   from './views/payroll.js'
import * as scenarios from './views/scenarios.js'
import * as settings  from './views/settings.js'
import { openQuickAdd } from './views/quick-add.js'
import { showDueReminders } from './remind.js'

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ROUTES = [
  { path: 'home',       view: home,       title: 'Lin Ledger',      tab: 'home'  },
  { path: 'bills',      view: bills,      title: 'Bills',           tab: 'bills' },
  { path: 'loans',      view: loans,      title: 'Loans',           tab: 'loans' },
  { path: 'stats',      view: stats,      title: 'Statistics',      tab: 'stats' },
  { path: 'more',       view: more,       title: 'More',            tab: 'more'  },
  { path: 'accounts',   view: accounts,   title: 'Accounts',        tab: 'more', back: '#/more' },
  { path: 'categories', view: categories, title: 'Categories',      tab: 'more', back: '#/more' },
  { path: 'payroll',    view: payroll,    title: 'Payroll',         tab: 'more', back: '#/more' },
  { path: 'scenarios',  view: scenarios,  title: 'What if',          tab: 'more', back: '#/more' },
  { path: 'settings',   view: settings,   title: 'Settings',        tab: 'more', back: '#/more' },
]

const TABS = [
  { tab: 'home',  label: 'Home',  ic: 'home'  },
  { tab: 'bills', label: 'Bills', ic: 'bills' },
  { tab: 'loans', label: 'Loans', ic: 'loans' },
  { tab: 'stats', label: 'Stats', ic: 'stats' },
  { tab: 'more',  label: 'More',  ic: 'more'  },
]

function parseHash () {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '')
  const [path, ...rest] = raw.split('/')
  return { path: path || 'home', params: rest }
}

// ---------------------------------------------------------------------------
// The theme
// ---------------------------------------------------------------------------

export function applyTheme (theme) {
  const t = theme || store.state.profile?.theme || 'system'
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}

// ---------------------------------------------------------------------------
// The sign in screen
// ---------------------------------------------------------------------------

function renderLogin (root, message = '') {
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login" id="login-form">
        <div class="login-mark">${icon('spark')}</div>
        <h1>${esc(APP_NAME)}</h1>
        <p class="login-sub">Your money, and what comes next.</p>

        <label for="u">User name</label>
        <input id="u" class="inp" name="username" autocomplete="username"
               autocapitalize="none" spellcheck="false" value="lin" required>

        <label for="p">Password</label>
        <input id="p" class="inp" name="password" type="password"
               autocomplete="current-password" required>

        <p class="err" id="login-err">${esc(message)}</p>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>

        <p class="login-note">
          ${COOKIES_AVAILABLE
            ? 'This browser keeps you signed in with a cookie for 30 days.'
            : 'This page cannot write a cookie. Open the application through a '
              + 'local server to keep the cookie. The session goes to '
              + 'localStorage now.'}
        </p>
      </form>
    </div>`

  const form = qs('#login-form', root)
  const err = qs('#login-err', root)
  form.addEventListener('submit', async e => {
    e.preventDefault()
    err.textContent = ''
    const button = qs('button', form)
    button.disabled = true
    button.classList.add('is-busy')
    try {
      await signIn(form.username.value, form.password.value)
      await boot()
    } catch (ex) {
      err.textContent = ex.message
      button.disabled = false
      button.classList.remove('is-busy')
    }
  })
  const pass = qs('#p', root)
  if (pass && !('ontouchstart' in window)) pass.focus()
}

// ---------------------------------------------------------------------------
// The frame of the application
// ---------------------------------------------------------------------------

function renderShell (root) {
  root.innerHTML = `
    <div class="app">
      <aside class="side">
        <div class="side-mark">${icon('spark')}<span>${esc(APP_NAME)}</span></div>
        <nav class="side-nav">
          ${TABS.map(t => `<a class="side-link" data-tab="${t.tab}" href="#/${t.tab}">
             ${icon(t.ic)}<span>${t.label}</span></a>`).join('')}
        </nav>
        <div class="side-foot">
          <button class="btn btn-ghost btn-sm" id="side-add">${icon('plus')} Add</button>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="btn-icon" id="top-back" hidden aria-label="Back">${icon('back')}</button>
          <h1 id="top-title">${esc(APP_NAME)}</h1>
          <button class="btn-icon" id="top-refresh" aria-label="Reload the data">${icon('refresh')}</button>
        </header>

        <main class="screen" id="screen">${skeleton(4)}</main>

        <button class="fab" id="fab" aria-label="Add a payment or income">${icon('plus')}</button>

        <nav class="tabbar">
          ${TABS.map(t => `<a class="tab" data-tab="${t.tab}" href="#/${t.tab}">
             ${icon(t.ic)}<span>${t.label}</span></a>`).join('')}
        </nav>
      </div>
    </div>`

  qs('#fab', root).addEventListener('click', () => openQuickAdd())
  qs('#side-add', root).addEventListener('click', () => openQuickAdd())
  qs('#top-back', root).addEventListener('click', () => {
    const route = ROUTES.find(r => r.path === parseHash().path)
    location.hash = route?.back || '#/home'
  })
  qs('#top-refresh', root).addEventListener('click', async e => {
    const button = e.currentTarget
    button.classList.add('is-spin')
    try { await store.refresh(); toast('The data is current.', 'ok') }
    catch (ex) { toast(ex.message, 'error') }
    finally { button.classList.remove('is-spin') }
  })
}

// ---------------------------------------------------------------------------
// Draw the screen
// ---------------------------------------------------------------------------

let currentCleanup = null
let rendering = false

export async function renderRoute () {
  const { path, params } = parseHash()
  const route = ROUTES.find(r => r.path === path) || ROUTES[0]
  const screen = qs('#screen')
  if (!screen) return

  if (rendering) return
  rendering = true

  try { currentCleanup?.() } catch {}
  currentCleanup = null

  qs('#top-title').textContent = route.title
  qs('#top-back').hidden = !route.back
  qsa('.tab, .side-link').forEach(a =>
    a.classList.toggle('is-on', a.dataset.tab === route.tab))
  document.title = route.title === APP_NAME ? APP_NAME : `${route.title} - ${APP_NAME}`

  // The window scrolls, not the panel. A new screen must start at the top.
  screen.scrollTop = 0
  window.scrollTo({ top: 0, behavior: 'instant' })
  try {
    currentCleanup = await route.view.render(screen, params) || null
  } catch (ex) {
    console.error(ex)
    screen.innerHTML = `<div class="empty">${icon('warn')}
      <p>This screen did not open.</p>
      <p class="hint">${esc(ex.message)}</p></div>`
  } finally {
    rendering = false
  }
}

/** Draws the screen again after the data changes. */
let redrawTimer = null
function scheduleRedraw () {
  clearTimeout(redrawTimer)
  redrawTimer = setTimeout(() => renderRoute(), 30)
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function boot () {
  const root = qs('#root')
  root.innerHTML = `<div class="boot">${icon('spark')}<p>Loading</p></div>`

  const session = await currentSession()
  if (!session) { renderLogin(root); return }

  try {
    await store.loadAll()
  } catch (ex) {
    if (/JWT|token|session|sign/i.test(ex.message)) {
      await signOut()
      renderLogin(root, 'Your session ended. Sign in again.')
      return
    }
    root.innerHTML = `<div class="empty">${icon('warn')}
      <p>The data did not load.</p><p class="hint">${esc(ex.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`
    return
  }

  applyTheme()
  renderShell(root)
  await renderRoute()

  // One message for each day, and only when the user turned it on.
  showDueReminders(store.state.upcoming)

  // Make the bill rows that the rules reach, then draw again if rows appeared.
  store.ensureHorizon()
    .then(async made => {
      if (made > 0) {
        await store.refresh()
        toast(`${made} bill ${made === 1 ? 'row' : 'rows'} added from your rules.`, 'ok')
      }
    })
    .catch(ex => console.warn('The bill rows did not generate:', ex.message))
}

// The application places each screen at the top itself. Without this line the
// browser would put back the position of the screen that came before.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

store.onChange(scheduleRedraw)
window.addEventListener('hashchange', renderRoute)

onAuthChange((event) => {
  if (event === 'SIGNED_OUT') {
    store.state.loaded = false
    renderLogin(qs('#root'))
  }
})

// A helper for the settings screen and for a problem report.
window.LinLedger = {
  version: APP_VERSION, store, supabase,
  sessionStore: sessionStoreName(),
  reload: () => store.refresh(),
}

boot().catch(ex => {
  console.error(ex)
  qs('#root').innerHTML = `<div class="empty">
    <p>The application did not start.</p>
    <p class="hint">${esc(ex.message)}</p></div>`
})
