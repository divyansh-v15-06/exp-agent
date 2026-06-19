# BUGS.md — Terminal 3 SDK / docs friction log

Verified against the [official ADK docs](https://docs.terminal3.io/developers/adk/overview/what-is-adk). Only confirmed issues listed.

---

## #1 — `agent_pubkey` format undocumented; no SDK pubkey helper

`buildDelegationCredential({ agent_pubkey })` expects a `Uint8Array` but the
required encoding (33-byte compressed secp256k1) is nowhere in the docs. The SDK
exports `eth_get_address` (20-byte address) but no public-key helper — we had to
derive it via ethers `new SigningKey(pk).compressedPublicKey` and reverse-engineer
the `AGENT_PUBKEY_LEN === 33` constant.

**Proof:** `buildDelegationCredential` and `agent_pubkey` return zero results
across the entire [docs index](https://docs.terminal3.io/llms.txt). The
[Delegate Access](https://docs.terminal3.io/t3n/data-owner-guide/delegate-access)
page only covers the GUI dashboard flow. The
[Invoke Contract](https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract)
walkthrough uses `agentDid` (a DID string via `agent-auth-update`), which is a
different delegation model.

## #2 — No worked example for the delegate → invoke crypto flow

The SDK ships five delegation primitives (`buildDelegationCredential`,
`canonicaliseCredential`, `signCredential`, `buildInvocationPreimage`,
`signAgentInvocation`) but no end-to-end example tying "user signs credential →
agent signs invocation → contract submit". We assembled the flow from type defs
and captured it in `tools/step3-smoke.ts`.

**Proof:** None of the five functions appear in any page listed in the
[docs index](https://docs.terminal3.io/llms.txt). The
[walkthrough](https://docs.terminal3.io/developers/adk/get-started/walkthrough/invoke-contract)
covers `execute()` / `executeAndDecode()` but not the underlying crypto
primitives.
