import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { buildCreateEscrow, buildRefund, buildRelease, parsePublicKey, parseU64, programId } from "./escrow.js";
import { atomicAmount, proposeSolana, solanaOutputSchema } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";
const MIN_ESCROW_LAMPORTS = 1_000_000n; // 0.001 SOL keeps a brand-new seller account rent-exempt on release.

const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const sender = solanaAddress.describe("Your PayBox wallet's public Solana address (the buyer). Never a private key.");
const seller = solanaAddress.describe("Seller's public Solana address that receives the SOL on release.");
const escrowId = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .describe("Escrow ID returned when the escrow was created (whole number).");

const proposalAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function propose(transactionBase64: string, summary: string) {
  const result = proposeSolana({ transactionBase64 });
  return { ...result, content: [{ type: "text" as const, text: `${summary} ${result.content[0]?.text ?? ""}`.trim() }] };
}

function createServer() {
  const server = new McpServer(
    { name: "scrow", version: "0.1.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "create_escrow",
    {
      title: "Create SOL escrow",
      description:
        "Proposes a Solana transaction that locks SOL from your wallet for a seller. " +
        "You can later release it to the seller, or refund it to yourself after the refund time. " +
        "Keep the returned escrow ID.",
      inputSchema: z
        .object({
          sender,
          seller,
          amountSol: z
            .string()
            .regex(/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,9})?$/)
            .describe("SOL to lock, as a decimal string, e.g. \"0.25\". Minimum 0.001."),
          refundAfterHours: z
            .number()
            .int()
            .min(1)
            .max(8760)
            .describe("Hours from now after which you may refund if not released (1 to 8760)."),
          escrowId: escrowId.optional().describe("Optional escrow ID. Leave out to generate one."),
        })
        .strict(),
      outputSchema: solanaOutputSchema,
      annotations: proposalAnnotations,
    },
    async (input) => {
      const program = programId();
      const buyer = parsePublicKey(input.sender, "sender");
      const sellerKey = parsePublicKey(input.seller, "seller");
      const lamports = BigInt(atomicAmount(input.amountSol, 9));
      if (lamports < MIN_ESCROW_LAMPORTS) throw new Error("Escrow amount must be at least 0.001 SOL.");
      const id = parseU64(input.escrowId ?? String(Date.now()), "escrowId");
      const refundAfterUnix = Math.floor(Date.now() / 1000) + input.refundAfterHours * 3600;
      const { escrow, transactionBase64 } = buildCreateEscrow({
        program,
        buyer,
        seller: sellerKey,
        escrowId: id,
        lamports,
        refundAfter: BigInt(refundAfterUnix),
      });
      const refundAt = new Date(refundAfterUnix * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      return propose(
        transactionBase64,
        `Escrow ID ${id}: lock ${input.amountSol} SOL for seller ${sellerKey.toBase58()} at escrow account ` +
          `${escrow.toBase58()}. Refund available after ${refundAt}. Save the escrow ID to release or refund.`,
      );
    },
  );

  server.registerTool(
    "release_escrow",
    {
      title: "Release SOL escrow to seller",
      description:
        "Proposes a Solana transaction that pays the locked SOL to the seller and returns the escrow's rent deposit to you. " +
        "Only the wallet that created the escrow can release it.",
      inputSchema: z.object({ sender, seller, escrowId }).strict(),
      outputSchema: solanaOutputSchema,
      annotations: proposalAnnotations,
    },
    async (input) => {
      const sellerKey = parsePublicKey(input.seller, "seller");
      const { escrow, transactionBase64 } = buildRelease({
        program: programId(),
        buyer: parsePublicKey(input.sender, "sender"),
        seller: sellerKey,
        escrowId: parseU64(input.escrowId, "escrowId"),
      });
      return propose(
        transactionBase64,
        `Release escrow ID ${input.escrowId} (account ${escrow.toBase58()}) to seller ${sellerKey.toBase58()}.`,
      );
    },
  );

  server.registerTool(
    "refund_escrow",
    {
      title: "Refund SOL escrow",
      description:
        "Proposes a Solana transaction that returns all locked SOL to you. " +
        "Works only after the escrow's refund time has passed; earlier attempts fail simulation.",
      inputSchema: z.object({ sender, escrowId }).strict(),
      outputSchema: solanaOutputSchema,
      annotations: proposalAnnotations,
    },
    async (input) => {
      const { escrow, transactionBase64 } = buildRefund({
        program: programId(),
        buyer: parsePublicKey(input.sender, "sender"),
        escrowId: parseU64(input.escrowId, "escrowId"),
      });
      return propose(transactionBase64, `Refund escrow ID ${input.escrowId} (account ${escrow.toBase58()}).`);
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
