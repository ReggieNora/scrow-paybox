"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  Fingerprint,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { PayBoxSession } from "@/lib/paybox";

interface Card01GatewayProps {
  session: PayBoxSession | null;
  isAuthenticating: boolean;
  onTriggerPasskeyLogin: () => void;
  onAdvance: () => void;
}

export const Card01Gateway = React.memo(function Card01Gateway({
  session,
  isAuthenticating,
  onTriggerPasskeyLogin,
  onAdvance,
}: Card01GatewayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{ contain: "layout size style" }}
      className="flex h-full flex-col justify-between [contain:layout_size_style]"
    >
      {/* Streamlined Minimal Header */}
      <div className="flex h-6 items-center justify-end">
        {session && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/35 px-2.5 py-0.5 font-mono text-[10.5px] text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
            <span className="font-semibold text-emerald-400">Connected</span>
            <span className="text-slate-300">
              {session.walletAddress.slice(0, 4)}...
              {session.walletAddress.slice(-4)}
            </span>
          </motion.span>
        )}
      </div>

      {/* Prominently Centered Mascot & Human-Friendly Intro */}
      <div className="my-auto flex flex-col items-center py-2 text-center">
        <div className="relative flex items-center justify-center">
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute h-24 w-32 rounded-full blur-2xl transition-all duration-500 ${
              isAuthenticating
                ? "scale-125 bg-fuchsia-500/50 animate-pulse"
                : session
                ? "bg-emerald-500/30 animate-pulse"
                : "bg-purple-600/35 animate-pulse"
            }`}
          />
          <img
            src="/assets/scrow-mascot.png"
            alt="sCrow Mascot"
            className="relative h-28 w-auto object-contain drop-shadow-[0_0_24px_rgba(168,85,247,0.75)] transition-transform duration-300 ease-out hover:scale-[1.03]"
          />
        </div>

        <h2 className="mt-3.5 text-2xl font-bold tracking-tight text-white">
          Trustless Solana Escrow
        </h2>

        <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-300/90">
          A secure, trustless escrow protocol built on Solana with milestone
          tracking and automated refund protection.
        </p>
      </div>

      {/* Primary Action Button */}
      <div className="flex h-[72px] flex-col justify-end">
        {session ? (
          <button
            type="button"
            onClick={onAdvance}
            className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_0_28px_rgba(168,85,247,0.5)] transition-all duration-200 ease-out hover:scale-[1.02] hover:from-purple-500 hover:to-fuchsia-500 hover:shadow-[0_0_36px_rgba(217,70,239,0.65)] active:scale-[0.98]"
          >
            <span>Continue to Setup</span>
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </button>
        ) : (
          <button
            type="button"
            disabled={isAuthenticating}
            onClick={onTriggerPasskeyLogin}
            className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_0_28px_rgba(168,85,247,0.5)] transition-all duration-200 ease-out hover:scale-[1.02] hover:from-purple-500 hover:to-fuchsia-500 hover:shadow-[0_0_36px_rgba(217,70,239,0.65)] active:scale-[0.98] disabled:opacity-75 disabled:hover:scale-100"
          >
            {isAuthenticating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-white" />
                <span>Verifying Passkey...</span>
              </>
            ) : (
              <>
                <Fingerprint className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
                <span>Sign in with Passkey</span>
              </>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
});
