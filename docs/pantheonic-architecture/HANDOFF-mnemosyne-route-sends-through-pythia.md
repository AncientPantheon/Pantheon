# Handoff — Mnemosyne: are your on-chain TRANSACTIONS metered through Pythia? (verify + fix)

**Audience:** the Mnemosyne agent (`automatons/Mnemosyne`).
**Where to work:** the dev branch — testable locally AND on the dev link.
**Sibling:** `HANDOFF-ouronetui-route-sends-through-pythia.md` — same root issue (writes bypassing
Pythia), same fix. Read it; this one is tailored to Mnemosyne's website + loaded-Codex transactions.

---

## 0 · The question I need answered

When a user operates on Mnemosyne's website — **loading a Codex and doing transactions on that loaded
Codex** (handling stuff, and specifically **registering two Apollo halves via the loaded Codex**) — are
those transactions **routed through Pythia's `/stoachain/send`** so they're **metered in Pythia's Pyth
ledger**? Or do they submit **directly to a chainweb node**, bypassing the meter?

I need this checked and, if it's bypassing, fixed — because I'm about to add two Apollo halves and
register them through the Codex loaded in Mnemosyne, and I want that on-chain activity metered by Pythia
like everything else.

---

## 1 · Why this matters (the rule)

**Pythia is the Pantheon's on-chain meter** (`organs/06-pythia-client-wire-in.md` §6): *every* entity's
on-chain traffic must flow through her — reads, sends, and polls. A transaction is counted **only if it
is relayed through Pythia's `POST /stoachain/send`**. Anything a Codex signs and submits **straight to a
node never reaches the meter** and is invisible to Pythia's ledger.

Mnemosyne already has a Pythia connection (its `DualLinkConnector` loop in `lib/pythia/connectorLoop.ts`
mints the `x-pythia-key`), and its **reads** likely already route through Pythia. But **being connected
and routing reads does NOT mean the SEND/submit path routes through Pythia** — that's a separate call.
This is exactly the miswire we just found in OuronetUI: reads counted, sends went direct-to-node, so
`transactions` stayed at 0.

---

## 2 · What to check — TWO transaction paths in Mnemosyne

1. **Website / loaded-Codex transactions (the one I care about most).** When a user loads a Codex on the
   site and fires a transaction (e.g. **registering an Apollo half**), where does the SIGNED command
   go? Trace the submit call. If it POSTs to a chainweb node's `.../pact/api/v1/send` (or a
   `kadena-client`/SDK submit that targets a node URL), it **bypasses Pythia** — that's the bug.
2. **Mnemosyne's own automaton fires (Khronoton).** If Mnemosyne runs its embedded Khronoton, its
   scheduled fires also submit on-chain. Confirm those are metered too — for an automaton that means
   its Khronoton chain runtime's `submit` is pointed at Pythia's `/stoachain/send` (NOT direct-to-node).
   (This is the second path; the website path in #1 is the immediate concern.)

If either path submits directly to a node, it is a conformance bug per §6.

---

## 3 · The fix — route every SIGNED submit through Pythia, keyed

Use the SAME Pythia connection Mnemosyne already holds (the one minting the `x-pythia-key`) for writes,
not just reads:

| Operation | Call | Endpoint |
|---|---|---|
| Submit a signed tx | `client.send({ chainId, cmds })` | `POST /stoachain/send` |
| Poll tx status | `client.poll({ chainId, requestKeys })` | `POST /stoachain/poll` |

- **Contract of `/stoachain/send`:** body `{ chainId?=0, cmds }`, where `cmds` is the caller-**SIGNED**
  chainweb send array (`{ cmds: [{ hash, sigs, cmd }] }`). Pythia relays it **VERBATIM** to the node and
  returns the node response **VERBATIM** — you get the `requestKeys` back exactly as from a node.
  **Mnemosyne keeps signing locally with the loaded Codex; Pythia signs nothing** — she only relays and
  meters.
- **Keying:** attach the `x-pythia-key` (the same `keyProvider` your reads use) to send/poll so the
  transaction is **attributed to Mnemosyne** at Pythia. Two distinct effects:
  - **Routing through `/stoachain/send`** is what makes the tx **COUNT** in Pythia's ledger.
  - **The key** is what attributes it to `mnemosyne` (see §5 — Pythia is gaining per-consumer
    transaction attribution). Do both.
- Replace every direct-to-node submit on the website/loaded-Codex path (and, if applicable, point the
  Khronoton runtime's `submit` at Pythia). No unmetered direct-to-node submit path may remain.

**Error to handle:** if Pythia replies `503 { "code": "pythia_no_tx_sender" }`, Pythia has no
Upload-Pool (tx-sender) node configured to relay writes — an **operator action on the Pythia admin
side**, not a Mnemosyne bug. Surface it clearly rather than silently failing or falling back to a node.

---

## 4 · Verify (do this after wiring)

1. Load a Codex on the site and **register an Apollo half** (or fire any tx). Confirm the response
   `requestKey` came back **through Pythia** (Mnemosyne's Pythia base URL), not from a node URL.
2. `GET https://pythia.ancientholdings.eu/pyth` and watch `total.transactions`. Give the tracker a few
   seconds to poll the mine: a mined tx → `transactions++`; a rejected/never-mined tx →
   `failedTransactions++`. **Either way the number MOVES** — that proves the send reached Pythia.
3. If both stay `0` after firing, the submit still isn't hitting `/stoachain/send` — recheck that you
   swapped the **submit** call on the loaded-Codex path, not just the read call.

---

## 5 · Note — per-consumer transaction attribution is coming to Pythia

Pythia is adding a `byConsumer` breakdown to `/pyth` (per-consumer transaction tallies). Once it lands,
a Mnemosyne send keyed with its `x-pythia-key` will show up as `byConsumer["mnemosyne"]` — so keeping
your sends **keyed** (§3) is what makes Mnemosyne's transactions individually visible, not just folded
into the global total. Unkeyed sends fall to `"direct"`.

---

## 6 · Report back

Tell me, per path (website/loaded-Codex, and Khronoton fires if any): **is it already routed through
Pythia's `/stoachain/send`, or was it direct-to-node and you fixed it?** Include the `/pyth`
`transactions` delta you observed after registering a half. Dev branch, don't merge to prod — the
operator decides go-live.
