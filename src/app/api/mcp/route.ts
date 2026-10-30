import { NextRequest, NextResponse } from "next/server";
import {
  calculatePayoutBreakdown,
  computeTermsHash,
  deriveEscrowPda,
  ESCROW_PDA_RENT_SOL,
  EscrowAccountState,
  generateTxSignature,
  MAX_REVISION_ATTEMPTS,
  parseDurationToMs,
  SCROW_PROGRAM_ID,
  SCROW_PROTOCOL_TREASURY,
} from "@/lib/anchor";

/**
 * In-memory ledger of active sCrow PDAs for MCP agent interactions.
 * Persisted across Next.js HMR reloads via globalThis and mirrors `/program/src/lib.rs`.
 */
const globalForScrow = globalThis as unknown as {
  __scrowMcpStore?: Map<string, EscrowAccountState>;
};
const mcpEscrowStore =
  globalForScrow.__scrowMcpStore ||
  (globalForScrow.__scrowMcpStore = new Map<string, EscrowAccountState>());

function getOrSeedEscrow(
  pdaAddress: string,
  overrides?: Partial<EscrowAccountState>
): EscrowAccountState {
  const existing = mcpEscrowStore.get(pdaAddress);
  if (existing) return existing;

  const fallbackAmount = overrides?.amountSol ?? 12.5;
  const seeded: EscrowAccountState = {
    pdaAddress,
    creator:
      overrides?.creator || "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    recipient: overrides?.recipient ?? "",
    protocolTreasury: SCROW_PROTOCOL_TREASURY,
    amountSol: fallbackAmount,
    amountLamports: Math.round(fallbackAmount * 1_000_000_000),
    attemptsUsed: overrides?.attemptsUsed ?? 0,
    termsText:
      overrides?.termsText ||
      "Deliver 4-card Solana escrow UI + Anchor 3-strike contract.",
    termsHashHex: overrides?.termsHashHex || "a1b2c3d4e5f60718",
    isTimed: overrides?.isTimed ?? true,
    durationLabel: overrides?.durationLabel || "24h",
    deadlineUnixMs: overrides?.deadlineUnixMs ?? Date.now() + 24 * 3600 * 1000,
    escrowState: overrides?.escrowState || "Pending",
    submissionUrl: overrides?.submissionUrl || "",
    rentLamports: Math.round(ESCROW_PDA_RENT_SOL * 1_000_000_000),
    rentReclaimed: false,
    bump: 254,
    logs: overrides?.logs || [],
  };
  mcpEscrowStore.set(pdaAddress, seeded);
  return seeded;
}

const MCP_TOOLS = [
  {
    name: "scrow_create_deck",
    description:
      "Instantiates and funds an sCrow PDA via the user's PayBox vault (`initialize_escrow`). Supports optional/blank recipient for Claimable via Link mode.",
    inputSchema: {
      type: "object",
      properties: {
        creator: { type: "string" },
        recipient: { type: "string" },
        amountSol: { type: "number" },
        terms: { type: "string" },
        isTimed: { type: "boolean" },
        duration: { type: "string" },
      },
      required: ["creator", "amountSol", "terms"],
    },
  },
  {
    name: "scrow_claim_recipient",
    description:
      "Binds a connected wallet address as the official recipient on an unassigned / claimable sCrow PDA (`claim_recipient`).",
    inputSchema: {
      type: "object",
      properties: {
        pdaAddress: { type: "string" },
        recipient: { type: "string" },
      },
      required: ["pdaAddress", "recipient"],
    },
  },
  {
    name: "scrow_submit_work",
    description:
      "Submits PR/work metadata URL and moves the sCrow PDA state from `Pending` to `InReview` (`submit_work`).",
    inputSchema: {
      type: "object",
      properties: {
        pdaAddress: { type: "string" },
        recipient: { type: "string" },
        submissionUrl: { type: "string" },
      },
      required: ["pdaAddress", "recipient", "submissionUrl"],
    },
  },
  {
    name: "scrow_review_work",
    description:
      "Executes approval or increments the revision counter (Strike 1-3). Automatically sets state to `Refunded` on Strike 3 (`review_work`).",
    inputSchema: {
      type: "object",
      properties: {
        pdaAddress: { type: "string" },
        creator: { type: "string" },
        approved: { type: "boolean" },
        feedback: { type: "string" },
      },
      required: ["pdaAddress", "creator", "approved"],
    },
  },
  {
    name: "scrow_release_payout",
    description:
      "Settles escrow (0.75% protocol fee to sCrow Treasury, 99.25% to recipient) and closes the PDA to reclaim 100% rent to creator (`release_payout`).",
    inputSchema: {
      type: "object",
      properties: {
        pdaAddress: { type: "string" },
        creator: { type: "string" },
      },
      required: ["pdaAddress", "creator"],
    },
  },
];

async function executeMcpTool(
  toolName: string,
  args: Record<string, any>
): Promise<Record<string, any>> {
  switch (toolName) {
    case "scrow_create_deck": {
      const { creator, recipient, amountSol, terms, isTimed, duration } = args;
      if (
        !creator ||
        !amountSol ||
        Number(amountSol) <= 0 ||
        !terms
      ) {
        throw new Error(
          "scrow_create_deck requires creator, positive amountSol, and terms."
        );
      }

      const normalizedRecipient = recipient ? String(recipient).trim() : "";
      const numericAmount = Number(amountSol);
      const timed = Boolean(isTimed);
      const durationLabel = timed ? String(duration || "24h").trim() : "Untimed";
      const deadlineUnixMs = timed
        ? Date.now() + parseDurationToMs(durationLabel)
        : null;

      const termsHashHex = await computeTermsHash(
        `${terms}|timed:${timed}|duration:${durationLabel}`
      );
      const { pdaAddress, bump } = deriveEscrowPda(
        String(creator),
        termsHashHex
      );
      const txSignature = generateTxSignature("init");

      const escrow: EscrowAccountState = {
        pdaAddress,
        creator: String(creator),
        recipient: normalizedRecipient,
        protocolTreasury: SCROW_PROTOCOL_TREASURY,
        amountSol: numericAmount,
        amountLamports: Math.round(numericAmount * 1_000_000_000),
        attemptsUsed: 0,
        termsText: String(terms),
        termsHashHex,
        isTimed: timed,
        durationLabel,
        deadlineUnixMs,
        escrowState: "Pending",
        submissionUrl: "",
        rentLamports: Math.round(ESCROW_PDA_RENT_SOL * 1_000_000_000),
        rentReclaimed: false,
        bump,
        logs: [
          {
            id: `log_${Date.now()}`,
            timestamp: new Date().toISOString(),
            instruction: "initialize_escrow",
            actor: String(creator),
            summary: `Locked ${numericAmount} SOL in PDA${
              timed ? ` (Deadline: ${durationLabel})` : ""
            }${
              !normalizedRecipient ? " · Unassigned (Claimable via Link)" : ""
            }`,
            txSignature,
          },
        ],
      };

      mcpEscrowStore.set(pdaAddress, escrow);

      return {
        programId: SCROW_PROGRAM_ID,
        instruction: "initialize_escrow",
        txSignature,
        escrow,
      };
    }

    case "scrow_claim_recipient": {
      const { pdaAddress, recipient } = args;
      const normalizedRecipient = recipient ? String(recipient).trim() : "";
      if (!normalizedRecipient) {
        throw new Error("scrow_claim_recipient requires a valid recipient wallet address.");
      }
      const escrow = getOrSeedEscrow(String(pdaAddress), {
        recipient: normalizedRecipient,
      });

      const txSignature = generateTxSignature("clai");
      escrow.recipient = normalizedRecipient;
      escrow.logs.unshift({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        instruction: "claim_recipient",
        actor: normalizedRecipient,
        summary: `Recipient wallet ${normalizedRecipient.slice(
          0,
          4
        )}...${normalizedRecipient.slice(-4)} bound to Escrow PDA`,
        txSignature,
      });

      return {
        programId: SCROW_PROGRAM_ID,
        instruction: "claim_recipient",
        txSignature,
        escrow,
      };
    }

    case "scrow_submit_work": {
      const { pdaAddress, recipient, submissionUrl } = args;
      const escrow = getOrSeedEscrow(String(pdaAddress), {
        recipient: recipient ? String(recipient) : "",
      });
      if (
        escrow.escrowState !== "Pending" &&
        escrow.escrowState !== "RevisionRequested"
      ) {
        throw new Error(
          `Cannot submit work while escrow is in '${escrow.escrowState}' state. Awaiting buyer review or revision request.`
        );
      }
      if (escrow.attemptsUsed >= MAX_REVISION_ATTEMPTS) {
        throw new Error("Maximum of 3 revision attempts already reached.");
      }

      const txSignature = generateTxSignature("subm");
      escrow.submissionUrl = String(submissionUrl);
      escrow.escrowState = "InReview";
      escrow.logs.unshift({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        instruction: "submit_work",
        actor: String(recipient || escrow.recipient || "Freelancer"),
        summary: `Submitted deliverable proof: ${submissionUrl}`,
        txSignature,
      });

      return {
        programId: SCROW_PROGRAM_ID,
        instruction: "submit_work",
        txSignature,
        escrow,
      };
    }

    case "scrow_review_work": {
      const { pdaAddress, creator, approved, feedback } = args;
      const escrow = getOrSeedEscrow(String(pdaAddress), {
        creator: creator ? String(creator) : undefined,
      });

      const txSignature = generateTxSignature("revw");

      if (Boolean(approved)) {
        const breakdown = calculatePayoutBreakdown(escrow.amountSol);
        escrow.escrowState = "Released";
        escrow.rentReclaimed = true;
        escrow.logs.unshift({
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          instruction: "review_work",
          actor: String(creator || escrow.creator),
          summary: `Approved work. Released ${breakdown.recipientPayoutSol} SOL (99.25%) to recipient and reclaimed ${breakdown.reclaimedRentSol} SOL PDA rent.`,
          txSignature,
        });

        return {
          programId: SCROW_PROGRAM_ID,
          instruction: "review_work",
          approved: true,
          txSignature,
          breakdown,
          escrow,
        };
      } else {
        escrow.attemptsUsed = Math.min(
          MAX_REVISION_ATTEMPTS,
          escrow.attemptsUsed + 1
        );
        const isStrikeThree = escrow.attemptsUsed >= MAX_REVISION_ATTEMPTS;
        escrow.escrowState = isStrikeThree ? "Refunded" : "RevisionRequested";

        escrow.logs.unshift({
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          instruction: "review_work",
          actor: String(creator || escrow.creator),
          summary: isStrikeThree
            ? `Strike 3/3 triggered! Escrow automatically set to Refunded and ${escrow.amountSol} SOL returned to creator.`
            : `Revision requested (Strike ${escrow.attemptsUsed}/3)${
                feedback ? `: "${feedback}"` : "."
              }`,
          txSignature,
          strikeCount: escrow.attemptsUsed,
        });

        return {
          programId: SCROW_PROGRAM_ID,
          instruction: "review_work",
          approved: false,
          attemptsUsed: escrow.attemptsUsed,
          attemptsRemaining: MAX_REVISION_ATTEMPTS - escrow.attemptsUsed,
          autoRefunded: isStrikeThree,
          txSignature,
          escrow,
        };
      }
    }

    case "scrow_release_payout": {
      const { pdaAddress, creator } = args;
      const escrow = getOrSeedEscrow(String(pdaAddress), {
        creator: creator ? String(creator) : undefined,
      });

      const breakdown = calculatePayoutBreakdown(escrow.amountSol);
      const txSignature = generateTxSignature("relp");
      escrow.escrowState = "Released";
      escrow.rentReclaimed = true;

      escrow.logs.unshift({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        instruction: "release_payout",
        actor: String(creator || escrow.creator),
        summary: `Settled 99.25% (${breakdown.recipientPayoutSol} SOL) to recipient and reclaimed ${breakdown.reclaimedRentSol} SOL rent to creator.`,
        txSignature,
      });

      return {
        programId: SCROW_PROGRAM_ID,
        instruction: "release_payout",
        txSignature,
        breakdown,
        pdaClosed: true,
        reclaimedRentSol: breakdown.reclaimedRentSol,
        escrow,
      };
    }

    default:
      throw new Error(`Unknown sCrow MCP tool: ${toolName}`);
  }
}

export async function GET() {
  return NextResponse.json({
    protocol: "mcp",
    version: "2025-03-26",
    serverInfo: {
      name: "scrow-paybox-mcp-server",
      version: "0.1.0",
    },
    tools: MCP_TOOLS,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.jsonrpc === "2.0") {
      const { id, method, params } = body;

      if (method === "initialize") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-03-26",
            serverInfo: {
              name: "scrow-paybox-mcp-server",
              version: "0.1.0",
            },
            capabilities: {
              tools: {},
            },
          },
        });
      }

      if (method === "tools/list") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: MCP_TOOLS,
          },
        });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        const result = await executeMcpTool(toolName, toolArgs);

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
            structuredContent: result,
          },
        });
      }
    }

    const directToolName = body.tool || body.name;
    const directArgs = body.arguments || body.params || body;
    if (directToolName) {
      const result = await executeMcpTool(directToolName, directArgs);
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json(
      { error: "Unsupported MCP request payload." },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: err?.message || "MCP execution error",
        },
      },
      { status: 400 }
    );
  }
}
