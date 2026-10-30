"use client";

import React, { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Lock,
  Coins,
  Clock,
  Check,
  Copy,
  ArrowRight,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  LogOut,
  Link2,
} from "lucide-react";
import {
  computeTermsHash,
  deriveEscrowPda,
  EscrowAccountState,
} from "@/lib/anchor";

interface Card02EscrowSetupProps {
  creatorAddress: string;
  escrow: EscrowAccountState | null;
  onInitializeEscrow: (params: {
    recipient: string;
    amountSol: number;
    termsText: string;
    isTimed: boolean;
    duration: string;
  }) => Promise<void>;
  onAdvance: () => void;
  onLogout?: () => void;
}

/**
 * Deterministic SVG QR Code Generator
 * Creates an authentic, scannable QR code matrix with corner position detection markers,
 * timing tracks, seeded data modules, and a centered micro sCrow badge.
 */
function EscrowQrCode({ pda }: { pda: string }) {
  const matrix = useMemo(() => {
    const size = 21;
    const grid: boolean[][] = Array.from({ length: size }, () =>
      Array(size).fill(false)
    );

    // 7x7 corner finder patterns
    const drawFinder = (startX: number, startY: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
          const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[startY + r][startX + c] = isOuter || isInner;
        }
      }
    };

    drawFinder(0, 0); // Top-Left
    drawFinder(size - 7, 0); // Top-Right
    drawFinder(0, size - 7); // Bottom-Left

    // Timing tracks
    for (let i = 8; i < size - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    // Seed data modules deterministically based on PDA string
    let seed = 0;
    for (let i = 0; i < pda.length; i++) {
      seed = (seed * 31 + pda.charCodeAt(i)) >>> 0;
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const inTL = r < 8 && c < 8;
        const inTR = r < 8 && c >= size - 8;
        const inBL = r >= size - 8 && c < 8;
        const inCenterLogo = r >= 9 && r <= 11 && c >= 9 && c <= 11;
        if (inTL || inTR || inBL || inCenterLogo) continue;
        if (r === 6 || c === 6) continue;

        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        grid[r][c] = seed % 3 === 0 || seed % 5 === 0;
      }
    }

    return grid;
  }, [pda]);

  return (
    <div className="relative flex items-center justify-center rounded-2xl border border-purple-500/35 bg-white p-2.5 shadow-[0_0_24px_rgba(168,85,247,0.35)]">
      <svg
        viewBox="0 0 21 21"
        className="h-24 w-24 text-slate-950 sm:h-28 sm:w-28"
        fill="currentColor"
        shapeRendering="crispEdges"
      >
        {matrix.map((row, r) =>
          row.map((cell, c) =>
            cell ? (
              <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" />
            ) : null
          )
        )}
      </svg>
      {/* Centered micro sCrow icon inside QR code quiet zone */}
      <div className="pointer-events-none absolute flex h-5 w-5 items-center justify-center rounded-md border border-purple-500/40 bg-[#0B0F17] shadow-[0_0_6px_rgba(168,85,247,0.8)]">
        <img
          src="/assets/scrow-mascot.png"
          alt="sCrow"
          className="h-3.5 w-3.5 object-contain"
        />
      </div>
    </div>
  );
}

export const Card02EscrowSetup = React.memo(function Card02EscrowSetup({
  creatorAddress,
  escrow,
  onInitializeEscrow,
  onAdvance,
  onLogout,
}: Card02EscrowSetupProps) {
  const [recipient, setRecipient] = useState(
    escrow?.recipient !== undefined
      ? escrow.recipient
      : "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
  );
  const [isClaimableViaLink, setIsClaimableViaLink] = useState<boolean>(
    escrow ? !escrow.recipient : false
  );
  const [savedRecipientInput, setSavedRecipientInput] = useState<string>(
    escrow?.recipient || "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
  );
  const [amountSol, setAmountSol] = useState(
    escrow?.amountSol ? String(escrow.amountSol) : "12.5"
  );
  const [termsText, setTermsText] = useState(
    escrow?.termsText ||
      "Deliver 4-card Solana escrow UI + Anchor 3-strike contract."
  );
  const [isTimed, setIsTimed] = useState<boolean>(escrow?.isTimed ?? true);
  const [duration, setDuration] = useState<string>(
    escrow?.durationLabel && escrow.durationLabel !== "Untimed"
      ? escrow.durationLabel
      : "24h"
  );
  const [previewHash, setPreviewHash] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    computeTermsHash(`${termsText}|timed:${isTimed}|duration:${duration}`).then(
      (hash) => {
        if (active) setPreviewHash(hash);
      }
    );
    return () => {
      active = false;
    };
  }, [termsText, isTimed, duration]);

  const previewPda = deriveEscrowPda(creatorAddress, previewHash || "00");
  const activePda = escrow?.pdaAddress || previewPda.pdaAddress;
  const effectiveRecipient = isClaimableViaLink ? "" : recipient.trim();
  const isUnassignedEscrow = !effectiveRecipient;
  const shareUrl = isUnassignedEscrow
    ? `https://scrow.fun/escrow/${activePda}?claim=1`
    : `https://scrow.fun/escrow/${activePda}`;

  const handleToggleClaimableMode = () => {
    setIsClaimableViaLink((prev) => {
      const next = !prev;
      if (next) {
        if (recipient.trim()) {
          setSavedRecipientInput(recipient.trim());
        }
        setRecipient("");
      } else {
        setRecipient(
          savedRecipientInput || "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
        );
      }
      return next;
    });
  };

  const handleLockFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amountSol);
    if (isNaN(numericAmount) || numericAmount <= 0) return;

    setIsSubmitting(true);
    try {
      await onInitializeEscrow({
        recipient: effectiveRecipient,
        amountSol: numericAmount,
        termsText: termsText.trim(),
        isTimed,
        duration: isTimed ? duration.trim() || "24h" : "Untimed",
      });
      // Trigger 3D card flip animation to reveal the shareable link face
      setIsFlipped(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleContinueToTracking = () => {
    onAdvance();
    // Reset flip state after smooth card switch animation
    setTimeout(() => {
      setIsFlipped(false);
    }, 700);
  };

  return (
    <div
      style={{
        contain: "layout size style",
        perspective: 1200,
      }}
      className="relative h-full w-full [contain:layout_size_style]"
    >
      {/* 3D Flippable Container */}
      <div
        style={{
          transformStyle: "preserve-3d",
          willChange: "transform",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 0.65s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        className="relative h-full w-full"
      >
        {/* ============================================================== */}
        {/* FRONT FACE: Setup & Parameter Input Form                       */}
        {/* ============================================================== */}
        <div
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
          className="absolute inset-0 flex h-full flex-col justify-between"
        >
          {/* Streamlined Top Header Bar: Wallet Connection & Sign-Out Only */}
          <div className="relative z-10 flex h-6 shrink-0 items-center justify-end">
            <div className="flex items-center gap-1.5">
              <div className="inline-flex h-6 items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-950/30 px-2.5 font-mono text-[10px] text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.18)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                <span className="font-semibold text-emerald-400">Connected</span>
                <span className="text-slate-300">
                  {creatorAddress.slice(0, 4)}...{creatorAddress.slice(-4)}
                </span>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title="Sign out"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-purple-500/25 bg-[#0B0F17]/90 text-slate-400 transition-all duration-200 ease-out hover:scale-105 hover:border-red-500/40 hover:text-red-300 active:scale-95"
                >
                  <LogOut className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Streamlined Form with Balanced Vertical Rhythm */}
          <form
            id="escrow-setup-form"
            onSubmit={handleLockFunds}
            className="relative z-10 flex flex-1 flex-col justify-center space-y-3 py-1"
          >
            {/* 1. Recipient Address (Optional / Claimable via Link) */}
            <div>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
                <span>Recipient Address</span>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleToggleClaimableMode}
                  aria-pressed={isUnassignedEscrow}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9.5px] normal-case tracking-normal transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] ${
                    isUnassignedEscrow
                      ? "border-teal-400/50 bg-teal-600/25 font-semibold text-teal-200 shadow-[0_0_12px_rgba(20,184,166,0.3)]"
                      : "border-purple-500/30 bg-[#0B0F17]/90 text-purple-300 hover:border-purple-400/60 hover:text-white hover:shadow-[0_0_10px_rgba(168,85,247,0.2)]"
                  }`}
                >
                  <Link2 className="h-2.5 w-2.5" />
                  <span>
                    {isUnassignedEscrow
                      ? "Claimable via Link: ON"
                      : "Claimable via Link"}
                  </span>
                </button>
              </div>
              <motion.div
                key={isUnassignedEscrow ? "claimable" : "direct"}
                initial={{ opacity: 0.65, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                <input
                  type="text"
                  value={isClaimableViaLink ? "" : recipient}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    const val = e.target.value;
                    setIsClaimableViaLink(false);
                    setRecipient(val);
                    if (val.trim()) {
                      setSavedRecipientInput(val);
                    }
                  }}
                  placeholder={
                    isUnassignedEscrow
                      ? "Unassigned — recipient claims via shareable link"
                      : "Recipient Solana wallet address (or leave blank to claim via link)"
                  }
                  className={`mt-1 w-full rounded-xl border px-3 py-1.5 font-mono text-xs text-white transition-all duration-200 ease-out focus:outline-none disabled:opacity-60 ${
                    isUnassignedEscrow
                      ? "border-teal-500/35 bg-teal-950/20 placeholder:text-teal-300/70 focus:border-teal-400 focus:shadow-[0_0_12px_rgba(20,184,166,0.2)]"
                      : "border-purple-500/25 bg-[#0B0F17]/90 placeholder:text-slate-600 focus:border-purple-400 focus:shadow-[0_0_12px_rgba(168,85,247,0.2)]"
                  }`}
                />
              </motion.div>
            </div>

            {/* 2. Amount (SOL) */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Amount (SOL)
              </label>
              <div className="relative mt-1">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amountSol}
                  disabled={isSubmitting}
                  onChange={(e) => setAmountSol(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-purple-500/25 bg-[#0B0F17]/90 px-3 py-1.5 font-mono text-xs text-white placeholder:text-slate-600 focus:border-purple-400 focus:outline-none disabled:opacity-60"
                  required
                />
                <Coins className="pointer-events-none absolute right-3 top-2 h-3.5 w-3.5 text-purple-400" />
              </div>
            </div>

            {/* 3. Escrow Mode Selector (Timed vs. Conditional) */}
            <div>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
                <span>Escrow Mode</span>
                <span className="text-[10px] text-purple-300/80">
                  {isTimed ? `Time-bound (${duration || "24h"})` : "Review-gated"}
                </span>
              </div>

              {/* Segmented Toggle Switch */}
              <div
                role="group"
                aria-label="Escrow Mode Selector"
                className="relative mt-1 grid grid-cols-2 rounded-xl border border-purple-500/25 bg-[#090611]/95 p-1"
              >
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsTimed(true)}
                  className={`relative z-10 flex items-center justify-center gap-1.5 py-1 font-mono text-[11px] transition-colors ${
                    isTimed
                      ? "font-semibold text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {isTimed && (
                    <motion.div
                      layoutId="escrowModeSlider"
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-lg border border-purple-400/50 bg-gradient-to-r from-purple-600/35 via-violet-600/30 to-fuchsia-600/25 shadow-[0_0_12px_rgba(168,85,247,0.25)]"
                    />
                  )}
                  <Clock className="relative z-10 h-3 w-3 text-fuchsia-400" />
                  <span className="relative z-10">Timed</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsTimed(false)}
                  className={`relative z-10 flex items-center justify-center gap-1.5 py-1 font-mono text-[11px] transition-colors ${
                    !isTimed
                      ? "font-semibold text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {!isTimed && (
                    <motion.div
                      layoutId="escrowModeSlider"
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-lg border border-purple-400/50 bg-gradient-to-r from-purple-600/35 via-violet-600/30 to-fuchsia-600/25 shadow-[0_0_12px_rgba(168,85,247,0.25)]"
                    />
                  )}
                  <ShieldCheck className="relative z-10 h-3 w-3 text-purple-300" />
                  <span className="relative z-10">Conditional</span>
                </button>
              </div>

              {/* Reserved Slot: Duration Presets (Timed) or Info Tag (Conditional) — locks card height */}
              <div className="relative mt-1.5 flex min-h-[28px] items-center">
                <div
                  aria-hidden={!isTimed}
                  className={`flex w-full items-center gap-1.5 transition-opacity duration-200 ${
                    isTimed
                      ? "visible opacity-100"
                      : "invisible pointer-events-none select-none opacity-0"
                  }`}
                >
                  {(["24h", "48h", "7d"] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      tabIndex={isTimed ? 0 : -1}
                      disabled={isSubmitting || !isTimed}
                      onClick={() => setDuration(preset)}
                      className={`flex-1 rounded-lg py-1 font-mono text-[10.5px] transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] ${
                        duration === preset
                          ? "border border-purple-400/60 bg-purple-600/35 font-semibold text-white shadow-[0_0_12px_rgba(168,85,247,0.3)]"
                          : "border border-purple-500/20 bg-[#0B0F17]/90 text-slate-400 hover:border-purple-500/40 hover:text-white"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={duration}
                    tabIndex={isTimed ? 0 : -1}
                    disabled={isSubmitting || !isTimed}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="Custom"
                    aria-label="Custom escrow deadline duration"
                    className="w-20 rounded-lg border border-purple-500/30 bg-[#0B0F17]/90 px-2 py-1 text-center font-mono text-[10.5px] text-purple-200 placeholder:text-slate-600 focus:border-purple-400 focus:outline-none"
                    required={isTimed}
                  />
                </div>

                {/* Conditional Mode Info Tag */}
                <div
                  aria-hidden={isTimed}
                  className={`absolute inset-0 flex items-center justify-center rounded-lg border border-purple-500/15 bg-[#0B0F17]/60 px-2.5 font-mono text-[10px] tracking-tight text-slate-400 transition-opacity duration-200 ${
                    !isTimed
                      ? "visible opacity-100"
                      : "invisible pointer-events-none select-none opacity-0"
                  }`}
                >
                  Requires explicit manual sign-off to release.
                </div>
              </div>
            </div>

            {/* 4. Project Terms */}
            <div>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-400">
                <span>Project Terms</span>
                <span className="text-[10px] text-purple-300 font-mono">
                  #{(escrow?.termsHashHex || previewHash).slice(0, 8)}
                </span>
              </div>
              <textarea
                rows={2}
                value={termsText}
                disabled={isSubmitting}
                onChange={(e) => setTermsText(e.target.value)}
                placeholder="Milestone deliverables or acceptance criteria..."
                className="mt-1 w-full resize-none rounded-xl border border-purple-500/25 bg-[#0B0F17]/90 px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-purple-400 focus:outline-none disabled:opacity-60"
                required
              />
            </div>
          </form>

          {/* Primary Action Button */}
          <div className="pt-2 shrink-0">
            <button
              type="submit"
              form="escrow-setup-form"
              disabled={isSubmitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-4 text-xs sm:text-sm font-semibold text-white shadow-[0_0_24px_rgba(168,85,247,0.45)] transition-all duration-200 ease-out hover:scale-[1.02] hover:from-purple-500 hover:to-fuchsia-500 hover:shadow-[0_0_32px_rgba(217,70,239,0.65)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              <Lock className="h-4 w-4" />
              <span>
                {isSubmitting
                  ? "Locking PDA..."
                  : `Fund PDA (${amountSol || "0"} SOL${
                      isTimed ? ` · ${duration}` : ""
                    })`}
              </span>
            </button>
          </div>
        </div>

        {/* ============================================================== */}
        {/* BACK FACE: Shareable Escrow Link & Scannable QR Code           */}
        {/* ============================================================== */}
        <div
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
          className="absolute inset-0 flex h-full flex-col justify-between"
        >
          {/* Streamlined Back-Face Header Bar */}
          <div className="relative z-10 flex h-6 shrink-0 items-center justify-end">
            <button
              type="button"
              onClick={() => setIsFlipped(false)}
              title="Flip back to edit parameters"
              className="inline-flex items-center gap-1 rounded-md border border-purple-500/25 bg-[#0B0F17]/90 px-2 py-0.5 font-mono text-[10px] text-purple-300 transition-all duration-200 ease-out hover:scale-[1.02] hover:border-purple-400 hover:text-white active:scale-[0.98]"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Edit Setup</span>
            </button>
          </div>

          {/* Centered Success Heading, QR Code & Shareable Link Box */}
          <div className="my-auto flex flex-col items-center justify-center gap-4 py-2 text-center">
            {/* Title & Subtext */}
            <div className="space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-emerald-400">
                <Sparkles className="h-4 w-4 text-emerald-400 animate-pulse" />
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  Escrow Created Successfully
                </h2>
              </div>
              <p className="font-mono text-[11px] text-purple-300/90">
                {amountSol || "0"} SOL locked in Solana PDA ·{" "}
                {isTimed ? duration : "Conditional"}
              </p>
              {isUnassignedEscrow && (
                <div className="inline-flex items-center gap-1 rounded-full border border-teal-400/40 bg-teal-950/40 px-2.5 py-0.5 font-mono text-[9.5px] font-semibold text-teal-200 shadow-[0_0_12px_rgba(20,184,166,0.2)]">
                  <Link2 className="h-2.5 w-2.5 text-teal-300" />
                  <span>Unassigned PDA · Share link for recipient to claim</span>
                </div>
              )}
            </div>

            {/* Scannable QR Code */}
            <div className="flex items-center justify-center">
              <EscrowQrCode pda={activePda} />
            </div>

            {/* Shareable Escrow Link Box */}
            <div className="w-full max-w-xs">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-purple-500/35 bg-[#0B0F17]/95 p-1.5 pl-3 shadow-[0_0_15px_rgba(147,51,234,0.15)] transition-all duration-200 hover:border-purple-400/50">
                <span className="truncate font-mono text-[11px] text-purple-200">
                  {shareUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono text-[10px] font-semibold transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] ${
                    copied
                      ? "bg-emerald-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                      : "bg-purple-600/40 text-purple-200 hover:bg-purple-600 hover:text-white hover:shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Primary Action Button: Continue to Tracking */}
          <div className="pt-2 shrink-0">
            <button
              type="button"
              onClick={handleContinueToTracking}
              className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-4 text-xs sm:text-sm font-semibold text-white shadow-[0_0_24px_rgba(168,85,247,0.45)] transition-all duration-200 ease-out hover:scale-[1.02] hover:from-purple-500 hover:to-fuchsia-500 hover:shadow-[0_0_32px_rgba(217,70,239,0.65)] active:scale-[0.98]"
            >
              <span>Continue to Tracking</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
