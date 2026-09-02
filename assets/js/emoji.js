// ============================================================================
// Lin Ledger : the emoji of an account
//
// An account carries one emoji. A person reads an emoji faster than a name at
// the size of a card on a telephone, and an emoji needs no drawing in the code.
//
// The column accounts.icon held a name before, for example "wallet". This
// module reads both: a name becomes the emoji that matches it, and an emoji
// passes through. Therefore an account that nobody edited still shows a mark.
// ============================================================================

import * as store from './store.js'
import { openSheet, qs, toast, esc } from './ui.js'

/** The names that the first seed wrote, and the emoji for each one. */
const LEGACY = {
  wallet: '📱', cash: '💵', coins: '🪙', bank: '🏦', card: '💳',
  savings: '🏛️', credit: '💳', other: '👛',
}

/** The emoji for a kind of account, when the account carries nothing. */
const BY_KIND = {
  bank: '🏦', wallet: '📱', cash: '💵', coins: '🪙',
  savings: '🏛️', credit: '💳', other: '👛',
}

/**
 * The emoji to show for an account.
 *
 * A stored value that holds only lower case letters is one of the old names,
 * therefore it goes through the table. Anything else is the emoji that the
 * person chose, and it passes through as it is.
 */
export function accountEmoji (account) {
  const raw = String(account?.icon ?? '').trim()
  if (!raw) return BY_KIND[account?.kind] || '👛'
  if (/^[a-z_]+$/.test(raw)) return LEGACY[raw] || BY_KIND[account?.kind] || '👛'
  return raw
}

/** The groups of the picker. */
const GROUPS = [
  { name: 'Money', list: ['💵', '💰', '💸', '🪙', '💳', '🧾', '🏦', '🏧',
                          '👛', '👜', '💼', '🤑', '💎', '📈', '📉', '🧮'] },
  { name: 'Places and things', list: ['📱', '💻', '🏠', '🏢', '🏛️', '🔒', '🗄️',
                                      '📦', '🎁', '🛒', '🧺', '🍽️', '🚌', '⛽'] },
  { name: 'Marks', list: ['⭐', '✨', '🔥', '❤️', '💙', '💚', '💜', '🧡',
                          '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪'] },
  { name: 'Animals and plants', list: ['🐷', '🐖', '🐱', '🐶', '🐢', '🦆', '🐝',
                                       '🌱', '🌿', '🍀', '🌳', '🌸', '🌞', '🌙'] },
]

/**
 * Opens the picker for one account.
 *
 * The sheet writes as soon as a person selects an emoji, then it shuts. A
 * choice of one character needs no Save button, and an extra tap on a telephone
 * is the cost that this screen tries hardest to avoid.
 */
export function openEmojiPicker (account, onDone) {
  const current = accountEmoji(account)

  const sheet = openSheet({
    title: `The mark for ${account.name}`,
    size: 'md',
    body: `
      <p class="prose">Select an emoji for this account. The home screen shows
        it on the card.</p>

      <div class="emoji-now">
        <span class="emoji-now-mark">${esc(current)}</span>
        <span class="emoji-now-text">${esc(account.name)}</span>
      </div>

      ${GROUPS.map(g => `
        <div class="emoji-group">
          <p class="emoji-group-head">${esc(g.name)}</p>
          <div class="emoji-grid">
            ${g.list.map(e => `
              <button type="button" class="emoji-btn ${e === current ? 'is-on' : ''}"
                      data-emoji="${esc(e)}" aria-label="${esc(e)}">${esc(e)}</button>`).join('')}
          </div>
        </div>`).join('')}

      <div class="field">
        <label for="emoji-own">Or type any emoji</label>
        <div class="emoji-own">
          <input id="emoji-own" class="inp" type="text" maxlength="8"
                 autocomplete="off" placeholder="${esc(current)}">
          <button type="button" class="btn btn-primary" data-emoji-save>Use it</button>
        </div>
        <p class="hint">Your telephone keyboard holds an emoji key. On a
          computer, paste one in.</p>
      </div>`,
  })

  const save = async value => {
    const mark = String(value || '').trim()
    if (!mark) { toast('Select an emoji first.', 'error'); return }
    try {
      await store.updateAccount(account.id, { icon: mark })
      sheet.close()
      await store.refresh()
      onDone?.(mark)
    } catch (ex) { toast(ex.message, 'error') }
  }

  sheet.el.addEventListener('click', e => {
    const pick = e.target.closest('[data-emoji]')
    if (pick) { save(pick.dataset.emoji); return }
    if (e.target.closest('[data-emoji-save]')) save(qs('#emoji-own', sheet.el).value)
  })

  qs('#emoji-own', sheet.el).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(e.currentTarget.value) }
  })

  return sheet
}
