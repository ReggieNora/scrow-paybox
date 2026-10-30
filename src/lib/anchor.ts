/**
 * sCrow Anchor PDA State Machine & Deterministic Fee / Rent / Deadline Helpers
 * Mirrors `/program/src/lib.rs` on-chain program logic.
 */

export const SCROW_PROGRAM_ID = "SCrow11111111111111111111111111111111111111";
export const SCROW_PROTOCOL_TREASURY =
  "TrsrySCrow111111111111111111111111111111111";

export const PROTOCOL_FEE_BPS = 75; // 0.75%
export const BPS_DENOMINATOR = 10_000;
export const MAX_REVISION_ATTEMPTS = 3;

/** Rent-exempt minimum for EscrowAccount on Solana */
export const ESCROW_PDA_RENT_SOL = 0.00373632;

export type EscrowStateType =
  | "Pending"
  | "InReview"
  | "RevisionRequested"
  | "Released"
  | "Refunded";

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  instruction:
    | "initialize_escrow"
    | "claim_recipient"
    | "submit_work"
    | "review_work"
    | "release_payout";
  actor: string;
  summary: string;
  txSignature: string;
  strikeCount?: number;
}

export interface EscrowAccountState {
  pdaAddress: string;
  creator: string;
  recipient: string;
  protocolTreasury: string;
  amountSol: number;
  amountLamports: number;
  attemptsUsed: number; // u8, max 3
  termsText: string;
  termsHashHex: string;
  isTimed: boolean;
  durationLabel: string;
  deadlineUnixMs: number | null;
  escrowState: EscrowStateType;
  submissionUrl: string;
  rentLamports: number;
  rentReclaimed: boolean;
  bump: number;
  logs: ActivityLogEntry[];
}

/**
 * Parses a human-readable duration string (e.g. "24h", "7 days", "48 hours", "30m") into milliseconds.
 */
export function parseDurationToMs(input: string): number {
  const cleaned = input.trim().toLowerCase();
  if (!cleaned) return 24 * 3600 * 1000;

  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs)?$/);
  if (!match) {
    return 24 * 3600 * 1000;
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || "h";

  if (unit.startsWith("d")) return Math.round(value * 86_400 * 1000);
  if (unit.startsWith("m")) return Math.round(value * 60 * 1000);
  if (unit.startsWith("s")) return Math.round(value * 1000);
  return Math.round(value * 3600 * 1000);
}

/**
 * Formats remaining milliseconds into a live digital countdown string (e.g. `23h 59m 42s` or `06d 23h 59m 58s`).
 */
export function formatRemainingTime(msRemaining: number): {
  formatted: string;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
} {
  if (msRemaining <= 0) {
    return {
      formatted: "00h 00m 00s",
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      expired: true,
    };
  }

  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  const formatted =
    days > 0
      ? `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
      : `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  return {
    formatted,
    days,
    hours,
    minutes,
    seconds,
    expired: false,
  };
}

/**
 * Computes SHA-256 hex digest of the escrow terms string (32-byte `terms_hash` on-chain).
 */
export async function computeTermsHash(termsText: string): Promise<string> {
  const normalized = termsText.trim();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

/**
 * Deterministically derives a readable Base58-style PDA representation from `[b"escrow", creator, terms_hash]`
 */
export function deriveEscrowPda(creator: string, termsHashHex: string): {
  pdaAddress: string;
  bump: number;
} {
  const base58Alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const seedInput = `escrow:${creator}:${termsHashHex}`;
  let out = "pdaSCrow";
  for (let i = 0; i < 36; i++) {
    const code =
      (seedInput.charCodeAt(i % seedInput.length) * (i + 17) + i * 31) %
      base58Alphabet.length;
    out += base58Alphabet[code];
  }
  const bump = 254 - (seedInput.charCodeAt(0) % 7);
  return { pdaAddress: out, bump };
}

/**
 * Calculates the exact 0.75% protocol fee and 99.25% recipient payout split,
 * matching integer BPS math in `release_payout` (`lib.rs`).
 */
export function calculatePayoutBreakdown(amountSol: number): {
  totalSol: number;
  protocolFeeSol: number;
  recipientPayoutSol: number;
  reclaimedRentSol: number;
} {
  const lamports = Math.round(amountSol * 1_000_000_000);
  const feeLamports = Math.floor(
    (lamports * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR
  );
  const recipientLamports = lamports - feeLamports;

  return {
    totalSol: amountSol,
    protocolFeeSol: Number((feeLamports / 1_000_000_000).toFixed(6)),
    recipientPayoutSol: Number((recipientLamports / 1_000_000_000).toFixed(6)),
    reclaimedRentSol: ESCROW_PDA_RENT_SOL,
  };
}

export function generateTxSignature(prefix: string): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let sig = prefix.slice(0, 4);
  for (let i = 0; i < 40; i++) {
    sig += chars[Math.floor((Date.now() + i * 73) % chars.length)];
  }
  return sig;
}
