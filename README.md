# KhalkosPay

**Buy NIM with local money, cash it out to naira, send it as gift cards, and grow a healthy-eating pet, all inside Nimiq Pay.**

KhalkosPay is a Nimiq Pay mini app that turns NIM into something people use every day. Buy NIM with mobile money, bank transfer or card in 11 currencies. Cash NIM out to any Nigerian bank in about a minute, or do it by voice call. Send NIM gift cards anyone can redeem. Keep BiteBuddy, a pet that thrives when you eat well, alive. Every payment is checked on the Nimiq blockchain.

## The problem

People across Africa who want to use NIM have four gaps:

- **No easy way to get NIM.** NIM isn't on the swap networks most wallets use, so buying it usually means a centralized exchange account first.
- **No easy way to get naira.** Turning NIM into money in a Nigerian bank account usually means exchanges, P2P trades and waiting.
- **No friendly way to give it.** There's no simple way to gift NIM to someone who has never used crypto.
- **No everyday reason to open the wallet.** Most crypto apps are about trading. Very few are about daily life.

## What KhalkosPay does

### 1. Buy NIM with local money

- **11 currencies, paid the local way.** Through [Bachs](https://bachs.io):
  - naira by bank transfer or card
  - mobile money in Ghana (GHS), Kenya (KES), Uganda (UGX), Tanzania (TZS), Rwanda (RWF), Zambia (ZMW), Malawi (MWK) and the CFA franc zones (XAF, XOF)
  - US dollars by card
- **Live quote.** Enter an amount in your currency and see exactly how much NIM you get. The price is NIM in USD from CoinGecko, converted with a daily exchange-rate feed (naira uses the same rate as cash-out), minus a 2% fee.
- **Locked rate.** Your price is held for the 30 minutes the checkout stays open.
- **Only NIM that's really there.** Each purchase reserves its NIM from the treasury, beyond what KhalkosPay already owes for gifts, cash-outs and other purchases. Two buyers can never be sold the same NIM.
- **Confirmed with Bachs, then paid on-chain.** Bachs' signed webhook prompts KhalkosPay to check the payment with the Bachs API, and KhalkosPay also checks on its own in case a webhook goes missing. Once the payment is confirmed, the NIM goes straight to your wallet. Short or wrong-currency payments are held for review instead of paid out, and an operator settles them from the [admin dashboard](#admin-dashboard).
- **Live status.** A purchase page follows each step (rate locked, payment received, NIM sent) and shows the Nimiq transaction.

### 2. Cash out NIM to naira

- **Any Nigerian bank.** GTBank, Access, Zenith, OPay, Moniepoint, Kuda, PalmPay and more.
- **Live quote.** Enter an amount and see exactly what lands in your account. The rate comes from CoinGecko, and the fee is 1% plus the bank transfer fee.
- **Verified recipient.** The account holder's name is checked with the bank before you pay, so you never send to the wrong person.
- **Locked rate.** Your rate is held for 10 minutes while you approve the payment in Nimiq Pay.
- **Checked on-chain.** KhalkosPay confirms your NIM on the Nimiq blockchain, then Paystack sends the naira, usually within a minute.
- **Automatic refunds.** If the bank transfer fails, your NIM is sent back to your wallet.
- **Clear receipt.** A live timeline and a money-movement record show every debit and credit.

### 3. Cash out by voice call

- **Just talk.** Tap Call and say something like "Sell 500 NIM to my GTBank account."
- **Powered by** a Deepgram Voice Agent for speech (Nova-3 to listen, Aura-2 to speak) and Claude for the conversation.
- **Same steps as the app.** The agent finds your bank, gives a live quote, reads your account name back to you, and locks the order.
- **You stay in control.** The payment itself is still approved by you in Nimiq Pay.
- **Made for Nigerian users.** It understands bank nicknames like "GT", "Opay" and "Moniepoint".

### 4. NIM gift cards

- **Designs.** 11 card designs (birthday, love, thanks, congrats, holiday and abstract art), with a personal message.
- **Sender name.** Add your name, or send anonymously so the recipient sees neither your name nor your wallet.
- **Held until claimed.** The gift's NIM is paid to KhalkosPay and held until someone claims it.
- **How it's shared:**
  - a Nimiq Pay link that opens the gift inside the app
  - a short gift code like `K7QM-3XPD`
  - a secret code you pass on separately, since anyone with both the link and the code can claim the gift
  - an optional email (via Resend) sent to the recipient once the gift is paid for
- **Claiming.** The recipient opens the gift in Nimiq Pay, enters the secret code, and the NIM is sent straight to their wallet on-chain.
- **Taking a gift back.** Senders can take back any unclaimed gift. Gifts made on your phone need no extra steps; gifts made on another device need a quick wallet signature.
- **Short payments are refunded.** If a gift isn't fully paid for, the NIM goes back automatically.

### 5. BiteBuddy, the healthy-eating pet

Six food-themed pets, each with its own ability:

| Pet | Ability |
| --- | --- |
| Sunny | Early Bird: breakfast gives double strength |
| Mochi | Soft Landing: missed meals cost half the strength |
| Jalapup | Spicy Metabolism: healthy meals give 50% more strength, junk food hurts double |
| Peasley | Green Thumb: healthy meals earn 50% more XP |
| Puddin | Iron Stomach: junk food never lowers its strength |
| Takko | Last Stand: survives one full day without food |

- **Feed it by photographing your real meal.** Claude scores how healthy the meal is.
- **Strict meal times** in your own timezone: breakfast 5:00–12:00, lunch 12:00–17:00 and dinner 17:00–23:00. Overnight the pet is asleep and can't eat.
- **Consequences.** Missed meals cost strength, breakfast the most. A whole day without food is fatal.
- **Revive for 50 NIM**, paid and checked on-chain like every other payment.
- **Animated moods.** Thriving, happy, hungry, weak, asleep, and a ghost with a halo when it dies.
- **Meal reminders** when each meal window opens, plus a last call before it closes.

## Built for Nimiq Pay

- **Native wallet features.** Uses `@nimiq/mini-app-sdk` for connecting accounts (`listAccounts`), payments with a memo (`sendBasicTransactionWithData`), wallet sign-in (`sign`), balances (`getBalance`) and detecting mainnet or testnet (`getHostNetwork`).
- **Every payment is verified on-chain.** Each one carries a unique memo. The server checks the recipient, memo, amount, confirmations and that no transaction is used twice. It also scans the treasury for payments the app never reported, for example if you close the app mid-payment.
- **Understands Nimiq Pay's wallet setup.** Nimiq Pay keeps your spendable NIM in a contract account owned by your key. KhalkosPay pays out to the key that owns that account, so payouts and refunds actually arrive.
- **Made for phones.** An account switcher with live balances, network mismatch warnings, copy that still works inside the WebView, deep links through `nimpay.app`, and full light and dark mode.

## Trust and safety

- **No double payouts.** Every payout is signed and saved before it's broadcast, and each status change only happens once, so a claim, refund, take-back or purchase can never pay twice.
- **Webhooks can't release NIM on their own.** A Bachs webhook only prompts KhalkosPay to ask the Bachs API about the payment. Webhook signatures are checked (HMAC-SHA256, 5-minute window), and NIM is sent only when the API confirms the payment.
- **Automatic refunds** for failed bank transfers, short payments and duplicate payments.
- **A full record.** Every NIM and fiat movement is written to a ledger.
- **Protected codes.** Gift secret codes are stored only as scrypt hashes. Claim attempts are limited per gift and per IP address.
- **Wallet sign-in by signature.** Signing a message proves you own a wallet without moving any NIM.
- **Honest about holding funds.** Gift and revive NIM is held by KhalkosPay until it's claimed or refunded, and the app says so.
- **Accountable operators.** Each operator signs in to the admin dashboard with their own account, and every settled purchase records who settled it and when.

## Admin dashboard

Operators run KhalkosPay from `/admin` on the web app, in any desktop or phone browser. It isn't linked from the mini app, and the mini app never downloads its code.

- **Overview.** Key numbers for every feature and 30-day trends.
- **Activity.** Searchable tables for Buy NIM, cash-outs (including voice calls), gifts, BiteBuddy pets and revivals, and the full ledger. Open any row to see every field, including its ledger entries. Filtered views keep their filters in the URL, so you can share a link to one.
- **Settle held purchases.** A Buy NIM purchase that was paid short or in the wrong currency waits for an operator. Send the full NIM, send a pro-rata share of what was paid, or close it as refunded outside KhalkosPay with a note. Each purchase can only be settled once, even if two operators act at the same time. The purchase then shows who settled it, when, and the note.
- **Sign-in.** Each operator has their own email and password. Passwords are stored as scrypt hashes, sign-in attempts are rate limited, and sessions expire after `ADMIN_SESSION_HOURS` (12 by default).
- **Scripts.** An optional static `ADMIN_TOKEN` lets scripts call the same API (`/api/admin/...`) with `Authorization: Bearer <token>`. Purchases settled this way are recorded as settled by `admin-token`.

## Tech stack

| Part | Tools |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS v4, shadcn/ui on Base UI, Zustand |
| Backend | Node.js, TypeScript, Express 5, Prisma, PostgreSQL |
| Nimiq | `@nimiq/mini-app-sdk`, `@nimiq/core` for treasury signing, Nimiq JSON-RPC |
| Payments and rates | Bachs checkout (buying NIM), Paystack Transfers (cash-out), CoinGecko, open.er-api.com exchange rates |
| AI and voice | Anthropic Claude (meal scoring and voice reasoning), Deepgram Voice Agent |
| Email | Resend |
| Hosting | Vercel (frontend), Railway (backend and database) |

## Getting started

### Requirements

- Node.js 20.19+ or 22.12+
- PostgreSQL
- Nimiq Pay on your phone, on the same Wi-Fi network as your computer

### 1. Install

```bash
npm install
```
```bash
npm --prefix server install
```

### 2. Configure

Copy the example env files, then fill in your values. Each variable is explained in the example files.

```bash
cp .env.example .env
```
```bash
cp server/.env.example server/.env
```

The backend needs at least `DATABASE_URL`, the Nimiq network and RPC URL, and a treasury key. To generate a treasury key, run the command below and paste its output into `server/.env`. Back the key up: anyone with it controls the treasury.

```bash
npm --prefix server run treasury:new
```

Optional keys switch on more features:

| Variable | Turns on |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Bank payouts |
| `DEEPGRAM_API_KEY` | Voice cash-out |
| `ANTHROPIC_API_KEY` | BiteBuddy meal scoring |
| `RESEND_API_KEY`, `RESEND_FROM`, `MINIAPP_URL` | Gift emails |
| `BACHS_SECRET_KEY`, `BACHS_WEBHOOK_SECRET` | Buying NIM (`sk_sandbox_` keys use the Bachs sandbox) |
| `ADMIN_TOKEN` | Script access to the admin API (at least 32 characters, e.g. from `openssl rand -hex 32`) |

### 3. Set up the database

```bash
cd server && npx prisma migrate deploy
```

### 4. Run it

Start the backend (port 3101, which is where the frontend looks for it by default):

```bash
npm run dev:server
```

Start the frontend, reachable from your phone:

```bash
npm run dev -- --host
```

In Nimiq Pay, open **Mini Apps** and enter `http://<your-computer's-LAN-IP>:5173` in the Custom URL field.

### 5. Open the admin dashboard

Create an operator login. It uses `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters) and `ADMIN_NAME` from `server/.env`. If `ADMIN_PASSWORD` is empty, a password is generated and printed once. Running it again for the same email resets that password and signs out the account's open sessions.

```bash
npm --prefix server run admin:seed
```

Then sign in at [http://localhost:5173/admin](http://localhost:5173/admin).

### Production notes

- Set `VITE_API_URL` (frontend) to your backend URL. Set `VITE_MINIAPP_URL` / `MINIAPP_URL` to your public domain alone, for example `khalkospay.vercel.app` rather than a `nimpay.app/miniapps/open/...` link, so gift links open inside Nimiq Pay.
- The admin dashboard is at `https://<your-frontend>/admin`. `vercel.json` sends every page path to the app, so `/admin` and gift links load when opened directly. To create a login on the production database, run the seed with `DATABASE_URL` pointing at it: `npm --prefix server run admin:seed -- --allow-remote`.
- Set a fixed `AUTH_SECRET` on the backend so wallet sign-ins survive redeploys.
- When you move to `NIMIQ_NETWORK=mainnet`, set `NIMIQ_RPC_URL` to a mainnet node, or remove it so the mainnet default (`https://rpc.nimiqwatch.com`) applies. If the node is on a different network, the server logs a WRONG NETWORK error at startup and stops all treasury reads, sales and payouts.
- In the Paystack dashboard, set the webhook URL to `https://<your-backend>/api/webhooks/paystack` and turn off transfer OTP so payouts run automatically.
- In the Bachs dashboard, add a webhook endpoint at `https://<your-backend>/api/webhooks/bachs` for `collection.succeeded`, `collection.underpaid`, `checkout.completed` and `checkout.expired`, and put its signing secret in `BACHS_WEBHOOK_SECRET`. Keep enough NIM in the treasury for purchases; `ONRAMP_RESERVE_NIM` holds some back.
- Run `npx prisma migrate deploy` on each deploy.

## Project structure

```
src/                 Frontend (React mini app)
  pages/             Buy NIM, cash out, voice call, gift cards, BiteBuddy
  pages/admin/       Admin dashboard (its own bundle, served at /admin)
  components/        Shared UI, pet artwork, account switcher
  lib/               Wallet, API client, buying, gifts, pets, sign-in session, admin API client
server/
  prisma/            Database schema and migrations
  src/routes/        HTTP API (on-ramp, off-ramp, gift cards, BiteBuddy, auth, admin, webhooks)
  src/services/      Business logic: on-chain verification, payouts, Bachs, Paystack, pricing, emails, admin sign-in and stats
  src/scripts/       Treasury key generator, admin login seed
  src/voice/         Voice-call agent bridge (Deepgram + Claude)
```

## Status and what's next

- **Live on Nimiq testnet** today. Moving to mainnet means a fresh treasury key and switching the network setting.
- **Planned next:** a treasury withdrawal tool, wallet sign-in for BiteBuddy actions, and push notifications for meal reminders once Nimiq Pay supports them for mini apps.
