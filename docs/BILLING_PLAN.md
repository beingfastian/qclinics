# Plan: Billing, receipts, cash close and doctor payouts

Status: **MVP built** on branch `feature/billing-mvp` (2026-10-21). Written 2026-10-18 and updated with answers from hospital visits (section 0).

## What the MVP includes

- **Logins:** the owner (the existing admin login) and **one shared reception login** (`RECEPTION_EMAIL` / `RECEPTION_PASSWORD`). Reception picks the counter and their name once per computer, and receipts record that name. Individual staff logins are later.
- **Collect at the token:** after "Give token" or "Check in", a Collect dialog (cash or bank transfer, optional discount naming the doctor who allowed it). Token and receipt print on one slip. "Collect later" puts the patient on the Billing page's *To collect* list.
- **Lab charges:** due as soon as the doctor requests tests (no "sample collected" click). Reception collects them; the lab list shows Paid / Not paid.
- **Refunds:** owner only, with a reason. Payments are never edited or deleted.
- **Close counter:** per counter, any number of times a day; a difference needs a note; the owner verifies.
- **Money page (owner):** totals, per counter, per person, per doctor with hospital/doctor share (what's owed to each doctor), discounts, refunds, unpaid, receipt-number gaps, and the counters/names setup.
- **Off switch:** `BILLING_ENABLED=false` hides it all; the queue works exactly as before.
- **Not in the MVP:** recording doctor payouts, individual logins, switching the existing profit report to collected amounts.
- **Checks:** `backend/scripts/checkBilling.mjs` (part of `npm run check:integration`).

The sections below are the original plan; where they differ from the list above, the list above is what was built.

## Why

Owners buy OPD software mainly to control money. Today Qlinic records each visit's fee, discount and hospital/doctor share, but it never records whether the money was actually collected, by whom, or how. The lab model even says "payment is handled at the counter". So the owner still can't answer: *"How much cash came in today, who collected it, does the drawer match, and what do we owe each doctor?"*

This plan adds that, building on what already exists:

- `appointment.amount`, `discountPercent`, `finalFee` and the frozen `share` split
- the walk-in token flow, which already asks reception for the fee (`queueService.issueToken`)
- `labTest.price` in the test catalogue
- the 80 mm thermal slip (`PrintSlip`)

## 0. How hospitals work (answers from visits)

| Question | Answer | What it means for the design |
|---|---|---|
| When is the fee paid? | When the patient's details are entered at reception | Collect at token issue (walk-in) and at check-in (booked patient). Not after the visit. |
| Payment methods | Mostly cash; occasionally a bank transfer through a banking app | Only **Cash** and **Bank transfer** (with an optional transaction reference). No card, JazzCash or EasyPaisa buttons for now. |
| Who allows discounts? | The doctor | A discount records **which doctor allowed it**. There's no fixed percentage limit. |
| Doctor payouts | Varies: some hospitals pay daily, some weekly, some monthly | Payout frequency is a **per-hospital setting**. Payouts are recorded, and cash payouts come out of a drawer. |
| Shifts | Not answered | A cash close can be done any number of times a day. Each close covers everything since the previous one, which suits one close a day or one per shift. |
| Lab payment | Doctor sends the test request → patient gives samples → then pays **at reception** | New **"Sample collected"** step in the lab portal. The charges then show as due at reception, which collects them. Lab staff never handle money. |
| Cash drawers | Varies: one, two or more | Each **counter is a drawer**. A hospital sets up as many counters as it has drawers. The cash close is per counter. |

Still open: see section 8.

## Where the data is stored

**All billing records go in the MongoDB database on the server, not in the browser's localStorage.**

The browser's localStorage won't work for money records:

- It lives on one computer only. The owner at home, a second counter and the doctor would each see different numbers.
- It is lost when the browser is cleared, the PC is reinstalled, or someone uses a private window.
- Anyone at the counter can edit or delete it from the browser's developer tools. That's exactly the leak the owner is paying to stop.
- It can't be backed up or used in reports.

localStorage is still useful for **per-computer conveniences**, wrapped in try/catch so the app works without it:

- which counter (drawer) this PC is, e.g. "Counter 1". The receptionist picks it once per PC.
- whether to auto-print the receipt
- an unsaved cash-count form, so a refresh doesn't lose the counted notes

## 1. Staff accounts and counters (needed first)

Today there's one admin login from `ADMIN_EMAIL`, shared by every receptionist. Cash can't be tied to a person that way.

- Add **reception staff accounts**, reusing the pattern of `labStaff` (name, email, password, active). Option: generalise `labStaff` into one `staff` model with a `role` of `reception` or `lab`.
- Reception staff can use the queue, appointments, patients and billing. They **can't** see profit reports, change doctor shares, refund above a limit, or edit closed periods.
- The env admin stays as the **owner** account with full access.
- Lab staff keep their own logins but get no billing access. They only mark samples collected and see whether an order is paid.
- **Counters:** the owner adds counters (Counter 1, Counter 2, …), all at reception. A hospital with one drawer has one counter. Every payment and payout records the counter it went through.

## 2. Data model

### `payment`, one per receipt

| Field | Notes |
|---|---|
| `receiptNo` | Sequential per day, e.g. `181026-0042`. Gaps in the sequence are visible to the owner. |
| `kind` | `consultation` or `lab` |
| `appointmentId` / `labOrderId` | What was paid for |
| `patient` | Id, name and phone (copied, like `userData` on appointments) |
| `doctorId`, `doctorName` | For doctor-wise reports and payouts |
| `items` | `[{ label, amount }]`, e.g. each lab test |
| `gross`, `discount`, `net` | Discount in rupees and percent |
| `discountAllowedBy` | The doctor who allowed the discount (required when there's a discount) |
| `discountReason` | Optional, e.g. "staff family", "poor patient" |
| `method` | `cash` or `bank_transfer` |
| `reference` | Transaction id for bank transfers (optional but encouraged) |
| `collectedBy` | `{ id, name, role }` |
| `counterId` | The drawer it went into |
| `collectedAt` | Server time |
| `status` | `paid`, `partly_refunded` or `refunded` |
| `refunds` | `[{ amount, reason, by, at, counterId }]` |
| `closeId` | Set when the counter is closed; locks the payment |

**Rules:**

- A payment is never edited or deleted. A mistake is fixed by a refund (with a reason) and a new receipt.
- A refund always needs a reason. Refunds above a limit (setting, e.g. Rs 1,000) need the owner.
- A discount always names the doctor who allowed it. The owner sees every discount per doctor.

### `doctorPayout`, one per payment to a doctor

| Field | Notes |
|---|---|
| `doctorId`, `doctorName` | |
| `periodFrom`, `periodTo` | Visits covered, e.g. one day, one week or one month |
| `owed` | Doctor's share of **collected** consultation fees in the period (minus refunds) |
| `paid` | Amount actually paid; can be less than `owed` (the rest carries forward) |
| `method` | `cash` (out of a counter's drawer) or `bank_transfer` |
| `counterId` | For cash payouts: the drawer the cash left from |
| `paidBy`, `paidAt` | |
| `note` | |

The hospital's setting **Doctor payouts: daily / weekly / monthly** decides when a doctor shows as "due" on the owner's screen. Paying is always a deliberate action by the owner or an allowed staff member. Nothing is paid automatically.

### `cashClose`, one per counter each time it's closed

| Field | Notes |
|---|---|
| `counterId`, `closedBy`, `from`, `to` | `from` is the previous close of this counter |
| `expected` | Calculated by the server: cash payments − cash refunds − cash doctor payouts, through this counter. Bank transfers are listed separately and aren't counted in the drawer. |
| `countedCash` | What was counted in the drawer, optionally as a note count (5000 × 3, 1000 × 7, …) |
| `difference` | `countedCash − expected` |
| `note` | Required when there's a difference |
| `verifiedBy`, `verifiedAt` | The owner confirms they received the cash |

After a close, the payments, refunds and payouts it covers are locked.

### Two receptionists at the same time

Several people will collect money at once, often for the same doctor. Like slot booking and "call next" today, these rules are enforced by the database, not by the screen:

- **One payment per visit or lab order.** A unique index on `appointmentId` (and `labOrderId`) for active payments. If two receptionists press "Collect" for the same patient, the second gets "Already paid: receipt 181026-0042 by Ayesha" and nothing is charged twice.
- **No double receipts from a double-click or a slow connection.** Each Collect sends a one-time request id. A repeat with the same id returns the first receipt.
- **Receipt numbers never repeat.** They come from an atomic daily counter (`$inc`), the same way queue token numbers do.
- **Shared or separate drawers.** Two receptionists on one drawer use the same counter. Each with their own drawer uses their own counter. Payments always record who collected them as well.
- **Closing while someone is still collecting.** A close covers payments up to the moment it's saved. Later payments go to the next close, so nothing is lost or counted twice.

## 3. Flows

**Walk-in (most patients):**

1. Reception enters the patient's details and the fee on the token screen (as today).
2. If the doctor allowed a discount: pick **"Discount allowed by Dr …"** and the amount.
3. **Collect:** Cash (default) or Bank transfer (+ reference).
4. One print: **token slip and receipt on the same 80 mm slip** (receipt no., fee, discount, method, collected by).
5. A "Collect later" option exists for exceptions. It shows on the unpaid list.

**Booked patient:** the same collect step happens at check-in, when reception confirms their details.

**Lab tests:**

1. The doctor orders tests from the doctor portal; the request appears in the lab portal (as today).
2. The lab marks **"Sample collected"**. This is a new step, before report upload.
3. The patient goes to reception. The charges (catalogue prices) appear on a **"Lab charges due"** list at reception, also searchable by patient name or phone. Reception collects them like a consultation fee.
4. The receipt lists each test. The lab worklist shows **Paid / Not paid** next to each order, updated live.
5. Report upload and doctor review continue as today. Whether a report can be released while unpaid is a hospital setting (default: no).

**Refund:** from the receipt, with amount and reason. Prints a refund slip and shows on the owner's report.

**Paying a doctor:**

1. The owner's screen shows each doctor's amount due for the period (daily, weekly or monthly, per the setting).
2. The owner (or allowed staff) records the payout, either cash from a counter or bank transfer.
3. A payout slip prints for the doctor to sign.

**Closing a counter (end of shift or day):**

1. Staff opens **Close counter** and sees what the drawer should hold: cash in, minus refunds and doctor payouts.
2. They count the cash (optional note-count form) and save. Any difference needs a note.
3. The owner sees it straight away and marks it verified.

## 4. Owner's "Money today" screen

One screen, readable on a phone:

- **Collected today**: total, cash vs bank transfer
- **By counter**: collected, refunds, payouts, closed or not, difference
- **By staff member**: collected, refunds
- **By doctor**: visits, collected, discounts they allowed, hospital share, doctor share, **due to doctor / paid**
- **Discounts**: total, by doctor who allowed them
- **Refunds**: list with reasons
- **Unpaid**: visits marked "collect later" and lab orders with samples taken but not paid
- **Receipt number gaps**, if any

Plus a date picker, and the same view for a week or month. The existing profit report should switch to collected amounts, with "billed but not collected" shown separately.

## 5. Settings per hospital

| Setting | Default |
|---|---|
| Counters (drawers) | One: "Reception" |
| Doctor payout frequency | Monthly |
| Who carries a discount (see section 8) | Shared in proportion, as today |
| Refund limit without owner | Rs 1,000 |
| Lab report released before payment | No |

## 6. Build order and rough size

| Step | What | Size |
|---|---|---|
| 1 | Reception staff accounts, role checks, counters | 2 days |
| 2 | `payment` model, collect at walk-in and check-in, discount by doctor, combined token + receipt print | 2–3 days |
| 3 | Lab "Sample collected" step, lab charges, Paid / Not paid | 2 days |
| 4 | Refunds | 1 day |
| 5 | Cash close per counter and owner verification | 1–2 days |
| 6 | Doctor payouts (due amounts, payout record, slip) | 2 days |
| 7 | Owner's "Money today" screen and profit report on collected amounts | 2 days |

About **2.5–3 weeks** in total. Steps 1, 2 and 5 together (about a week) are already a strong owner demo and could ship first.

## 7. Not included

- Online payment gateways, card machines, JazzCash or EasyPaisa integration
- Invoices for insurance or panel companies (corporate billing)
- Pharmacy sales
- Tax invoices or any FBR integration. Check whether any target hospital needs this before promising it.

## 8. Still to decide

1. **Who carries a doctor-allowed discount?** Today a discount reduces both the hospital's and the doctor's share in proportion. If the doctor allowed it, some hospitals may expect it to come only out of the **doctor's** share. Ask: "If the doctor gives Rs 500 off, does the hospital lose part of its share too?" This becomes a setting.
2. **Shifts:** does a hospital close its counter once a day or per shift (morning and evening)? The design handles both, but it changes the default screen.
3. **Doctor payout slip:** does the doctor need to sign a printed slip, or is a record in the system enough?
