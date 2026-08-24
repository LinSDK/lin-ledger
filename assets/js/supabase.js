// ============================================================================
// Lin Ledger : the database client and the session cookie
//
// The session goes into a cookie, because the request asks for a cookie.
// A session is larger than the 4 KB that one cookie holds, therefore this
// module divides the session into parts:
//
//   lin_ledger_auth.n  the number of parts
//   lin_ledger_auth.0  the first part
//   lin_ledger_auth.1  the second part, and so on
//
// A browser refuses a cookie on a "file://" page. If the cookie test fails,
// this module uses localStorage instead, and the application continues to work.
// ============================================================================

import { SUPABASE_URL, SUPABASE_KEY, CDN_URLS, COOKIE_KEY, COOKIE_DAYS }
  from './config.js'

// --- one cookie --------------------------------------------------------------

const SECURE = location.protocol === 'https:'
const CHUNK_SIZE = 3200         // below the 4 KB limit, with room for the name

function cookieGet (name) {
  const target = encodeURIComponent(name) + '='
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(target)) {
      try { return decodeURIComponent(part.slice(target.length)) } catch { return null }
    }
  }
  return null
}

function cookieSet (name, value, days) {
  const age = Math.round(days * 86400)
  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/', `Max-Age=${age}`, 'SameSite=Lax', SECURE ? 'Secure' : '',
  ].filter(Boolean).join('; ')
}

function cookieDelete (name) {
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`
}

/** Can this page write a cookie? A "file://" page cannot. */
function cookiesWork () {
  try {
    const probe = '__ll_probe'
    cookieSet(probe, '1', 1)
    const ok = cookieGet(probe) === '1'
    cookieDelete(probe)
    return ok
  } catch { return false }
}

export const COOKIES_AVAILABLE = cookiesWork()

// --- the store that the client library uses ----------------------------------

const chunkedCookieStorage = {
  getItem (key) {
    const count = Number(cookieGet(`${key}.n`) || 0)
    if (!count) return cookieGet(key)          // an older single cookie
    let out = ''
    for (let i = 0; i < count; i++) {
      const part = cookieGet(`${key}.${i}`)
      if (part === null) return null           // a part is missing, so give up
      out += part
    }
    return out
  },

  setItem (key, value) {
    // Clear the parts of the value that was there before.
    const old = Number(cookieGet(`${key}.n`) || 0)
    for (let i = 0; i < old; i++) cookieDelete(`${key}.${i}`)
    cookieDelete(key)

    const parts = []
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      parts.push(value.slice(i, i + CHUNK_SIZE))
    }
    parts.forEach((part, i) => cookieSet(`${key}.${i}`, part, COOKIE_DAYS))
    cookieSet(`${key}.n`, String(parts.length), COOKIE_DAYS)
  },

  removeItem (key) {
    const count = Number(cookieGet(`${key}.n`) || 0)
    for (let i = 0; i < count; i++) cookieDelete(`${key}.${i}`)
    cookieDelete(`${key}.n`)
    cookieDelete(key)
  },
}

const localStorageFallback = {
  getItem: k => { try { return localStorage.getItem(k) } catch { return null } },
  setItem: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
  removeItem: k => { try { localStorage.removeItem(k) } catch {} },
}

export const sessionStore = COOKIES_AVAILABLE
  ? chunkedCookieStorage
  : localStorageFallback

/** Tells the settings screen where the session is kept. */
export function sessionStoreName () {
  return COOKIES_AVAILABLE ? 'cookie' : 'localStorage'
}

/** Reports how many cookie parts hold the session now. */
export function sessionCookieInfo () {
  if (!COOKIES_AVAILABLE) return { parts: 0, bytes: 0 }
  const count = Number(cookieGet(`${COOKIE_KEY}.n`) || 0)
  let bytes = 0
  for (let i = 0; i < count; i++) bytes += (cookieGet(`${COOKIE_KEY}.${i}`) || '').length
  return { parts: count, bytes }
}

// --- load the client library from a CDN --------------------------------------

async function loadCreateClient () {
  const problems = []
  for (const url of CDN_URLS) {
    try {
      const mod = await import(url)
      if (mod?.createClient) return mod.createClient
      problems.push(`${url}: the module has no createClient`)
    } catch (e) {
      problems.push(`${url}: ${e.message}`)
    }
  }
  throw new Error(
    'The database client library did not load. This application needs a '
    + 'network connection the first time that it starts.\n' + problems.join('\n'))
}

const createClient = await loadCreateClient()

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: sessionStore,
    storageKey: COOKIE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
  global: {
    headers: { 'X-Client-Info': 'lin-ledger' },
  },
})

/** Raises the error of a query, so a caller does not have to test for it. */
export function unwrap ({ data, error }) {
  if (error) throw new Error(error.message || String(error))
  return data
}
