// ============================================================================
// Lin Ledger : settings
//
// The publishable key is safe in this file. It is public by design. Row level
// security in the database is the protection for the data. Never put the
// database connection string or a secret key in this file.
// ============================================================================

export const SUPABASE_URL = 'https://lcjzxpttjqqczsvjrrfe.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_VZPp-BF8xPCdCqdNa0FeZA_0iMveOCe'

// The client library comes from a CDN, because the application has no build
// step. If the first address fails, the application tries the second one.
export const CDN_URLS = [
  'https://esm.sh/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
]

// The login form asks for a user name. The application adds this domain to
// make the address that the authentication server needs. A name that holds
// the "@" character goes to the server without a change.
// Keep this value the same as the address in sql/03_user.sql.
export const LOGIN_DOMAIN = 'lin-ledger.local'

// The name of the session cookie. The session is larger than the limit for
// one cookie, therefore the application divides it into parts:
//   lin_ledger_auth.n  = the number of parts
//   lin_ledger_auth.0  = the first part, and so on
export const COOKIE_KEY  = 'lin_ledger_auth'
export const COOKIE_DAYS = 30

// How far forward the application makes bill rows from a recurring rule.
export const GENERATE_MONTHS = 18

// The choices in the forecast length control.
export const HORIZON_CHOICES = [30, 60, 90, 180, 365, 730]

export const APP_NAME = 'Lin Ledger'
export const APP_VERSION = '1.0.0'
