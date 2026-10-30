"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  RotateCcw,
  Coins,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import {
  calculatePayoutBreakdown,
  EscrowAccountState,
} from "@/lib/anchor";

interface Card04PayoutProps {
  escrow: EscrowAccountState;
  onExecuteCloseAndReclaim: () => Promise<void>;
  onResetDeck: () => void;
  onLogout?: () => void;
}

export const Card04Payout = React.memo(function Card04Payout({
  escrow,
  onExecuteCloseAndReclaim,
  onResetDeck,
  onLogout,
}: Card04PayoutProps) {
  const [isReclaiming, setIsReclaiming] = useState(false);
  const breakdown = calculatePayoutBreakdown(escrow.amountSol);
  const isRefunded = escrow.escrowState === "Refunded";

  const handleClosePda = async () => {
    setIsReclaiming(true);
    try {
      await onExecuteCloseAndReclaim();
    } finally {
      setIsReclaiming(false);
    }
  };

  return (
    <div
      style={{ contain: "layout size style" }}
      className="flex h-full flex-col justify-between [contain:layout_size_style]"
    >
      <div>
        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium ${
              isRefunded
                ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
                : "border-purple-500/35 bg-purple-500/10 text-purple-300"
            }`}
          >
            <Sparkles className="h-3 w-3 text-fuchsia-400" />
            04 // {isRefunded ? "REFUNDED" : "PAYOUT"}
          </span>

          <div className="flex items-center gap-1.5">
            <div className="inline-flex h-6 items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-950/30 px-2.5 font-mono text-[10px] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
              <span className="font-semibold text-emerald-400">Connected</span>
              <span className="text-slate-300">
                {escrow.creator.slice(0, 4)}...{escrow.creator.slice(-4)}
              </span>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                title="Sign out"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-purple-500/25 bg-[#0B0F17]/90 text-slate-400 transition hover:border-red-500/40 hover:text-red-300"
              >
                <LogOut className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Celebratory Hero */}
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="mt-5 flex flex-col items-center text-center"
        >
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
              isRefunded
                ? "border border-amber-400/40 bg-amber-500/20 text-amber-300"
                : "bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white shadow-[0_0_28px_rgba(168,85,247,0.55)]"
            }`}
          >
            {isRefunded ? (
              <ShieldAlert className="h-6 w-6" />
            ) : (
              <CheckCircle2 className="h-6 w-6" />
            )}
          </div>

          <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">
            {isRefunded
              ? "3-Strike Refund Executed"
              : escrow.rentReclaimed
              ? "Payout Settled & Rent Reclaimed"
              : "Work Approved — Settle PDA"}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {isRefunded
              ? "3/3 revisions reached. Principal returned to creator."
              : "99.25% recipient · 0.75% protocol fee · 100% PDA rent refund"}
          </p>
        </motion.div>

        {/* Clean Financial Summary */}
        <div className="mt-5 space-y-2.5 rounded-2xl border border-purple-500/25 bg-[#0B0F17]/95 p-4 font-mono text-xs">
          {isRefunded ? (
            <div className="flex items-center justify-between text-white">
              <span className="text-slate-400">Creator Refund (100%)</span>
              <span className="text-sm font-semibold text-amber-300">
                {breakdown.totalSol} SOL
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-white">
                <span className="text-slate-400">Recipient (99.25%)</span>
                <span className="text-sm font-semibold text-purple-300">
                  +{breakdown.recipientPayoutSol} SOL
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-400">
                <span>Protocol Fee (0.75%)</span>
                <span>{breakdown.protocolFeeSol} SOL</span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-white">
            <span className="flex items-center gap-1.5 text-slate-300">
              <Coins className="h-3.5 w-3.5 text-fuchsia-400" />
              PDA Rent Reclaimed
            </span>
            <span className="font-semibold text-fuchsia-300">
              +{breakdown.reclaimedRentSol} SOL
            </span>
          </div>
        </div>
      </div>

      {/* Primary Action */}
      <div className="space-y-2">
        {!isRefunded && !escrow.rentReclaimed && (
          <button
            type="button"
            onClick={handleClosePda}
            disabled={isReclaiming}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(168,85,247,0.45)] transition hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span>
              {isReclaiming
                ? "Settling & Closing PDA..."
                : `Release Payout & Reclaim Rent`}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onResetDeck}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-500/30 bg-[#0B0F17]/90 px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:border-purple-400/60 hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>New Escrow Deck</span>
        </button>
      </div>
    </div>
  );
});
