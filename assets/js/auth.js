// ============================================================================
// Lin Ledger : sign in and sign out
//
// The form asks for a user name, because a name is quicker to type on a
// telephone than an address. This module adds the domain from config.js to make
// the address that the authentication server needs. A name that holds the "@"
// character goes to the server as it is.
// ============================================================================

import { supabase } from './supabase.js'
import { LOGIN_DOMAIN } from './config.js'

/** "lin" becomes "lin@lin-ledger.local". */
export function toEmail (username) {
  const name = String(username || '').trim()
  if (!name) return ''
  return name.includes('@') ? name : `${name.toLowerCase()}@${LOGIN_DOMAIN}`
}

export async function signIn (username, password) {
  const email = toEmail(username)
  if (!email) throw new Error('Type your user name.')
  if (!password) throw new Error('Type your password.')

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Change the message of the server into a message for a person.
    const m = (error.message || '').toLowerCase()
    if (m.includes('invalid login')) {
      throw new Error('That user name or password is not correct.')
    }
    if (m.includes('database error')) {
      throw new Error(
        'The authentication server rejected the account record. '
        + 'Run sql/03_user.sql again to repair it.')
    }
    if (m.includes('email not confirmed')) {
      throw new Error(
        'This account is not confirmed. Run sql/03_user.sql to confirm it.')
    }
    if (m.includes('failed to fetch') || m.includes('networkerror')) {
      throw new Error('The application cannot reach the server. Check the network.')
    }
    throw new Error(error.message)
  }
  return data
}

export async function signOut () {
  await supabase.auth.signOut()
}

export async function currentSession () {
  const { data } = await supabase.auth.getSession()
  return data?.session ?? null
}

export async function currentUser () {
  const { data } = await supabase.auth.getUser()
  return data?.user ?? null
}

/** Calls back each time the session starts, ends or refreshes. */
export function onAuthChange (fn) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => fn(event, session))
  return () => data?.subscription?.unsubscribe?.()
}
