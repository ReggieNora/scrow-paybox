import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sCrow — Deterministic 3-Strike Solana Escrow Deck",
  description:
    "Minimalist Solana escrow dApp built for the PayBox Hackathon featuring a zero-scroll 4-card playing deck UI, deterministic 3-strike revision controls, and 100% PDA rent reclamation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="overflow-hidden bg-[#0B0F17] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
