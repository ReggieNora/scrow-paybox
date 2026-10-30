"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Lock } from "lucide-react";
import {
  handlePayBoxCallback,
  loginWithPayBox,
  logoutPayBox,
  PayBoxSession,
} from "@/lib/paybox";
import { EscrowAccountState } from "@/lib/anchor";
import { Card01Gateway } from "@/components/cards/Card01Gateway";
import { Card02EscrowSetup } from "@/components/cards/Card02EscrowSetup";
import { Card03RevisionThread } from "@/components/cards/Card03RevisionThread";

export type DeckCardIndex = 1 | 2 | 3;

const CARD_META: { index: DeckCardIndex; label: string; subtitle: string }[] = [
  { index: 1, label: "Gateway", subtitle: "Intro & Access" },
  { index: 2, label: "Setup", subtitle: "Lock PDA Funds" },
  { index: 3, label: "Deliverable Review", subtitle: "Review & Settlement" },
];

export function ScrowDeck() {
  const prefersReducedMotion = useReducedMotion();
  const [session, setSession] = useState<PayBoxSession | null>(null);
  const [escrow, setEscrow] = useState<EscrowAccountState | null>(null);
  const [activeCard, setActiveCard] = useState<DeckCardIndex>(1);
  const [shuffleDirection, setShuffleDirection] = useState<1 | -1>(1);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string>(
    "Disconnected PayBox session"
  );

  const shuffleToCard = useCallback((target: DeckCardIndex) => {
    setActiveCard((curr) => {
      if (target === curr) return curr;
      setShuffleDirection(target > curr ? 1 : -1);
      return target;
    });
  }, []);

  const callMcpTool = useCallback(
    async (toolName: string, args: Record<string, any>): Promise<any> => {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload?.error?.message || "MCP call failed");
      }
      return payload.result?.structuredContent;
    },
    []
  );

  const ensureDefaultEscrow = useCallback(
    async (creatorWallet: string, unassigned = false) => {
      try {
        const res = await callMcpTool("scrow_create_deck", {
          creator: creatorWallet,
          recipient: unassigned
            ? ""
            : "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
          amountSol: 12.5,
          terms: "Deliver 4-card Solana escrow UI + Anchor 3-strike contract.",
          isTimed: true,
          duration: "24h",
        });
        if (res?.escrow) {
          setEscrow(res.escrow);
        }
      } catch {
        // Non-fatal fallback
      }
    },
    [callMcpTool]
  );

  // Start on the centered Introduction card on page load; auto-complete OAuth 2.1 callback or claim link if present
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const isDirectEscrowLink =
        window.location.pathname.startsWith("/escrow/") ||
        params.get("claim") === "1";

      if (params.get("paybox_callback") === "1" && params.get("code")) {
        handlePayBoxCallback()
          .then((newSession) => {
            setSession(newSession);
            setStatusBanner("Connected");
            ensureDefaultEscrow(newSession.walletAddress, isDirectEscrowLink);
            setActiveCard(isDirectEscrowLink ? 3 : 2);
          })
          .catch((err) => {
            setStatusBanner(err?.message || "Disconnected PayBox session");
          });
        return;
      }

      if (isDirectEscrowLink) {
        const fallbackCreator = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
        ensureDefaultEscrow(fallbackCreator, true).then(() => {
          setActiveCard(3);
        });
        return;
      }
    }

    logoutPayBox();
    setSession(null);
    setActiveCard(1);
  }, [ensureDefaultEscrow]);

  /**
   * Interactive Passkey Login handler wired to Card 01
   */
  const handlePasskeySignIn = useCallback(async () => {
    if (isAuthenticating) return;
    setIsAuthenticating(true);
    setStatusBanner("Authenticating Passkey...");

    try {
      const newSession = await loginWithPayBox({ mode: "popup" });
      setSession(newSession);
      setStatusBanner("Connected");
      await ensureDefaultEscrow(newSession.walletAddress);
      shuffleToCard(2);
    } catch (err: any) {
      setStatusBanner(err?.message || "Disconnected PayBox session");
    } finally {
      setIsAuthenticating(false);
    }
  }, [isAuthenticating, ensureDefaultEscrow, shuffleToCard]);

  const handleInitializeEscrow = useCallback(
    async ({
      recipient,
      amountSol,
      termsText,
      isTimed,
      duration,
    }: {
      recipient: string;
      amountSol: number;
      termsText: string;
      isTimed: boolean;
      duration: string;
    }) => {
      const creator =
        session?.walletAddress || "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
      const normalizedRecipient = recipient ? recipient.trim() : "";
      const res = await callMcpTool("scrow_create_deck", {
        creator,
        recipient: normalizedRecipient,
        amountSol,
        terms: termsText,
        isTimed,
        duration,
      });
      if (res?.escrow) {
        setEscrow(res.escrow);
      }
      setStatusBanner(
        `Connected · Locked ${amountSol} SOL${
          isTimed ? ` (${duration} timer)` : ""
        }`
      );
    },
    [session?.walletAddress, callMcpTool]
  );

  const handleSubmitWork = useCallback(
    async (submissionUrl: string) => {
      if (!escrow?.pdaAddress) return;
      const res = await callMcpTool("scrow_submit_work", {
        pdaAddress: escrow.pdaAddress,
        recipient:
          escrow?.recipient ||
          session?.walletAddress ||
          "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
        submissionUrl,
      });
      if (res?.escrow) {
        setEscrow(res.escrow);
      }
      setStatusBanner("Connected · Proof submitted (InReview)");
    },
    [escrow, session?.walletAddress, callMcpTool]
  );

  const handleClaimRecipient = useCallback(
    async (recipientAddress?: string) => {
      if (!escrow?.pdaAddress) return;
      let resolvedAddress = (recipientAddress || "").trim();

      // If no session or wallet is connected yet, trigger PayBox passkey connection first
      if (!session && !resolvedAddress) {
        try {
          const newSession = await loginWithPayBox({ mode: "popup" });
          setSession(newSession);
          resolvedAddress = newSession.walletAddress;
        } catch {
          resolvedAddress = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
        }
      }

      if (!resolvedAddress) {
        resolvedAddress =
          session?.walletAddress ||
          "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
      }

      try {
        const res = await callMcpTool("scrow_claim_recipient", {
          pdaAddress: escrow.pdaAddress,
          recipient: resolvedAddress,
        });
        if (res?.escrow) {
          setEscrow(res.escrow);
        } else {
          setEscrow((prev) =>
            prev ? { ...prev, recipient: resolvedAddress } : prev
          );
        }
      } catch {
        setEscrow((prev) =>
          prev ? { ...prev, recipient: resolvedAddress } : prev
        );
      }

      setStatusBanner(
        `Connected · Bound ${resolvedAddress.slice(0, 4)}...${resolvedAddress.slice(
          -4
        )} as official recipient`
      );
    },
    [escrow, session, callMcpTool]
  );

  const handleReviewWork = useCallback(
    async (approved: boolean, feedback?: string) => {
      if (!escrow?.pdaAddress) return;
      const res = await callMcpTool("scrow_review_work", {
        pdaAddress: escrow.pdaAddress,
        creator: escrow?.creator,
        approved,
        feedback,
      });
      const updated: EscrowAccountState | undefined = res?.escrow;
      if (updated) {
        setEscrow(updated);
      }

      if (approved) {
        setStatusBanner(
          "Connected · Work approved — 99.25% payout released & PDA rent reclaimed"
        );
      } else if (updated?.escrowState === "Refunded") {
        setStatusBanner("Connected · Strike 3/3 reached — Auto-refunded");
      } else if (updated) {
        setStatusBanner(
          `Connected · Revision requested — Strike ${updated.attemptsUsed}/3`
        );
      }
    },
    [escrow, callMcpTool]
  );

  const handleExecuteCloseAndReclaim = useCallback(async () => {
    if (!escrow) return;
    const res = await callMcpTool("scrow_release_payout", {
      pdaAddress: escrow.pdaAddress,
      creator: escrow.creator,
    });
    setEscrow(res.escrow);
    setStatusBanner(
      `Connected · Settled 99.25% payout & reclaimed ${res.reclaimedRentSol} SOL rent`
    );
  }, [escrow, callMcpTool]);

  const handleResetDeck = useCallback(() => {
    if (session) {
      ensureDefaultEscrow(session.walletAddress);
      shuffleToCard(2);
      setStatusBanner("Connected · Fresh sCrow deck dealt");
    } else {
      setEscrow(null);
      shuffleToCard(1);
    }
  }, [session, ensureDefaultEscrow, shuffleToCard]);

  const handleLogout = useCallback(() => {
    logoutPayBox();
    setSession(null);
    setEscrow(null);
    shuffleToCard(1);
    setStatusBanner("Disconnected PayBox session");
  }, [shuffleToCard]);

  // Once authenticated via Passkey, unlock access to Card 02, 03, and 04
  const canSelectCard = useCallback(
    (index: DeckCardIndex): boolean => {
      if (index === 1) return true;
      return Boolean(session);
    },
    [session]
  );

  // Compute physical 3D GPU-accelerated deck transform for each card
  const getDeckCardTransform = useCallback(
    (cardIndex: DeckCardIndex) => {
      const offset = (cardIndex - activeCard + 3) % 3;

      // When signed out, keep background cards hidden behind the centered Introduction card
      if (!session && offset !== 0) {
        return {
          x: 0,
          y: 0,
          z: 0,
          scale: 0.98,
          rotateZ: 0,
          opacity: 0,
          zIndex: 40 - offset * 10,
        };
      }

      if (prefersReducedMotion) {
        return {
          x: 0,
          y: offset * 8,
          z: 0,
          scale: 1 - offset * 0.02,
          rotateZ: 0,
          opacity: offset === 0 ? 1 : 0,
          zIndex: 40 - offset * 10,
        };
      }

      switch (offset) {
        case 0: // Front Active Card — crisp 98% to 100% scale entry
          return {
            x: [shuffleDirection * 14, 0],
            y: [-6, 0],
            z: 0,
            scale: [0.98, 1],
            rotateZ: [shuffleDirection * 1.4, 0],
            opacity: 1,
            zIndex: 40,
          };
        case 1: // 2nd Card Peeking Right/Below
          return {
            x: 14,
            y: 16,
            z: 0,
            scale: 0.945,
            rotateZ: 2.4,
            opacity: 0.65,
            zIndex: 30,
          };
        default: // 3rd Card Peeking Left/Below
          return {
            x: -14,
            y: 30,
            z: 0,
            scale: 0.895,
            rotateZ: -2.2,
            opacity: 0.4,
            zIndex: 20,
          };
      }
    },
    [activeCard, shuffleDirection, prefersReducedMotion, session]
  );

  const advanceToCard2 = useCallback(() => shuffleToCard(2), [shuffleToCard]);
  const advanceToCard3 = useCallback(() => shuffleToCard(3), [shuffleToCard]);

  return (
    <div className="relative flex h-screen h-[100dvh] w-screen max-h-screen max-w-[100vw] items-center justify-center overflow-hidden bg-[#0B0F17] px-3 py-2 text-white select-none sm:px-6 sm:py-3.5">
      {/* Ambient Deep Violet / Magenta Web3 Background Glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-28 left-1/2 h-80 w-[34rem] -translate-x-1/2 rounded-full bg-purple-600/20 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 left-1/2 h-72 w-[30rem] -translate-x-1/2 rounded-full bg-fuchsia-600/15 blur-[110px]"
      />

      {/* Centered Physical 4-Card Playing Deck Stack */}
      <main className="relative z-10 flex w-full max-w-md items-center justify-center">
        <div className="relative h-[450px] w-full sm:h-[465px]">
          {CARD_META.map(({ index, label, subtitle }) => {
            const isFront = activeCard === index;
            const unlocked = canSelectCard(index);
            const transform = getDeckCardTransform(index);

            return (
              <motion.section
                key={index}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={transform}
                transition={{
                  duration: 0.2,
                  ease: [0.16, 1, 0.3, 1],
                }}
                style={{
                  willChange: "transform, opacity",
                  transformStyle: "preserve-3d",
                  backfaceVisibility: "hidden",
                  contain: "layout size style",
                }}
                onClick={() => {
                  if (!isFront && unlocked) {
                    shuffleToCard(index);
                  }
                }}
                aria-hidden={!isFront}
                className={`absolute inset-0 flex h-[450px] sm:h-[465px] w-full flex-col justify-between overflow-hidden rounded-3xl border p-4.5 sm:p-5 transition-colors [contain:layout_size_style] ${
                  isFront
                    ? "border-purple-500/40 bg-gradient-to-b from-[#171029] via-[#110C1D] to-[#0B0F17] shadow-[0_24px_70px_rgba(0,0,0,0.85),0_0_35px_rgba(147,51,234,0.22)]"
                    : unlocked
                    ? "cursor-pointer border-purple-500/25 bg-[#110C1D]/95 hover:border-purple-400/45"
                    : "pointer-events-none border-purple-500/15 bg-[#110C1D]/85"
                }`}
              >
                {/* Subtle Centered Crow-with-Key Watermark (No Wordmark) */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none select-none absolute inset-0 z-0 flex items-center justify-center"
                >
                  <img
                    src="/assets/scrow-crow.png"
                    alt=""
                    className="h-56 w-56 object-contain opacity-[0.06]"
                  />
                </div>

                <div
                  className={`relative z-10 flex h-full flex-col justify-between ${
                    !isFront ? "pointer-events-none" : ""
                  }`}
                >
                  {index === 1 && (
                    <Card01Gateway
                      session={session}
                      isAuthenticating={isAuthenticating}
                      onTriggerPasskeyLogin={handlePasskeySignIn}
                      onAdvance={advanceToCard2}
                    />
                  )}

                  {index === 2 && (
                    <Card02EscrowSetup
                      creatorAddress={
                        session?.walletAddress ||
                        "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
                      }
                      escrow={escrow}
                      onInitializeEscrow={handleInitializeEscrow}
                      onAdvance={advanceToCard3}
                      onLogout={handleLogout}
                    />
                  )}

                  {index === 3 &&
                    (escrow ? (
                      <Card03RevisionThread
                        escrow={escrow}
                        connectedWallet={session?.walletAddress}
                        onClaimRecipient={handleClaimRecipient}
                        onSubmitWork={handleSubmitWork}
                        onReviewWork={handleReviewWork}
                        onResetDeck={handleResetDeck}
                        onLogout={handleLogout}
                      />
                    ) : (
                      <LockedDeckCardPreview
                        label={label}
                        subtitle={subtitle}
                      />
                    ))}
                </div>
              </motion.section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

const LockedDeckCardPreview = React.memo(function LockedDeckCardPreview({
  label,
  subtitle,
}: {
  label: string;
  subtitle: string;
}) {
  return (
    <div
      style={{ contain: "layout size style" }}
      className="flex h-full flex-col justify-between [contain:layout_size_style]"
    >
      <div className="flex h-6 items-center justify-end">
        <span className="font-mono text-[11px] text-slate-500">{subtitle}</span>
      </div>
      <div className="my-auto flex flex-col items-center text-center opacity-50">
        <Lock className="h-8 w-8 text-purple-400" />
        <p className="mt-2 font-mono text-xs text-slate-400">
          Sign in with Passkey to unlock {label}
        </p>
      </div>
      <div className="h-10 rounded-xl border border-purple-500/15 bg-[#0B0F17]/50" />
    </div>
  );
});
