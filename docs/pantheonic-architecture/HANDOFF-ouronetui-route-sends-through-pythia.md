# Handoff — OuronetUI: route SENDS (and POLLS) through Pythia, not just reads

**Audience:** the OuronetUI agent (the OuronetUI / OuronetDev repo).
**Where to work:** the dev branch — testable on localhost AND the dev link.
**Companion:** `HANDOFF-ouronetui-daimon-migration.md` (the full daimon migration). This is a
**targeted fix** to one gap in that wiring: writes bypass Pythia.

---

## 0 · Symptom

Transactions fired from OuronetUI's console (localhost) do **not** increment Pythia's transaction
count, even though the Pythia connection is "wired in" and reads work.

## 1 · Diagnosis — confirmed against the live Pythia fleet ledger

`GET https://pythia.ancientholdings.eu/pyth` (Pythia's public Pyth-economy odometer) at the time of
writing:

```json
{ "total": { "petitions": 54, "transactions": 0, "failedTransactions": 0, ... },
  "daily": [ { "day": "2026-08-05", "petitions": 54, "transactions": 0, "failedTransactions": 0 } ] }
```

- **`petitions = 54` today** → OuronetUI's **reads reach Pythia and count**. The read lane is wired
  correctly.
- **`transactions = 0` AND `failedTransactions = 0`** → **Pythia never received a single send.** If a
  signed tx had been relayed through Pythia we would see `transactions++` (once it mines),
  `failedTransactions++` (on relay-reject / never-mined timeout), or at minimum a pending entry that
  becomes one of those. All send counters are flat zero.
- The only lifetime transaction (`1`, gas 1017, on 08-04) is **Pythia's own automaton A_Link fire**,
  not OuronetUI.

**Root cause:** OuronetUI submits its signed transactions **directly to a chainweb node**, bypassing
Pythia's `POST /stoachain/send`. Being "connected" only proved the READ path routes through Pythia; the
SEND (and POLL) path is a separate call and is still pointed at the node.

**Pythia side is correct** — the meter is wired app-wide, `/stoachain/send` relays and counts via the
`txTracker`, and the 54 petitions prove the pipe works. No Pythia change is needed.

---

## 2 · The fix — route ALL on-chain writes through Pythia, using the connection you already have

You already hold a `PythiaClient` (or equivalent) with a base URL + the `x-pythia-key` `keyProvider`
(that's why reads count). Use that **same instance** for writes:

| Operation | Call | Endpoint |
|---|---|---|
| Submit a signed tx | `client.send({ chainId, cmds })` | `POST /stoachain/send` |
| Poll tx status | `client.poll({ chainId, requestKeys })` | `POST /stoachain/poll` |

Replace **every** direct-to-node `/send` and `/poll` (a `kadena-client` submit, a Pact send helper, a
raw `fetch` to `<node>/chainweb/0.0/<net>/chain/<c>/pact/api/v1/send`) with these two calls.

**Contract of `/stoachain/send`:** body `{ chainId?=0, cmds }`, where `cmds` is the caller-**SIGNED**
chainweb send array (`{ cmds: [{ hash, sigs, cmd }] }`). Pythia relays it **VERBATIM** to the node and
returns the node response **VERBATIM** — you get the `requestKeys` back exactly as from a node. **You
keep signing locally in the Codex; Pythia signs nothing** — she only relays and meters.

**Keying:** the `x-pythia-key` rides automatically on send/poll via the same `keyProvider` your reads
use, so your writes are attributed to OuronetUI at the hub too. Note the two distinct effects:
- **Routing through `/stoachain/send`** is what makes the transaction **COUNT** in the ledger.
- **The key** is what makes it **EARN** at the hub (keyed attribution).
Do both.

---

## 3 · Rule (Pantheonic architecture)

`organs/06-pythia-client-wire-in.md` §6: a **daimon routes ALL blockchain traffic through Pythia** —
reads, sends, AND polls. OuronetUI did reads; it must also do sends + polls. **No direct-to-node
submit path may remain**, except the admin-only break-glass fallback from the migration handoff (which
is off by default and admin-gated).

---

## 4 · Error to handle

If Pythia replies `503 { "code": "pythia_no_tx_sender" }`, Pythia has **no Upload-Pool (tx-sender)
node** configured to relay writes. That is an **operator action on the Pythia admin side** (Hub-feed
panel) — not a bug in OuronetUI's wiring. Surface it clearly ("Pythia has no tx relay node
configured") rather than silently failing or falling back to a direct node.

---

## 5 · Verify (do this after wiring)

1. Fire a tx from the console. Confirm the response `requestKey` came back **through Pythia** (same
   base URL as your reads), not from a node URL.
2. `GET https://pythia.ancientholdings.eu/pyth` and watch `total.transactions`. Give the `txTracker` a
   few seconds to poll the mine: a mined tx → `transactions++`; a rejected / never-mined tx →
   `failedTransactions++`. **Either way the number MOVES** — that proves the send reached Pythia.
3. If `transactions` AND `failedTransactions` both stay `0` after firing, the send still isn't hitting
   `/stoachain/send` — recheck that you swapped the **submit** call, not just the read call.

---

## 6 · Scope

Purely re-pointing the write/poll calls at the `PythiaClient` you already have — reads already work.
Dev branch, localhost + dev link. **Report the `/pyth` transaction delta you observe after a test
fire.** Don't merge to prod; the operator decides go-live.
