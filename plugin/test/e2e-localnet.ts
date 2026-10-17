// End-to-end check against a local validator running the scrow program.
// Usage (from plugin/): pnpm exec tsx test/e2e-localnet.ts
// Requires: solana-test-validator --reset --bpf-program <program id> ../anchor/target/deploy/scrow.so
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";

import { buildCreateEscrow, buildRefund, buildRelease, programId } from "../src/escrow.js";

const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const program = programId();

async function send(transactionBase64: string, signer: Keypair) {
  const tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash; // PayBox does this step in production.
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize());
  const status = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });
  if (status.value.err) throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
  return signature;
}

async function expectFailure(label: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.log(`ok   ${label} rejected (${String(error).slice(0, 80)}...)`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function check(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`ok   ${label}`);
}

const buyer = Keypair.generate();
const seller = Keypair.generate(); // Unfunded: verifies the 0.001 SOL minimum keeps it rent-exempt.
const airdrop = await connection.requestAirdrop(buyer.publicKey, 2 * LAMPORTS_PER_SOL);
await connection.confirmTransaction(airdrop, "confirmed");

const now = BigInt(Math.floor(Date.now() / 1000));
const amount = 1_000_000n;

// 1. Create + release.
const created = buildCreateEscrow({ program, buyer: buyer.publicKey, seller: seller.publicKey, escrowId: 1n, lamports: amount, refundAfter: now + 3600n });
await send(created.transactionBase64, buyer);
const escrowInfo = await connection.getAccountInfo(created.escrow);
check(escrowInfo?.owner.equals(program) === true, "create_escrow funded a program-owned escrow account");

await expectFailure("refund before deadline", () => send(buildRefund({ program, buyer: buyer.publicKey, escrowId: 1n }).transactionBase64, buyer));
const stranger = Keypair.generate();
await expectFailure("release with wrong seller", () => send(buildRelease({ program, buyer: buyer.publicKey, seller: stranger.publicKey, escrowId: 1n }).transactionBase64, buyer));

await send(buildRelease({ program, buyer: buyer.publicKey, seller: seller.publicKey, escrowId: 1n }).transactionBase64, buyer);
check((await connection.getBalance(seller.publicKey)) === Number(amount), "release_escrow paid the seller exactly the escrowed amount");
check((await connection.getAccountInfo(created.escrow)) === null, "release_escrow closed the escrow account");

// 2. Create + refund after a short deadline.
const short = buildCreateEscrow({ program, buyer: buyer.publicKey, seller: seller.publicKey, escrowId: 2n, lamports: amount, refundAfter: BigInt(Math.floor(Date.now() / 1000)) + 3n });
await send(short.transactionBase64, buyer);
await new Promise((resolve) => setTimeout(resolve, 6000));
const before = await connection.getBalance(buyer.publicKey);
await send(buildRefund({ program, buyer: buyer.publicKey, escrowId: 2n }).transactionBase64, buyer);
const after = await connection.getBalance(buyer.publicKey);
check(after > before + Number(amount) - 10_000, "refund_escrow returned the locked SOL after the deadline");
check((await connection.getAccountInfo(short.escrow)) === null, "refund_escrow closed the escrow account");

console.log("e2e passed");
