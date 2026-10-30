"use client";

import React, { useEffect, useRef, useState } from "react";
import { Fingerprint, KeyRound, ShieldCheck, Sparkles, X } from "lucide-react";
import { loginWithPayBox, PayBoxSession } from "@/lib/paybox";

interface PayBoxAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: PayBoxSession) => void;
}

export function PayBoxAuthModal({
  isOpen,
  onClose,
  onSuccess,
}: PayBoxAuthModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStage, setScanStage] = useState<
    "idle" | "prompting" | "verifying" | "verified"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // Sync modal open/close state with native <dialog> showModal()
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      setScanStage("idle");
      setIsScanning(false);
      setError(null);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback for browsers without native `closedby="any"` support (per modern-web-guidance)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      onClose();
    };
    dialog.addEventListener("close", handleNativeClose);

    let handleBackdropClick: ((event: MouseEvent) => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (!isDialogContent) {
          dialog.close();
        }
      };
      dialog.addEventListener("click", handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener("close", handleNativeClose);
      if (handleBackdropClick) {
        dialog.removeEventListener("click", handleBackdropClick);
      }
    };
  }, [onClose]);

  const handleSignInWithPasskey = async () => {
    setIsScanning(true);
    setError(null);
    setScanStage("prompting");

    try {
      await new Promise((r) => setTimeout(r, 380));
      setScanStage("verifying");
      const session = await loginWithPayBox({ mode: "popup" });
      await new Promise((r) => setTimeout(r, 320));
      setScanStage("verified");
      await new Promise((r) => setTimeout(r, 220));
      onSuccess(session);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Passkey verification failed. Please try again.");
      setScanStage("idle");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      aria-labelledby="paybox-auth-title"
      className="m-auto w-full max-w-sm rounded-3xl border border-purple-500/40 bg-[#110C1D] p-0 text-white shadow-[0_0_60px_rgba(168,85,247,0.35)] backdrop:bg-black/75 backdrop:backdrop-blur-md open:animate-in open:fade-in open:zoom-in-95"
    >
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#1A112D] via-[#110C1D] to-[#0B0F17] p-6">
        {/* Ambient Purple Glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 left-1/2 h-36 w-56 -translate-x-1/2 rounded-full bg-purple-600/25 blur-3xl"
        />

        {/* Top Bar */}
        <div className="relative flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-purple-300">
            <Sparkles className="h-3 w-3 text-fuchsia-400" />
            PayBox OAuth 2.1 + PKCE
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="rounded-lg border border-slate-800 bg-slate-900/70 p-1.5 text-slate-400 transition hover:border-purple-500/40 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Title & Subtitle */}
        <div className="relative mt-4 text-center">
          <h3
            id="paybox-auth-title"
            className="text-xl font-semibold tracking-tight text-white"
          >
            PayBox Authentication
          </h3>
          <p className="mt-1.5 text-xs text-slate-400">
            Use Passkey to access PayBox sCrow plugin
          </p>
        </div>

        {/* Biometric Passkey Scanner Orb */}
        <div className="relative my-6 flex flex-col items-center justify-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            {/* Outer Pulse Rings */}
            <span
              className={`absolute inset-0 rounded-full border border-purple-500/40 transition-all duration-500 ${
                isScanning
                  ? "scale-125 animate-ping border-fuchsia-400/60"
                  : "scale-100"
              }`}
            />
            <span
              className={`absolute inset-2 rounded-full border border-violet-500/30 transition-all duration-300 ${
                isScanning
                  ? "scale-110 border-purple-400/70 bg-purple-500/15"
                  : "bg-purple-950/40"
              }`}
            />

            {/* Biometric Icon Center */}
            <div
              className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all ${
                scanStage === "verified"
                  ? "border-fuchsia-400 bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white shadow-[0_0_30px_rgba(217,70,239,0.65)]"
                  : isScanning
                  ? "border-purple-400 bg-purple-600/30 text-purple-200 shadow-[0_0_28px_rgba(168,85,247,0.55)]"
                  : "border-purple-500/40 bg-[#160F29] text-purple-400 shadow-[0_0_20px_rgba(147,51,234,0.3)]"
              }`}
            >
              <Fingerprint
                className={`h-9 w-9 transition-transform duration-300 ${
                  isScanning ? "scale-110" : "scale-100"
                }`}
              />
            </div>
          </div>

          <p className="mt-3 font-mono text-[11px] text-purple-300">
            {scanStage === "prompting" &&
              "Requesting hardware passkey enclave..."}
            {scanStage === "verifying" &&
              "Exchanging PKCE S256 challenge token..."}
            {scanStage === "verified" &&
              "Passkey verified! Unlocking sCrow deck..."}
            {scanStage === "idle" &&
              "Touch ID / Face ID / WebAuthn Passkey Ready"}
          </p>
        </div>

        {/* Requested Vault Permissions */}
        <div className="space-y-2 rounded-2xl border border-purple-500/20 bg-[#0B0F17]/90 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-300">
              <KeyRound className="h-3.5 w-3.5 text-purple-400" />
              <code className="font-mono text-[11px]">wallets:sign</code>
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              Sign Anchor PDAs
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800/80 pt-2">
            <span className="flex items-center gap-2 text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5 text-fuchsia-400" />
              <code className="font-mono text-[11px]">vault:read</code>
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              Read Vault Balances
            </span>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Primary CTA Button */}
        <button
          type="button"
          onClick={handleSignInWithPasskey}
          disabled={isScanning}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_0_28px_rgba(168,85,247,0.45)] transition hover:from-purple-500 hover:via-violet-500 hover:to-fuchsia-500 disabled:opacity-60"
        >
          <Fingerprint className="h-4 w-4" />
          <span>
            {isScanning ? "Authenticating Passkey..." : "Sign in with Passkey"}
          </span>
        </button>
      </div>
    </dialog>
  );
}
