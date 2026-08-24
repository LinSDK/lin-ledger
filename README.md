# Lin Ledger

A personal money ledger that answers:

> **With the money I have and the payments that are coming, am I going to be okay?**


## What it is for

- **Know what you hold.** Track money across the places that hold it: a bank, a
  digital wallet, cash, coins. You name each one.
- **See what is coming.** Rent, card payments, loans and anything else that
  repeats, with a warning before a payment is due.
- **Know whether this pay period works.** If it does not, the app names the
  categories to cut and by how much, and gives you an amount for each day.
- **See where the money goes.** Spending by category, largest first, against
  your budget.
- **Understand what borrowing costs.** The payment schedule of each loan, the
  interest split, and the true yearly cost after the charges.
- **Ask before you commit.** *Can I pay this loan off early?* *Can I take this
  loan on this date?* The answer is safe, tight, or not possible, and it names
  the payments that would fail.

## Shape of it

Built for a phone first, and it works on a desktop. It runs in a browser with no
build step: no bundler, no compiler, nothing to install. The data lives in your
own Supabase database, and every calculation happens in your browser.

## Getting started

Run a local server in this folder, then open the address it prints:

```bash
python -m http.server 8080
```

The app needs a server rather than a plain file, because browsers block program
modules and refuse cookies on a `file://` page.

**[AGENTS.md](AGENTS.md) has everything else** — the install steps, the database
setup, the rules the forecast follows, the limits, and the tests.

## Licence

MIT.
