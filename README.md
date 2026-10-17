# scrow — native-SOL escrow PayBox plugin

- `anchor/` — the `scrow` Anchor program (program ID `28t38U7muxeGwWkigpJVaha8nHddnfZdnCYBBfb9RVE1`).
- `plugin/` — the PayBox plugin (`create_escrow`, `release_escrow`, `refund_escrow`). Each tool returns an
  unsigned Solana transaction proposal; PayBox handles wallet selection, approval, signing and submission.

## Deploy the program (mainnet)

PayBox only simulates `solana:mainnet` proposals, so the program must be on mainnet before hosted validation.

```bash
cd anchor
anchor build
solana program deploy target/deploy/scrow.so \
  --program-id target/deploy/scrow-keypair.json -u mainnet-beta   # ~1.1 SOL rent + fees
```

`anchor/target/deploy/scrow-keypair.json` is gitignored — back it up. It is the only way to deploy at the
declared program ID. If you deploy at a different ID, set the `SCROW_PROGRAM_ID` environment variable in the
portal (no rebuild needed).

## Build and check the plugin

Node.js 24 and pnpm 11.11.0:

```bash
cd plugin
pnpm install --frozen-lockfile
pnpm test                # type-check, deterministic build x2, MCP conformance
```

Upload `plugin/dist/plugin.mjs` in the developer portal.

Optional localnet end-to-end test (signs and sends the plugin's transactions against the real program):

```bash
solana-test-validator --reset --bpf-program 28t38U7muxeGwWkigpJVaha8nHddnfZdnCYBBfb9RVE1 anchor/target/deploy/scrow.so
cd plugin && pnpm exec tsx test/e2e-localnet.ts
```

## Portal configuration

- Network hosts: none (transactions are built offline; PayBox supplies the blockhash).
- Secrets: none.
- Environment variable (optional): `SCROW_PROGRAM_ID` — only if the program was deployed at a different ID.
