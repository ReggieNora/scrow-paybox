import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

/** Program ID declared in anchor/programs/scrow/src/lib.rs. */
export const DEFAULT_PROGRAM_ID = "28t38U7muxeGwWkigpJVaha8nHddnfZdnCYBBfb9RVE1";

/** PayBox replaces the blockhash before simulation and signing. */
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

const U64_MAX = 2n ** 64n - 1n;
const I64_MAX = 2n ** 63n - 1n;

/** Anchor discriminators: first 8 bytes of sha256("global:<instruction name>"). */
const DISCRIMINATOR = {
  createEscrow: Uint8Array.from([253, 215, 165, 116, 36, 108, 68, 80]),
  release: Uint8Array.from([253, 249, 15, 206, 28, 127, 193, 241]),
  refund: Uint8Array.from([2, 96, 183, 251, 63, 208, 46, 46]),
} as const;

/** Escrow program ID, overridable with the non-sensitive SCROW_PROGRAM_ID variable. */
export function programId(): PublicKey {
  const configured = process.env.SCROW_PROGRAM_ID?.trim();
  return parsePublicKey(configured || DEFAULT_PROGRAM_ID, "SCROW_PROGRAM_ID");
}

export function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address.`);
  }
}

export function parseU64(value: string, label: string): bigint {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > U64_MAX) throw new Error(`${label} must fit in an unsigned 64-bit integer.`);
  return parsed;
}

export function escrowAddress(program: PublicKey, buyer: PublicKey, escrowId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), buyer.toBuffer(), u64(escrowId)], program)[0];
}

export interface CreateEscrowInput {
  program: PublicKey;
  buyer: PublicKey;
  seller: PublicKey;
  escrowId: bigint;
  lamports: bigint;
  refundAfter: bigint;
}

export function buildCreateEscrow(input: CreateEscrowInput) {
  if (input.lamports <= 0n || input.lamports > U64_MAX) throw new Error("Escrow amount is out of range.");
  if (input.refundAfter <= 0n || input.refundAfter > I64_MAX) throw new Error("Refund time is out of range.");
  if (input.buyer.equals(input.seller)) throw new Error("Seller must be different from the buyer.");
  const escrow = escrowAddress(input.program, input.buyer, input.escrowId);
  const refundAfter = Buffer.alloc(8);
  refundAfter.writeBigInt64LE(input.refundAfter);
  const instruction = new TransactionInstruction({
    programId: input.program,
    keys: [
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      { pubkey: input.seller, isSigner: false, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([DISCRIMINATOR.createEscrow, u64(input.escrowId), u64(input.lamports), refundAfter]),
  });
  return { escrow, transactionBase64: serialize(input.buyer, instruction) };
}

export function buildRelease(input: { program: PublicKey; buyer: PublicKey; seller: PublicKey; escrowId: bigint }) {
  if (input.buyer.equals(input.seller)) throw new Error("Seller must be different from the buyer.");
  const escrow = escrowAddress(input.program, input.buyer, input.escrowId);
  const instruction = new TransactionInstruction({
    programId: input.program,
    keys: [
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      { pubkey: input.seller, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(DISCRIMINATOR.release),
  });
  return { escrow, transactionBase64: serialize(input.buyer, instruction) };
}

export function buildRefund(input: { program: PublicKey; buyer: PublicKey; escrowId: bigint }) {
  const escrow = escrowAddress(input.program, input.buyer, input.escrowId);
  const instruction = new TransactionInstruction({
    programId: input.program,
    keys: [
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(DISCRIMINATOR.refund),
  });
  return { escrow, transactionBase64: serialize(input.buyer, instruction) };
}

function u64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

/** Unsigned legacy transaction: the buyer is the only signer and the fee payer. */
function serialize(feePayer: PublicKey, instruction: TransactionInstruction): string {
  return new Transaction({ feePayer, recentBlockhash: PLACEHOLDER_BLOCKHASH })
    .add(instruction)
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}
