# ZK API Credits — Build Plan

Private, anonymous API access using zero-knowledge proofs, ETH staking, and Venice LLM routing.
Inspired by [Vitalik + Davide Crapis — ZK API Usage Credits: LLMs and Beyond](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104)

## Concept

Users stake ETH to receive a set of anonymous API credits. Each credit is a cryptographic nullifier — usable exactly once to make an API call. Zero-knowledge proofs let the server verify a credit is valid and unspent without ever learning who owns it. Requests are routed through [Venice](https://venice.ai) for private LLM inference.

Privacy chain:

```
wallet → commitment (link broken here) → nullifier_hash (one-time burn) → Venice
```

No one — not the server, not Venice, not the chain — can link an API call back to the wallet that staked.

## Stack

| Layer | Tech |
|-------|------|
| ZK Circuit | [Noir](https://noir-lang.org/) v1.0.0-beta.3 |
| Proof backend | [Barretenberg](https://github.com/AztecProtocol/aztec-packages) (bb) v0.82.2 — UltraHonk |
| Merkle tree | [@zk-kit/lean-imt.sol](https://github.com/privacy-scaling-explorations/zk-kit.solidity) |
| Smart contract | Solidity ≥0.8.0, Foundry |
| Scaffold | [Scaffold-ETH 2](https://scaffoldeth.io/) |
| API server | Express.js + Barretenberg verifier (WASM) |
| LLM routing | [Venice API](https://venice.ai/api) |
| Frontend | Next.js (SE2 default) + Barretenberg browser WASM for proof generation |

Reference: [SE2 ZK Voting Challenge](https://github.com/scaffold-eth/se-2-challenges/tree/challenge-zk-voting) — circuit and contract pattern maps almost 1:1.

## Economic Model

### The Core Guarantee: ETH Moves at register(), Not at Call Time

- `stake()` → ETH sits in stakedBalance ← user CAN still withdraw
- `register()` → ETH moves to serverClaimable ← user CANNOT touch this ever again
- `api_call()` → burns nullifier ← no ETH movement at all

To make an API call, a user MUST have a registered commitment in the Merkle tree. Registering moves ETH to serverClaimable. Atomic — you cannot get a valid nullifier without paying for it first.

### What Users Can and Cannot Do

| Action | Allowed? | Notes |
|--------|----------|-------|
| Withdraw unregistered stake | ✅ Yes | Haven't used or reserved any credits yet |
| Withdraw registered credit ETH | ❌ No | Moved to serverClaimable at register() time |
| Use a credit without registering | ❌ No | No Merkle proof = no valid ZK proof = server rejects |
| Double-spend a credit | ❌ No | Nullifier hash tracked in server DB, rejected on reuse |

### Pricing

`PRICE_PER_CREDIT` = set to cover Venice cost per call + margin. Prepaid model — like loading a gift card. No billing surprises, no post-payment risk.

## How It Works (Full Flow)

### 1. Setup (client-side, never leaves browser)

```
nullifier = random field element
secret = random field element
commitment = poseidon2(nullifier, secret)
```

### 2. Staking + Registration (on-chain)

```
user.stake(ethAmount)
 → ETH added to stakedBalance[user]
 → user can still withdraw at this point

user.register(commitment) — called once per credit desired
 → PRICE_PER_CREDIT moves from stakedBalance[user] to serverClaimable
 → commitment inserted into LeanIMT Merkle tree
 → contract emits NewLeaf(index, commitment)
 → ETH is now permanently locked for the server
```

Extra privacy: Users can register commitments from a fresh wallet (funded via mixer). The commitment is unlinkable to future API calls by design — ZK proof breaks that link.

### 3. Making an API Call (off-chain ZK)

Client generates ZK proof in browser via Barretenberg WASM (~1–3 seconds), sends:

```json
POST /v1/chat
{
  "proof": "<ultraHonk proof bytes>",
  "nullifier_hash": "0x...",
  "root": "0x...",
  "depth": 16,
  "messages": [{ "role": "user", "content": "..." }],
  "model": "llama-3.3-70b"
}
```

No wallet address. No API key. No identity.

### 4. Server Verification (off-chain, free)

1. Verify proof against UltraHonk verifier (bb WASM, no gas)
2. Check nullifier_hash NOT in spent_nullifiers DB
3. Check root matches a known valid root (or latest on-chain root)
4. Mark nullifier_hash as spent (BEFORE Venice call — prevent race conditions)
5. Forward `{ messages, model }` to Venice API
6. Stream response back to client

### 5. Venice Routing (private inference)

Server hits Venice with its own API key. Venice sees: server IP + prompt. Nothing else.

## Noir Circuit

```nr
use std::hash::poseidon2::Poseidon2;
use binary_merkle_root::binary_merkle_root;

fn main(
    // public inputs (visible to verifier/chain)
    nullifier_hash: pub Field,
    root: pub Field,
    depth: pub u32,

    // private inputs (never leave client)
    nullifier: Field,
    secret: Field,
    index: Field,
    siblings: [Field; 16],
) {
    // 1. Verify commitment = poseidon2(nullifier, secret)
    let commitment = Poseidon2::hash([nullifier, secret], 2);

    // 2. Verify commitment is in the Merkle tree
    let computed_root = binary_merkle_root(commitment, depth, index, siblings);
    assert(computed_root == root);

    // 3. Verify nullifier_hash = poseidon2(nullifier)
    let computed_nullifier_hash = Poseidon2::hash([nullifier], 1);
    assert(computed_nullifier_hash == nullifier_hash);
}
```

Why separate nullifier and commitment?
- `commitment` goes on-chain (links to Merkle tree slot)
- `nullifier_hash` is burned when the credit is spent
- They are **unlinkable**: you cannot compute one from the other without knowing `secret`, which never leaves the client

## Project Structure

```
zk-api-credits/
├── packages/
│   ├── circuits/          ← Noir ZK circuit (Nargo.toml + src/main.nr)
│   ├── foundry/           ← Solidity contracts
│   │   └── contracts/
│   │       ├── APICredits.sol
│   │       └── Verifier.sol    ← auto-generated by bb
│   ├── api-server/        ← Express server (proof verification + Venice proxy)
│   │   └── src/index.ts
│   └── nextjs/            ← SE2 frontend
│       └── app/
│           ├── stake/page.tsx
│           └── chat/page.tsx
└── package.json
```

## Build Steps

```bash
# 1. Install Noir toolchain
noirup -v 1.0.0-beta.3
mkdir -p ~/.bb && curl -L https://github.com/AztecProtocol/aztec-packages/releases/download/v0.82.2/barretenberg-arm64-darwin.tar.gz | tar -xzC ~/.bb
export PATH="$HOME/.bb:$PATH"

# 2. Scaffold from ZK voting challenge (closest existing template)
npx create-eth@latest -e scaffold-eth/se-2-challenges:challenge-zk-voting zk-api-credits
cd zk-api-credits

# 3. Compile circuit + generate Solidity verifier
cd packages/circuits
nargo compile
bb write_vk -b ./target/circuits.json -o ./target/vk
bb contract -k ./target/vk -o ../foundry/contracts/Verifier.sol

# 4. Deploy contracts
cd ../foundry
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# 5. Run API server
cd ../api-server
VENICE_API_KEY=xxx node src/index.ts

# 6. Run frontend
cd ../nextjs
yarn dev
```

## Open TODOs

- [ ] Batch registration: `register(commitment[])` to save gas when buying many credits at once
- [ ] Root freshness: Server should accept proofs against any root from the last N blocks
- [ ] Relayer for registration: Let users register without revealing wallet (full anonymity from day 0)
- [ ] On-chain nullifier option: `burnNullifier(proof, nullifier_hash)` for fully trustless enforcement
- [ ] Credit tiers: Different `PRICE_PER_CREDIT` for different model tiers (cheap Llama vs expensive GPT-4 class)
- [ ] Token metering: Instead of fixed credits, price by estimated tokens (burn multiple nullifiers for large requests)
- [ ] Rate limiting: Max N credits redeemable per hour regardless of proof validity (DoS protection)
- [ ] Mobile proof gen: Barretenberg WASM is ~1–3s — consider a trusted proof-as-a-service fallback

## Privacy Model Summary

| What's public | What's private |
|---------------|----------------|
| Commitment in Merkle tree | nullifier, secret |
| nullifier_hash (when burned) | which commitment maps to which nullifier_hash |
| ETH stake amount + wallet | prompts, responses |
| Merkle root | who made which API call |

Venice sees: server IP + prompt. Venice doesn't see: user wallet or identity.

**Threat model:** An attacker who controls both the staking contract AND the API server still cannot link API calls to wallets. The link is broken by the ZK proof — mapping from commitment → nullifier_hash requires knowledge of `secret`, which never leaves the client.

## Settlement Summary (TL;DR)

- Users **cannot** use credits and then withdraw the ETH — those are two separate pools
- `stakedBalance` = unregistered ETH, fully withdrawable by user
- `serverClaimable` = registered credit ETH, permanently locked for server
- ETH moves from `stakedBalance` → `serverClaimable` at `register()` time
- API calls happen after registration — the ETH is already yours before a single Venice call is made
- No slashing needed. No post-payment risk. Prepaid by design.
