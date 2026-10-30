"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  GitPullRequest,
  AlertTriangle,
  Check,
  RotateCcw,
  Send,
  Clock,
  UserCheck,
  Code2,
  MessageSquare,
  CornerDownRight,
  X,
  LogOut,
  ShieldCheck,
  Link2,
} from "lucide-react";
import {
  calculatePayoutBreakdown,
  EscrowAccountState,
  formatRemainingTime,
  MAX_REVISION_ATTEMPTS,
} from "@/lib/anchor";

interface Card03RevisionThreadProps {
  escrow?: EscrowAccountState | null;
  connectedWallet?: string;
  onClaimRecipient?: (recipientAddress: string) => Promise<void>;
  onSubmitWork: (submissionUrl: string) => Promise<void>;
  onReviewWork: (approved: boolean, feedback?: string) => Promise<void>;
  onResetDeck?: () => void;
  onLogout?: () => void;
}

export type ThreadRoleView = "sender" | "receiver";

export type ThreadCategory = "message" | "revision_request" | "submission";

export interface ThreadReply {
  id: string;
  senderRole: "sender" | "receiver" | "system";
  senderName: string;
  text: string;
  timestamp: string;
  replyToId?: string;
  replyToSenderName?: string;
  replyToSnippet?: string;
  replyToTimestamp?: string;
  threadPath?: string[];
  category?: ThreadCategory;
  strikeNumber?: number;
  submissionUrl?: string;
  submissionNote?: string;
  replies?: ThreadReply[];
}

export interface ReplyTarget {
  id: string;
  rootMessageId?: string;
  senderName: string;
  text: string;
  timestamp?: string;
  category?: ThreadCategory;
  strikeNumber?: number;
  threadPath?: string[];
}

export interface ThreadMessage {
  id: string;
  senderRole: "sender" | "receiver" | "system";
  senderName: string;
  text: string;
  timestamp: string;
  type?: ThreadCategory;
  /** Category inherited when replying to an older message higher up in the chat */
  replyCategory?: ThreadCategory;
  replyToId?: string;
  replyToRootId?: string;
  replyToSenderName?: string;
  replyToSnippet?: string;
  replyToTimestamp?: string;
  threadPath?: string[];
  strikeNumber?: number;
  replies?: ThreadReply[];
}

/**
 * Isolated Live Countdown Timer DOM Node
 * Encapsulates the 1000ms tick interval so that timer ticks only re-render
 * this isolated element without cascading across Card 03 or the deck.
 */
export const EscrowLiveCountdown = React.memo(function EscrowLiveCountdown({
  deadlineUnixMs,
  isTimed,
  durationLabel,
}: {
  deadlineUnixMs?: number | null;
  isTimed: boolean;
  durationLabel?: string;
}) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isTimed || !deadlineUnixMs) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimed, deadlineUnixMs]);

  if (!isTimed) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-purple-300/80">
        <Clock className="h-3 w-3 text-purple-400 shrink-0" />
        <span>Conditional · Manual Sign-Off</span>
      </span>
    );
  }

  const remainingMs = deadlineUnixMs ? Math.max(0, deadlineUnixMs - nowMs) : 0;
  const countdown = formatRemainingTime(remainingMs);

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold text-purple-100"
      title={durationLabel ? `Countdown (${durationLabel} window)` : "Countdown"}
    >
      <Clock className="h-3 w-3 text-fuchsia-400 shrink-0 animate-pulse" />
      <span className="text-[10px] font-normal uppercase tracking-wider text-slate-400">
        Timer:
      </span>
      <span className="rounded-md border border-purple-500/35 bg-purple-950/60 px-1.5 py-0.5 text-fuchsia-300 shadow-[0_0_10px_rgba(217,70,239,0.2)]">
        {countdown.formatted}
      </span>
    </span>
  );
});

export const Card03RevisionThread = React.memo(function Card03RevisionThread({
  escrow,
  connectedWallet,
  onClaimRecipient,
  onSubmitWork,
  onReviewWork,
  onResetDeck,
  onLogout,
}: Card03RevisionThreadProps) {
  const safeAmountSol = escrow?.amountSol ?? 0;
  const safeCreator =
    escrow?.creator || "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const safePdaAddress =
    escrow?.pdaAddress || "ScrowPDA11111111111111111111111111111111111";
  const safeTermsText =
    escrow?.termsText || "Deliver milestone deliverables per on-chain terms.";
  const safeAttemptsUsed = escrow?.attemptsUsed ?? 0;
  const safeEscrowState = escrow?.escrowState || "Pending";

  const breakdown = calculatePayoutBreakdown(safeAmountSol);
  const [localBoundRecipient, setLocalBoundRecipient] = useState<string>(
    () => escrow?.recipient?.trim() || ""
  );
  const effectiveRecipient =
    escrow?.recipient?.trim() || localBoundRecipient.trim() || "";
  const isUnassignedRecipient = !effectiveRecipient;

  const [roleView, setRoleView] = useState<ThreadRoleView>(() =>
    !escrow?.recipient?.trim() ? "receiver" : "sender"
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [claimWalletAddress, setClaimWalletAddress] = useState<string>(
    connectedWallet || "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
  );

  // Inline reply state (strictly inline, never launches a modal; supports any root message or nested reply)
  const [replyingToMsg, setReplyingToMsg] = useState<ReplyTarget | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const scrollToThreadNode = (targetId?: string) => {
    if (!targetId) return;
    const el = document.getElementById(`thread-node-${targetId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedNodeId(targetId);
      window.setTimeout(() => {
        setHighlightedNodeId((prev) => (prev === targetId ? null : prev));
      }, 1600);
    }
  };

  // Role-isolated modal state for formal protocol actions only
  // Buyer Modal: strictly for Strikes / Revision Requests
  // Freelancer Modal: strictly for Work Submissions
  const [isSubmissionReviewModalOpen, setIsSubmissionReviewModalOpen] = useState(false);
  const [strikeFeedback, setStrikeFeedback] = useState("");

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTargetStrike, setSubmitTargetStrike] = useState<{
    id: string;
    strikeNumber?: number;
    text: string;
    senderName?: string;
    timestamp?: string;
  } | null>(null);
  const [submitUrlInput, setSubmitUrlInput] = useState(
    escrow?.submissionUrl || "https://github.com/scrow-labs/paybox-deck/pull/42"
  );
  const [submitMessageNote, setSubmitMessageNote] = useState(
    "Implemented milestone deliverable and passed all Solana test suites."
  );

  // Seed realistic thread messages based on escrow state (clean empty state for brand-new escrows)
  const buildMessagesForEscrow = (
    currentEscrow?: EscrowAccountState | null
  ): ThreadMessage[] => {
    const hasActivity = Boolean(
      currentEscrow?.submissionUrl || (currentEscrow?.attemptsUsed ?? 0) > 0
    );
    const amount = currentEscrow?.amountSol ?? 0;
    const hasRecipient = Boolean(currentEscrow?.recipient?.trim());

    const initial: ThreadMessage[] = [
      {
        id: "msg-1",
        senderRole: "system",
        senderName: "sCrow Protocol",
        text: `Escrow PDA initialized · ${amount} SOL locked${
          !hasRecipient ? " · Claimable via Link" : ""
        }`,
        timestamp: "Yesterday, 2:00 PM",
        type: "message",
      },
      ...(hasActivity
        ? [
            {
              id: "msg-2",
              senderRole: "sender" as const,
              senderName: "Buyer",
              text: "Terms confirmed: Deliver 4-card Solana escrow UI + Anchor 3-strike contract. Looking forward to reviewing!",
              timestamp: "Yesterday, 2:15 PM",
              type: "message" as const,
              replies: [
                {
                  id: "reply-0",
                  senderRole: "receiver" as const,
                  senderName: "Freelancer",
                  text: "Understood! Setting up repo and Anchor test suites now.",
                  timestamp: "Yesterday, 2:20 PM",
                  replyToId: "msg-2",
                  replyToSenderName: "Buyer",
                  replyToSnippet:
                    "Terms confirmed: Deliver 4-card Solana escrow UI + Anchor 3-strike contract.",
                  replies: [
                    {
                      id: "reply-0-1",
                      senderRole: "sender" as const,
                      senderName: "Buyer",
                      text: "Awesome, ping me here if you need any devnet test fixtures.",
                      timestamp: "Yesterday, 2:24 PM",
                      replyToId: "reply-0",
                      replyToSenderName: "Freelancer",
                      replyToSnippet:
                        "Understood! Setting up repo and Anchor test suites now.",
                    },
                  ],
                },
              ],
            },
            {
              id: "msg-3",
              senderRole: "receiver" as const,
              senderName: "Freelancer",
              text: "Started development. Implementing Passkey OAuth 2.1 gateway and Anchor state transitions.",
              timestamp: "Yesterday, 4:30 PM",
              type: "message" as const,
            },
          ]
        : []),
      ...(currentEscrow?.submissionUrl
        ? [
            {
              id: "msg-4",
              senderRole: "receiver" as const,
              senderName: "Freelancer",
              text: `Deliverable submitted: ${currentEscrow.submissionUrl}`,
              timestamp: "Today, 10:15 AM",
              type: "submission" as const,
              replies: [
                {
                  id: "reply-sub-1",
                  senderRole: "receiver" as const,
                  senderName: "Freelancer",
                  text: "All unit tests and PDA rent reclamation assertions are passing on devnet.",
                  timestamp: "Today, 10:16 AM",
                  replyToId: "msg-4",
                  replyToSenderName: "Freelancer",
                  replyToSnippet: `Deliverable submitted: ${currentEscrow.submissionUrl}`,
                  category: "submission" as const,
                },
              ],
            },
          ]
        : []),
      ...((currentEscrow?.attemptsUsed ?? 0) > 0
        ? [
            {
              id: "msg-5",
              senderRole: "sender" as const,
              senderName: "Buyer",
              text: `Strike 1/3 issued: "Please ensure the 0.75% protocol fee calculation matches the integer BPS on-chain logic."`,
              timestamp: "Today, 10:45 AM",
              type: "revision_request" as const,
              strikeNumber: 1,
              replies: [
                {
                  id: "reply-1",
                  senderRole: "receiver" as const,
                  senderName: "Freelancer",
                  text: "Fixed BPS math in Anchor program tests. Updated PR branch with the latest commit.",
                  timestamp: "Today, 11:10 AM",
                  replyToId: "msg-5",
                  replyToSenderName: "Buyer",
                  replyToSnippet:
                    'Strike 1/3 issued: "Please ensure the 0.75% protocol fee calculation matches the integer BPS on-chain logic."',
                  category: "revision_request" as const,
                },
                ...(currentEscrow?.escrowState === "InReview"
                  ? [
                      {
                        id: "sub-revised-1",
                        senderRole: "receiver" as const,
                        senderName: "Freelancer",
                        text: `Revised deliverable submitted: ${
                          currentEscrow?.submissionUrl ||
                          "https://github.com/scrow-labs/paybox-deck/pull/42"
                        }\nNote: "All Anchor basis point calculations aligned and devnet tests passing."`,
                        timestamp: "Today, 11:20 AM",
                        replyToId: "msg-5",
                        replyToSenderName: "Buyer",
                        replyToSnippet:
                          'Strike 1/3 issued: "Please ensure the 0.75% protocol fee calculation matches the integer BPS on-chain logic."',
                        category: "submission" as const,
                        strikeNumber: 1,
                        submissionUrl:
                          currentEscrow?.submissionUrl ||
                          "https://github.com/scrow-labs/paybox-deck/pull/42",
                        replies: [],
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
    ];
    return initial;
  };

  const [messages, setMessages] = useState<ThreadMessage[]>(() =>
    buildMessagesForEscrow(escrow)
  );

  // Reset thread and recipient state cleanly when a new escrow PDA is initialized or recipient changes
  useEffect(() => {
    const incomingRecipient = escrow?.recipient?.trim() || "";
    setLocalBoundRecipient(incomingRecipient);
    setMessages(buildMessagesForEscrow(escrow));
    if (!incomingRecipient) {
      setRoleView("receiver");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escrow?.pdaAddress, escrow?.recipient]);

  useEffect(() => {
    if (connectedWallet?.trim()) {
      setClaimWalletAddress(connectedWallet.trim());
    }
  }, [connectedWallet]);

  const handleConfirmBindRecipient = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetWallet =
      claimWalletAddress?.trim() ||
      connectedWallet?.trim() ||
      "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

    setBusyAction("claim");
    try {
      setLocalBoundRecipient(targetWallet);
      if (onClaimRecipient) {
        await onClaimRecipient(targetWallet);
      }
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setMessages((prev) => [
        ...(prev || []),
        {
          id: `msg-claim-${Date.now()}`,
          senderRole: "system",
          senderName: "sCrow Protocol",
          text: `Recipient wallet ${targetWallet.slice(0, 4)}...${targetWallet.slice(
            -4
          )} bound to Escrow PDA · Chat initialized`,
          timestamp: timeStr,
          type: "message",
        },
      ]);
      setRoleView("receiver");
    } finally {
      setBusyAction(null);
    }
  };

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat thread to bottom on message or settlement state changes
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, [messages, safeEscrowState, isUnassignedRecipient]);

  /**
   * 1. Inline Reply Handler (Swipe-to-Reply on Mobile/Touch OR Inline Reply Icon on Desktop)
   * Works on ANY root message, strike, submission, or nested sub-reply at any depth.
   */
  const handleInlineReply = (target: ReplyTarget) => {
    if (isCompleted) return;
    setReplyingToMsg({
      id: target.id,
      rootMessageId: target.rootMessageId || target.id,
      senderName: target.senderName,
      text: target.text,
      timestamp: target.timestamp,
      category: target.category || "message",
      threadPath: target.threadPath,
    });
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  };

  /**
   * 2. Formal Action Handler (Second Minimal Action Icon on Desktop / Header Trigger)
   * Strictly opens the role-specific protocol modal:
   * - Buyer: Strike / Revision Request modal
   * - Freelancer: Work Submission modal
   */
  const handleFormalActionClick = () => {
    if (isCompleted) return;
    if (roleView === "sender") {
      setStrikeFeedback("");
      setIsSubmissionReviewModalOpen(true);
    } else {
      openSubmitModal();
    }
  };

  /**
   * Recursively insert a reply under any matching reply node in a nested sub-thread tree
   */
  const insertReplyIntoSubTree = (
    nodes: ThreadReply[] | undefined,
    targetId: string,
    rootCategory: ThreadCategory,
    parentThreadPath: string[],
    createReplyForParent: (
      parent: {
        id: string;
        senderName: string;
        text: string;
        timestamp?: string;
      },
      category: ThreadCategory,
      path: string[]
    ) => ThreadReply
  ): { updated: ThreadReply[] | undefined; found: boolean } => {
    if (!nodes || nodes.length === 0) {
      return { updated: nodes, found: false };
    }

    let foundInLevel = false;
    const nextNodes = nodes.map((node) => {
      const effectiveCategory = node.category || rootCategory;
      const nodePath =
        node.threadPath && node.threadPath.length > 0
          ? node.threadPath
          : [...parentThreadPath, `@${node.senderName}`];
      if (node.id === targetId) {
        foundInLevel = true;
        const created = createReplyForParent(node, effectiveCategory, nodePath);
        return {
          ...node,
          replies: [...(node.replies || []), created],
        };
      }
      if (node.replies && node.replies.length > 0) {
        const childResult = insertReplyIntoSubTree(
          node.replies,
          targetId,
          effectiveCategory,
          nodePath,
          createReplyForParent
        );
        if (childResult.found) {
          foundInLevel = true;
          return {
            ...node,
            replies: childResult.updated,
          };
        }
      }
      return node;
    });

    return { updated: nextNodes, found: foundInLevel };
  };

  /**
   * Check whether a target ID belongs to a given reply subtree
   */
  const containsReplyNodeId = (
    nodes: ThreadReply[] | undefined,
    targetId: string
  ): boolean => {
    if (!nodes || nodes.length === 0) return false;
    for (const node of nodes) {
      if (node.id === targetId) return true;
      if (containsReplyNodeId(node.replies, targetId)) return true;
    }
    return false;
  };

  /**
   * Build the base thread path label array for a root message
   */
  const getRootThreadPath = (msg: ThreadMessage): string[] => {
    if (msg.type === "revision_request") {
      return [`Strike ${msg.strikeNumber || 1}/3`, `@${msg.senderName}`];
    }
    if (msg.type === "submission") {
      return ["Deliverable Proof", `@${msg.senderName}`];
    }
    if (msg.threadPath && msg.threadPath.length > 0) {
      return [...msg.threadPath, `@${msg.senderName}`];
    }
    return [`@${msg.senderName}`];
  };

  /**
   * Hybrid Thread & Reply Positioning Handler:
   * 1. Direct Thread Attachment: When replying to the current/latest item at the bottom of the stream
   *    (such as an active strike, submission, or the latest message/sub-thread), the reply nests directly
   *    beneath that parent item with matching color-coded connector lines.
   * 2. Strict Chronological Main Stream with Quote-Backs: When replying to an older message or card higher up
   *    in the chat (where newer messages exist below it), the reply appends at the bottom of the primary feed
   *    with a clear quote-preview pill, thread path breadcrumb, and matching color-coded connector lines.
   */
  const handleAddReply = (target: ReplyTarget, replyContent: string) => {
    const text = replyContent.trim();
    if (!text) return;

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const createReplyForParent = (
      parent: {
        id: string;
        senderName: string;
        text: string;
        timestamp?: string;
      },
      category: ThreadCategory,
      path: string[]
    ): ThreadReply => ({
      id: `reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderRole: roleView,
      senderName: roleView === "sender" ? "Buyer" : "Freelancer",
      text,
      timestamp: timeStr,
      replyToId: parent.id,
      replyToSenderName: parent.senderName,
      replyToSnippet: parent.text,
      replyToTimestamp: parent.timestamp,
      threadPath: path,
      category,
      replies: [],
    });

    setMessages((prev) => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const rootIndex = safePrev.findIndex(
        (m) =>
          m &&
          (m.id === target.id ||
            m.id === target.rootMessageId ||
            containsReplyNodeId(m.replies, target.id))
      );

      // Find the index of the latest non-system message in the stream
      let lastNonSystemIndex = safePrev.length - 1;
      while (
        lastNonSystemIndex >= 0 &&
        safePrev[lastNonSystemIndex]?.senderRole === "system"
      ) {
        lastNonSystemIndex--;
      }

      const isOlderMessageHigherUp =
        rootIndex !== -1 && rootIndex < lastNonSystemIndex;

      // Rule 2: Replying to an older message higher up in the chat ->
      // Keep the primary stream strictly chronological by appending at the bottom with Quote-Preview Pill & Thread Path
      if (isOlderMessageHigherUp) {
        const rootMsg = safePrev[rootIndex];
        const inheritedCategory: ThreadCategory =
          target.category ||
          rootMsg?.replyCategory ||
          rootMsg?.type ||
          "message";
        const resolvedThreadPath =
          target.threadPath && target.threadPath.length > 0
            ? target.threadPath
            : rootMsg
            ? getRootThreadPath(rootMsg)
            : [`@${target.senderName}`];

        const quoteBackMsg: ThreadMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          senderRole: roleView,
          senderName: roleView === "sender" ? "Buyer" : "Freelancer",
          text,
          timestamp: timeStr,
          type: "message",
          replyCategory: inheritedCategory,
          replyToId: target.id,
          replyToRootId: rootMsg?.id || target.rootMessageId || target.id,
          replyToSenderName: target.senderName,
          replyToSnippet: target.text,
          replyToTimestamp: target.timestamp || rootMsg?.timestamp,
          threadPath: resolvedThreadPath,
          replies: [],
        };

        return [...safePrev, quoteBackMsg];
      }

      // Rule 1: Replying to the active/latest item -> Attach directly beneath the parent item
      return safePrev.map((msg) => {
        const rootCat: ThreadCategory =
          msg.replyCategory || msg.type || "message";
        const baseRootPath = getRootThreadPath(msg);
        if (msg.id === target.id) {
          const created = createReplyForParent(msg, rootCat, baseRootPath);
          return {
            ...msg,
            replies: [...(msg.replies || []), created],
          };
        }
        const subResult = insertReplyIntoSubTree(
          msg.replies,
          target.id,
          rootCat,
          baseRootPath,
          createReplyForParent
        );
        if (subResult.found) {
          return {
            ...msg,
            replies: subResult.updated,
          };
        }
        return msg;
      });
    });
  };

  const attemptsRemaining = Math.max(
    0,
    MAX_REVISION_ATTEMPTS - safeAttemptsUsed
  );
  const isFinalStrikeWarning = safeAttemptsUsed === 2;

  // Determine lifecycle step: 1 (Funded) -> 2 (In Progress) -> 3 (Review) -> 4 (Completed)
  const isCompleted =
    safeEscrowState === "Released" || safeEscrowState === "Refunded";
  const isInReview = !isCompleted && safeEscrowState === "InReview";
  const isRevisionRequested =
    !isCompleted && safeEscrowState === "RevisionRequested";
  const isLockedInReview = isInReview;
  const canSubmitWork =
    !isCompleted &&
    !isUnassignedRecipient &&
    (safeEscrowState === "Pending" ||
      safeEscrowState === "RevisionRequested");

  const currentStep: 1 | 2 | 3 | 4 = isCompleted
    ? 4
    : isInReview
    ? 3
    : 2;

  /**
   * Helper to open the Work Submission modal, binding to an active strike if available
   */
  const openSubmitModal = (target?: {
    id: string;
    strikeNumber?: number;
    text: string;
    senderName?: string;
    timestamp?: string;
  } | null) => {
    if (target && target.id) {
      setSubmitTargetStrike({
        id: target.id,
        strikeNumber: target.strikeNumber,
        text: target.text,
        senderName: target.senderName || "Buyer",
        timestamp: target.timestamp,
      });
    } else {
      const currentMsgs = Array.isArray(messages) ? messages : [];
      const latestStrike = [...currentMsgs]
        .reverse()
        .find((m) => m?.type === "revision_request");
      if (latestStrike && (isRevisionRequested || safeAttemptsUsed > 0)) {
        setSubmitTargetStrike({
          id: latestStrike.id,
          strikeNumber: latestStrike.strikeNumber,
          text: latestStrike.text,
          senderName: latestStrike.senderName || "Buyer",
          timestamp: latestStrike.timestamp,
        });
      } else {
        setSubmitTargetStrike(null);
      }
    }
    setIsSubmitModalOpen(true);
  };

  /**
   * Formal Work Submission Modal Handler (Freelancer Only)
   * Links work submissions directly as replies/responses to active strikes when submitted during a revision phase.
   */
  const handleConfirmSubmitWithModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = submitUrlInput.trim();
    if (!url) return;
    setBusyAction("submit");
    try {
      await onSubmitWork(url);
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const currentMsgs = Array.isArray(messages) ? messages : [];
      const latestStrike = [...currentMsgs]
        .reverse()
        .find((m) => m?.type === "revision_request");
      const targetStrike =
        submitTargetStrike ||
        (isRevisionRequested || safeAttemptsUsed > 0 ? latestStrike : null);

      const submissionText = targetStrike
        ? submitMessageNote.trim()
          ? `Revised deliverable submitted: ${url}\nNote: "${submitMessageNote.trim()}"`
          : `Revised deliverable submitted: ${url}`
        : submitMessageNote.trim()
        ? `Deliverable submitted: ${url}\nNote: "${submitMessageNote.trim()}"`
        : `Deliverable submitted: ${url}`;

      if (targetStrike) {
        // Strike-to-Submission Thread Binding: Nest directly underneath the target strike block
        const strikeSnippet =
          targetStrike.text ||
          (targetStrike.strikeNumber
            ? `Strike ${targetStrike.strikeNumber}/3 issued`
            : "Strike revision request");

        const newSubmissionReply: ThreadReply = {
          id: `sub-${Date.now()}`,
          senderRole: "receiver",
          senderName: "Freelancer",
          text: submissionText,
          timestamp: timeStr,
          replyToId: targetStrike.id,
          replyToSenderName: targetStrike.senderName || "Buyer",
          replyToSnippet: strikeSnippet,
          replyToTimestamp: targetStrike.timestamp,
          threadPath: [
            targetStrike.strikeNumber
              ? `Strike ${targetStrike.strikeNumber}/3`
              : "Strike Request",
            `@${targetStrike.senderName || "Buyer"}`,
          ],
          category: "submission",
          strikeNumber: targetStrike.strikeNumber,
          submissionUrl: url,
          submissionNote: submitMessageNote.trim() || undefined,
          replies: [],
        };

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id === targetStrike.id) {
              return {
                ...msg,
                replies: [...(msg.replies || []), newSubmissionReply],
              };
            }
            return msg;
          })
        );
      } else {
        // Initial formal submission (no active strike)
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            senderRole: "receiver",
            senderName: "Freelancer",
            text: submissionText,
            timestamp: timeStr,
            type: "submission",
            replies: [],
          },
        ]);
      }

      setIsSubmitModalOpen(false);
      setSubmitTargetStrike(null);
      // Switch to Sender (Buyer) view so buyer can review proof
      setRoleView("sender");
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * Formal Strike/Revision Modal Handler (Buyer Only)
   */
  const handleConfirmStrikeWithModal = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction("revision");
    try {
      const note =
        strikeFeedback.trim() ||
        "Please review deliverables and address required fixes.";
      await onReviewWork(false, note);
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const nextStrike = safeAttemptsUsed + 1;
      setMessages((prev) => [
        ...(prev || []),
        {
          id: `msg-${Date.now()}`,
          senderRole: "sender",
          senderName: "Buyer",
          text:
            nextStrike >= 3
              ? `Strike 3/3 reached. 100% creator refund triggered.\nReview Note: "${note}"`
              : `Strike ${nextStrike}/3 issued: "${note}"`,
          timestamp: timeStr,
          type: "revision_request",
          strikeNumber: nextStrike,
        },
      ]);
      setIsSubmissionReviewModalOpen(false);
      setStrikeFeedback("");
      if (nextStrike < 3) {
        setRoleView("receiver");
      }
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * Buyer Approval & Release Handler (Anchored Inline in Card 03)
   */
  const handleApprove = async () => {
    setBusyAction("approve");
    try {
      await onReviewWork(true);
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          senderRole: "sender",
          senderName: "Buyer",
          text: "Work approved! Releasing 99.25% payout and reclaiming PDA rent.",
          timestamp: timeStr,
          type: "message",
        },
      ]);
      setIsSubmissionReviewModalOpen(false);
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * Standard Casual Chat Messaging & Inline Replies (Strictly Inline — Never Launches a Modal)
   */
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputMessage.trim();
    if (!text) return;

    if (replyingToMsg) {
      handleAddReply(replyingToMsg, text);
      setReplyingToMsg(null);
      setInputMessage("");
      return;
    }

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const newMsg: ThreadMessage = {
      id: `msg-${Date.now()}`,
      senderRole: roleView,
      senderName: roleView === "sender" ? "Buyer" : "Freelancer",
      text,
      timestamp: timeStr,
      type: "message",
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputMessage("");
  };

  /**
   * Universal Standard Reply Action + Isolated Milestone Protocol Actions:
   * - Every message and nested reply receives a consistent, universal Reply button.
   * - Conditional protocol actions (Approve for work submissions, Strike for revision requests)
   *   are strictly isolated to formal root milestone items (`milestoneType`).
   * - General chat bubbles and nested replies NEVER display conditional protocol buttons.
   */
  const renderDesktopActionIcons = (
    target: ReplyTarget,
    milestoneType?: "submission" | "revision_request"
  ) => {
    if (isCompleted) return null;
    const isBeingRepliedTo = replyingToMsg?.id === target.id;

    return (
      <div
        className={`hidden sm:inline-flex items-center gap-1 transition-opacity duration-150 shrink-0 ${
          isBeingRepliedTo
            ? "opacity-100"
            : "opacity-0 group-hover/bubble:opacity-100 focus-within:opacity-100"
        }`}
      >
        {/* 1. Universal Standard Reply Button (Consistent across all messages & replies) */}
        <button
          type="button"
          onClick={() => handleInlineReply(target)}
          title={`Reply to ${target.senderName}`}
          aria-label={`Reply to ${target.senderName}`}
          className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-200 ease-out hover:scale-110 active:scale-95 ${
            isBeingRepliedTo
              ? "border-purple-400 bg-purple-600/45 text-white shadow-[0_0_8px_rgba(168,85,247,0.5)]"
              : "border-purple-500/35 bg-[#120D20]/90 text-purple-300 hover:border-purple-400/65 hover:bg-purple-600/30 hover:text-white"
          }`}
        >
          <CornerDownRight className="h-2.5 w-2.5" />
        </button>

        {/* 2. Isolated Conditional Protocol Actions — Strictly on Formal Milestones Only */}
        {milestoneType === "submission" && roleView === "sender" && (
          <>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleApprove}
              title="Approve Deliverable & Release Payout"
              aria-label="Approve Deliverable & Release Payout"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/45 bg-emerald-950/60 text-emerald-300 transition-all duration-200 ease-out hover:scale-110 hover:border-emerald-400 hover:bg-emerald-600/35 hover:text-white hover:shadow-[0_0_8px_rgba(16,185,129,0.45)] active:scale-95 disabled:opacity-40"
            >
              <Check className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setStrikeFeedback("");
                setIsSubmissionReviewModalOpen(true);
              }}
              title="Issue Strike / Revision Request"
              aria-label="Issue Strike / Revision Request"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-amber-500/40 bg-amber-950/55 text-amber-300 transition-all duration-200 ease-out hover:scale-110 hover:border-amber-400 hover:bg-amber-600/30 hover:text-white hover:shadow-[0_0_8px_rgba(245,158,11,0.4)] active:scale-95"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
            </button>
          </>
        )}

        {milestoneType === "revision_request" && roleView === "sender" && (
          <button
            type="button"
            onClick={() => {
              setStrikeFeedback("");
              setIsSubmissionReviewModalOpen(true);
            }}
            title="Issue Strike / Revision Request"
            aria-label="Issue Strike / Revision Request"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-amber-500/40 bg-amber-950/55 text-amber-300 transition-all duration-200 ease-out hover:scale-110 hover:border-amber-400 hover:bg-amber-600/30 hover:text-white hover:shadow-[0_0_8px_rgba(245,158,11,0.4)] active:scale-95"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
          </button>
        )}

        {milestoneType === "revision_request" &&
          roleView === "receiver" &&
          canSubmitWork && (
            <button
              type="button"
              onClick={() => openSubmitModal(target)}
              title="Submit Revised Deliverable"
              aria-label="Submit Revised Deliverable"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-teal-500/40 bg-teal-950/55 text-teal-300 transition-all duration-200 ease-out hover:scale-110 hover:border-teal-400 hover:bg-teal-600/30 hover:text-white hover:shadow-[0_0_8px_rgba(20,184,166,0.4)] active:scale-95"
            >
              <GitPullRequest className="h-2.5 w-2.5" />
            </button>
          )}
      </div>
    );
  };

  /**
   * Render Recursive Multi-Level Sub-Thread with Direct Thread Attachment,
   * Category-Coordinated Leading Connector Lines & Quote Previews
   */
  const renderSubThread = (
    replies: ThreadReply[] | undefined,
    anchorRight: boolean,
    parentContext: ReplyTarget,
    threadCategory: ThreadCategory = "message",
    depth: number = 1
  ): React.ReactNode => {
    if (!replies || replies.length === 0) return null;

    // Color-coordinate the leading connector rail to match the parent action category
    const railBorderColor =
      threadCategory === "submission"
        ? depth === 1
          ? "border-teal-500/55"
          : "border-teal-400/40"
        : threadCategory === "revision_request"
        ? depth === 1
          ? "border-amber-500/55"
          : "border-orange-400/40"
        : depth === 1
        ? "border-purple-500/45"
        : "border-purple-400/35";

    const leadingTickColor =
      threadCategory === "submission"
        ? "bg-teal-400/65"
        : threadCategory === "revision_request"
        ? "bg-amber-400/65"
        : "bg-purple-400/55";

    // Keep all replies in a sub-thread anchored to the same side as their parent card
    // so the vertical rail and horizontal ticks attach directly to every reply bubble.
    const indentClass =
      depth <= 3
        ? anchorRight
          ? `mr-2.5 items-end border-r-2 ${railBorderColor} pr-2.5`
          : `ml-2.5 items-start border-l-2 ${railBorderColor} pl-2.5`
        : anchorRight
        ? `mr-1.5 items-end border-r-2 ${railBorderColor} pr-1.5`
        : `ml-1.5 items-start border-l-2 ${railBorderColor} pl-1.5`;

    const padOffset = depth <= 3 ? "2.5" : "1.5";

    return (
      <div
        className={`relative mt-1 flex w-full flex-col space-y-1.5 ${indentClass}`}
      >
        {/* Vertical Bridge Stem directly attaching the Sub-Thread Rail to the Parent Card */}
        {depth === 1 && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute -top-3.5 h-3.5 w-[2px] ${leadingTickColor} ${
              anchorRight ? "-right-[2px]" : "-left-[2px]"
            }`}
          />
        )}

        {replies.map((reply) => {
          const isOwnReply = reply.senderRole === roleView;
          const effectiveCat = reply.category || threadCategory;
          const quotedSender =
            reply.replyToSenderName || parentContext.senderName;
          const quotedSnippet = reply.replyToSnippet || parentContext.text;
          const isSelectedTarget = replyingToMsg?.id === reply.id;
          const isHighlighted = highlightedNodeId === reply.id;

          const baseParentPath =
            parentContext.threadPath && parentContext.threadPath.length > 0
              ? parentContext.threadPath
              : [`@${parentContext.senderName}`];
          const resolvedReplyPath =
            reply.threadPath && reply.threadPath.length > 0
              ? reply.threadPath
              : [...baseParentPath, `@${reply.senderName}`];

          const replyTargetWithCategory: ReplyTarget = {
            id: reply.id,
            rootMessageId: parentContext.rootMessageId || parentContext.id,
            senderName: reply.senderName,
            text: reply.text,
            timestamp: reply.timestamp,
            category: effectiveCat,
            threadPath: resolvedReplyPath,
          };

          const selectedRingClass =
            effectiveCat === "submission"
              ? "ring-1 ring-teal-400/85"
              : effectiveCat === "revision_request"
              ? "ring-1 ring-amber-400/85"
              : "ring-1 ring-purple-400/85";

          const replyBubbleTheme =
            effectiveCat === "submission"
              ? isOwnReply
                ? "border border-teal-400/45 bg-teal-900/40 text-teal-50 shadow-[0_2px_10px_rgba(20,184,166,0.14)]"
                : "border border-teal-500/35 bg-[#0A191B]/95 text-teal-50"
              : effectiveCat === "revision_request"
              ? isOwnReply
                ? "border border-amber-400/45 bg-amber-900/40 text-amber-50 shadow-[0_2px_10px_rgba(245,158,11,0.14)]"
                : "border border-amber-500/35 bg-[#1B130B]/95 text-amber-50"
              : isOwnReply
              ? "border border-purple-400/40 bg-purple-600/35 text-purple-50"
              : "border border-purple-500/25 bg-[#161125] text-slate-200";

          const quoteBarTheme =
            effectiveCat === "submission"
              ? "border-teal-400/80 bg-teal-950/65 text-teal-200/95 hover:bg-teal-900/60"
              : effectiveCat === "revision_request"
              ? "border-amber-400/80 bg-amber-950/65 text-amber-200/95 hover:bg-amber-900/60"
              : isOwnReply
              ? "border-purple-300/75 bg-purple-950/60 text-purple-200/95 hover:bg-purple-900/60"
              : "border-purple-400/65 bg-black/40 text-slate-300 hover:bg-purple-950/45";

          const quoteIconAndSenderColor =
            effectiveCat === "submission"
              ? "text-teal-300"
              : effectiveCat === "revision_request"
              ? "text-amber-300"
              : "text-purple-300";

          return (
            <div
              key={reply.id}
              id={`thread-node-${reply.id}`}
              className={`relative flex w-full flex-col ${
                anchorRight ? "items-end" : "items-start"
              }`}
            >
              {/* Horizontal Leading Connector Tick Directly Linking Parent Rail to Reply Bubble */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-3.5 h-[2px] w-2.5 ${leadingTickColor} ${
                  anchorRight
                    ? padOffset === "2.5"
                      ? "-right-2.5"
                      : "-right-1.5"
                    : padOffset === "2.5"
                    ? "-left-2.5"
                    : "-left-1.5"
                }`}
              />

              <motion.div
                initial={{ opacity: 0, y: 5, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                drag={isCompleted ? false : "x"}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.25}
                onDragEnd={(_, info) => {
                  if (Math.abs(info.offset.x) > 32) {
                    handleInlineReply(replyTargetWithCategory);
                  }
                }}
                className={`group/bubble flex w-full items-center gap-1.5 touch-pan-y ${
                  anchorRight ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {effectiveCat === "submission" ? (
                  <div
                    className={`max-w-[88%] rounded-2xl border border-teal-500/45 bg-gradient-to-br from-teal-950/45 to-emerald-950/30 px-3 py-2 text-left font-mono text-[10px] text-teal-50 shadow-[0_2px_14px_rgba(20,184,166,0.14)] transition-all duration-200 ease-out hover:scale-[1.01] hover:border-teal-400/65 ${
                      anchorRight ? "rounded-br-xs" : "rounded-bl-xs"
                    } ${
                      isSelectedTarget || isHighlighted
                        ? "ring-1 ring-teal-400/85"
                        : ""
                    }`}
                  >
                    {/* Explicit Amber Quote-Preview Bar Referencing Parent Strike */}
                    <button
                      type="button"
                      onClick={() =>
                        scrollToThreadNode(reply.replyToId || parentContext.id)
                      }
                      title="Jump to strike message"
                      className="mb-1.5 flex w-full items-center gap-1.5 rounded-md border-l-2 border-amber-400/90 bg-amber-950/60 px-2 py-1 text-left font-mono text-[8.5px] text-amber-200/95 transition hover:bg-amber-900/60"
                    >
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-400" />
                      <span className="shrink-0 font-semibold text-amber-300">
                        @{quotedSender}
                        {reply.strikeNumber ? ` (Strike ${reply.strikeNumber}/3)` : ""}:
                      </span>
                      <span className="truncate opacity-90">{quotedSnippet}</span>
                    </button>

                    <div className="flex items-center justify-between gap-2 border-b border-teal-500/20 pb-1 mb-1">
                      <div className="flex items-center gap-1 font-semibold text-teal-300">
                        <GitPullRequest className="h-3 w-3 shrink-0 text-teal-400" />
                        <span>Revised Deliverable Proof</span>
                      </div>
                      {!isCompleted && roleView === "sender" && isLockedInReview && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={handleApprove}
                            className="inline-flex items-center gap-0.5 rounded-md border border-emerald-400/50 bg-emerald-600/35 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-emerald-100 transition hover:bg-emerald-600/55 disabled:opacity-40"
                          >
                            <Check className="h-2 w-2 text-emerald-300" />
                            <span>{busyAction === "approve" ? "..." : "Approve"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStrikeFeedback("");
                              setIsSubmissionReviewModalOpen(true);
                            }}
                            className="inline-flex items-center gap-0.5 rounded-md border border-amber-400/50 bg-amber-600/30 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-amber-100 transition hover:bg-amber-600/50"
                          >
                            <AlertTriangle className="h-2 w-2 text-amber-300" />
                            <span>Strike</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <p className="whitespace-pre-wrap leading-relaxed text-teal-50/95">
                      {reply.text}
                    </p>
                  </div>
                ) : (
                  <div
                    className={`max-w-[90%] rounded-2xl px-2.5 py-1.5 text-[10px] leading-snug whitespace-pre-wrap transition-all duration-200 ease-out hover:scale-[1.01] ${
                      anchorRight ? "rounded-br-xs" : "rounded-bl-xs"
                    } ${
                      isSelectedTarget || isHighlighted ? selectedRingClass : ""
                    } ${replyBubbleTheme}`}
                  >
                    {/* Clickable Nested Quote-Preview Pill & Thread Path Context */}
                    <button
                      type="button"
                      onClick={() =>
                        scrollToThreadNode(reply.replyToId || parentContext.id)
                      }
                      title="Jump to parent message"
                      className={`mb-1 flex w-full items-center gap-1 rounded-md border-l-2 px-1.5 py-0.5 text-left font-mono text-[8.5px] transition ${quoteBarTheme}`}
                    >
                      <CornerDownRight
                        className={`h-2 w-2 shrink-0 ${quoteIconAndSenderColor}`}
                      />
                      <span
                        className={`shrink-0 font-semibold ${quoteIconAndSenderColor}`}
                      >
                        @{quotedSender}:
                      </span>
                      <span className="truncate opacity-85">{quotedSnippet}</span>
                    </button>

                    <div>{reply.text}</div>
                  </div>
                )}

                {renderDesktopActionIcons(
                  replyTargetWithCategory,
                  effectiveCat === "submission" ? "submission" : undefined
                )}
              </motion.div>

              <div className="mt-0.5 flex items-center gap-1.5 px-1 font-mono text-[8.5px] text-slate-500/80">
                <span className={quoteIconAndSenderColor}>
                  {reply.senderName}
                  {isOwnReply ? " (You)" : ""}
                </span>
                <span>·</span>
                <span>{reply.timestamp}</span>
                {!isCompleted && (
                  <button
                    type="button"
                    onClick={() => handleInlineReply(replyTargetWithCategory)}
                    className={`inline-flex items-center gap-0.5 transition ${
                      effectiveCat === "submission"
                        ? "text-teal-400/85 hover:text-teal-200"
                        : "text-purple-400/85 hover:text-purple-200"
                    }`}
                  >
                    <CornerDownRight className="h-2 w-2" />
                    <span>Reply</span>
                  </button>
                )}
              </div>

              {/* Recursively render deeper nested sub-replies anchored to the parent rail */}
              {renderSubThread(
                reply.replies,
                anchorRight,
                replyTargetWithCategory,
                effectiveCat,
                depth + 1
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const safeMessages = Array.isArray(messages) ? messages : [];
  const userMessagesCount = safeMessages.filter(
    (m) => m?.senderRole && m.senderRole !== "system"
  ).length;

  return (
    <div
      style={{ contain: "layout size style" }}
      className="relative flex h-full flex-col justify-between overflow-hidden [contain:layout_size_style]"
    >
      {/* 1. STREAMLINED TOP HEADER: Wallet Connection, Role Switcher & Sign-Out */}
      <div className="shrink-0">
        <div className="flex h-6 items-center justify-between">
          <div className="inline-flex h-6 items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-950/30 px-2.5 font-mono text-[10px] text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.18)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
            <span className="font-semibold text-emerald-400">Connected</span>
            <span className="text-slate-300">
              {safeCreator.slice(0, 4)}...{safeCreator.slice(-4)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Compact Demo Role Switcher */}
            <div className="flex items-center rounded-lg border border-purple-500/25 bg-[#0B0F17]/90 p-0.5 font-mono text-[10px]">
              <button
                type="button"
                onClick={() => setRoleView("sender")}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] ${
                  roleView === "sender"
                    ? "border border-purple-400/40 bg-purple-600/35 font-semibold text-white shadow-[0_0_10px_rgba(168,85,247,0.35)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Test view as Buyer"
              >
                <UserCheck className="h-3 w-3 text-purple-300" />
                <span>Buyer</span>
              </button>

              <button
                type="button"
                onClick={() => setRoleView("receiver")}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] ${
                  roleView === "receiver"
                    ? "border border-purple-400/40 bg-purple-600/35 font-semibold text-white shadow-[0_0_10px_rgba(168,85,247,0.35)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Test view as Freelancer"
              >
                <Code2 className="h-3 w-3 text-fuchsia-300" />
                <span>Freelancer</span>
              </button>
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

        {/* 2. COMPACT ELEVATED WORKFLOW TIMELINE SUB-PANEL */}
        <div className="relative mt-2 overflow-hidden rounded-xl border border-purple-500/45 bg-[#05030A]/95 px-3 py-2 shadow-[inset_0_2px_16px_rgba(0,0,0,0.9),0_0_24px_rgba(168,85,247,0.2)]">
          {/* Intense Ambient Neon Glow Cast by Active Milestone */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 left-1/2 h-16 w-4/5 -translate-x-1/2 rounded-full bg-gradient-to-r from-purple-600/25 via-fuchsia-500/35 to-pink-500/25 blur-2xl"
          />

          {/* Compact Top Status Row Inside Timeline Sub-Panel (Timer + Strikes) */}
          <div className="relative z-10 mb-1.5 flex items-center justify-between">
            <div className="flex items-center">
              {isCompleted ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold text-emerald-300">
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span>Escrow {safeEscrowState}</span>
                </span>
              ) : (
                <EscrowLiveCountdown
                  deadlineUnixMs={escrow?.deadlineUnixMs}
                  isTimed={Boolean(escrow?.isTimed)}
                  durationLabel={escrow?.durationLabel}
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1" title="3-Strike Revision Meter">
                {[1, 2, 3].map((strikeIndex) => {
                  const active = safeAttemptsUsed >= strikeIndex;
                  return (
                    <span
                      key={strikeIndex}
                      className={`h-1.5 w-3 rounded-full transition-colors ${
                        active
                          ? strikeIndex === 3
                            ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]"
                            : "bg-fuchsia-500 shadow-[0_0_6px_rgba(217,70,239,0.6)]"
                          : "bg-slate-800"
                      }`}
                    />
                  );
                })}
              </div>
              <span
                className={`font-mono text-[10px] font-semibold ${
                  isFinalStrikeWarning
                    ? "text-amber-300"
                    : safeAttemptsUsed >= 3
                    ? "text-red-300"
                    : "text-purple-300"
                }`}
              >
                Strikes {safeAttemptsUsed}/{MAX_REVISION_ATTEMPTS}
              </span>
            </div>
          </div>

          {/* Streamlined Horizontal Stepped Progress Track */}
          <div className="relative z-10 flex items-center justify-between">
            {/* Step 1: Funded */}
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-400/70 bg-purple-600/40 text-purple-100 shadow-[0_0_12px_rgba(168,85,247,0.5)]">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
              <span className="font-mono text-[10px] font-semibold text-purple-200">
                Funded
              </span>
            </div>

            {/* Thick Connector Line 1 */}
            <div className="mx-1.5 h-1.5 flex-1 rounded-full border border-purple-500/20 bg-[#130C20] p-[1px]">
              <div
                className={`h-full w-full rounded-full transition-all duration-500 ${
                  currentStep >= 2
                    ? "bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 shadow-[0_0_10px_rgba(217,70,239,0.85)]"
                    : "bg-transparent"
                }`}
              />
            </div>

            {/* Step 2: In Progress */}
            <div className="flex items-center gap-1.5">
              {currentStep === 2 ? (
                <>
                  <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-fuchsia-300 bg-gradient-to-br from-fuchsia-500 via-purple-600 to-pink-500 text-white ring-2 ring-fuchsia-500/40 shadow-[0_0_18px_rgba(217,70,239,0.95)]">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-50" />
                    <span className="relative h-2 w-2 rounded-full bg-white shadow-[0_0_6px_#fff]" />
                  </span>
                  <span className="font-mono text-[10px] font-bold text-fuchsia-300 drop-shadow-[0_0_8px_rgba(217,70,239,0.85)]">
                    {isRevisionRequested
                      ? `Revising (${safeAttemptsUsed}/3)`
                      : isUnassignedRecipient
                      ? "Awaiting Claim"
                      : "In Progress"}
                  </span>
                </>
              ) : currentStep > 2 ? (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-400/70 bg-purple-600/40 text-purple-100 shadow-[0_0_12px_rgba(168,85,247,0.5)]">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-purple-200">
                    In Progress
                  </span>
                </>
              ) : (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-500/25 bg-[#120C1E] text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                  </span>
                  <span className="font-mono text-[10px] font-medium text-slate-500">
                    In Progress
                  </span>
                </>
              )}
            </div>

            {/* Thick Connector Line 2 */}
            <div className="mx-1.5 h-1.5 flex-1 rounded-full border border-purple-500/20 bg-[#130C20] p-[1px]">
              <div
                className={`h-full w-full rounded-full transition-all duration-500 ${
                  currentStep >= 3
                    ? "bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 shadow-[0_0_10px_rgba(217,70,239,0.85)]"
                    : "bg-transparent"
                }`}
              />
            </div>

            {/* Step 3: Review */}
            <div className="flex items-center gap-1.5">
              {currentStep === 3 ? (
                <>
                  <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-fuchsia-300 bg-gradient-to-br from-fuchsia-500 via-purple-600 to-pink-500 text-white ring-2 ring-fuchsia-500/40 shadow-[0_0_18px_rgba(217,70,239,0.95)]">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400 opacity-50" />
                    <span className="relative h-2 w-2 rounded-full bg-white shadow-[0_0_6px_#fff]" />
                  </span>
                  <span className="font-mono text-[10px] font-bold text-fuchsia-300 drop-shadow-[0_0_8px_rgba(217,70,239,0.85)]">
                    Review
                  </span>
                </>
              ) : currentStep > 3 ? (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-400/70 bg-purple-600/40 text-purple-100 shadow-[0_0_12px_rgba(168,85,247,0.5)]">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-purple-200">
                    Review
                  </span>
                </>
              ) : (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-500/25 bg-[#120C1E] text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                  </span>
                  <span className="font-mono text-[10px] font-medium text-slate-500">
                    Review
                  </span>
                </>
              )}
            </div>

            {/* Thick Connector Line 3 */}
            <div className="mx-1.5 h-1.5 flex-1 rounded-full border border-purple-500/20 bg-[#130C20] p-[1px]">
              <div
                className={`h-full w-full rounded-full transition-all duration-500 ${
                  currentStep >= 4
                    ? "bg-gradient-to-r from-fuchsia-500 via-purple-500 to-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]"
                    : "bg-transparent"
                }`}
              />
            </div>

            {/* Step 4: Completed */}
            <div className="flex items-center gap-1.5">
              {currentStep === 4 ? (
                <>
                  <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300 bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-2 ring-emerald-500/40 shadow-[0_0_18px_rgba(52,211,153,0.9)]">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                  <span className="font-mono text-[10px] font-bold text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]">
                    {safeEscrowState === "Refunded"
                      ? "Refunded"
                      : "Completed"}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-500/25 bg-[#120C1E] text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                  </span>
                  <span className="font-mono text-[10px] font-medium text-slate-500">
                    Completed
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Strike 3 Warning Alert Banner */}
        {isFinalStrikeWarning && (
          <div
            role="alert"
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10.5px] text-amber-200"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="truncate">
              <strong className="text-amber-300">Strike 3 Warning:</strong> Next strike triggers 100% creator refund.
            </span>
          </div>
        )}
      </div>

      {/* 3. RECIPIENT ONBOARDING STATE (When Escrow PDA is Unassigned) OR LIVE REVISION THREAD */}
      {isUnassignedRecipient ? (
        <motion.div
          key="recipient-onboarding-view"
          initial={{ opacity: 0, scale: 0.98, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="mt-2.5 flex flex-1 min-h-0 flex-col justify-between rounded-xl border border-teal-500/35 bg-[#0B0F17]/90 p-3.5 backdrop-blur-sm shadow-[inset_0_2px_16px_rgba(0,0,0,0.85),0_0_24px_rgba(20,184,166,0.14)]"
        >
          {/* Top Claim Escrow Header & Prompt */}
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/40 bg-teal-950/50 px-2.5 py-0.5 font-mono text-[9.5px] font-semibold text-teal-200 shadow-[0_0_10px_rgba(20,184,166,0.2)]">
              <Link2 className="h-2.5 w-2.5 text-teal-300 animate-pulse" />
              <span>Unassigned Escrow PDA · Claimable via Link</span>
            </div>
            <p className="text-xs font-semibold leading-snug text-white">
              Escrow awaiting recipient claim. Connect wallet to bind address and initialize chat.
            </p>
          </div>

          {/* Escrow Terms & Connected Wallet Confirmation Box */}
          <form
            id="claim-recipient-form"
            onSubmit={handleConfirmBindRecipient}
            className="my-auto space-y-2 py-1"
          >
            <div className="rounded-xl border border-purple-500/25 bg-[#07050E]/90 p-2.5 space-y-1.5 font-mono text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Escrow PDA</span>
                <span className="text-purple-200">
                  {safePdaAddress.slice(0, 8)}...{safePdaAddress.slice(-6)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Locked / Net Payout (99.25%)</span>
                <span className="font-semibold text-emerald-300">
                  {safeAmountSol} SOL → {breakdown.recipientPayoutSol} SOL
                </span>
              </div>
              <div className="border-t border-purple-500/15 pt-1 text-[9.5px] text-slate-300 line-clamp-1">
                <span className="text-slate-500">Terms: </span>
                {safeTermsText}
              </div>
            </div>

            <div>
              <label className="block font-mono text-[9.5px] uppercase tracking-wider text-teal-300/90">
                Recipient Solana Wallet Address
              </label>
              <input
                type="text"
                value={claimWalletAddress}
                disabled={busyAction === "claim"}
                onChange={(e) => setClaimWalletAddress(e.target.value)}
                placeholder="Connect or enter Solana wallet address to claim"
                className="mt-1 w-full rounded-xl border border-teal-500/35 bg-[#07050E] px-3 py-1.5 font-mono text-[11px] text-white placeholder:text-slate-600 transition-all duration-200 focus:border-teal-400 focus:shadow-[0_0_12px_rgba(20,184,166,0.2)] focus:outline-none disabled:opacity-60"
              />
            </div>
          </form>

          {/* Primary Action Button: Claim & Connect Wallet */}
          <div className="pt-1 shrink-0">
            <button
              type="submit"
              form="claim-recipient-form"
              disabled={busyAction === "claim"}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-500 px-4 font-mono text-xs font-semibold text-white shadow-[0_0_20px_rgba(20,184,166,0.4)] transition-all duration-200 ease-out hover:scale-[1.02] hover:from-teal-500 hover:to-emerald-400 hover:shadow-[0_0_28px_rgba(20,184,166,0.6)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>
                {busyAction === "claim"
                  ? "Binding Wallet & Initializing Chat..."
                  : "Claim & Connect Wallet"}
              </span>
            </button>
          </div>
        </motion.div>
      ) : (
      <motion.div
        key="live-revision-thread-view"
        initial={{ opacity: 0, scale: 0.98, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="mt-2.5 flex flex-1 min-h-0 flex-col rounded-xl border border-purple-500/25 bg-[#0B0F17]/75 backdrop-blur-sm overflow-hidden"
      >
        {/* Scrollable iMessage-Style Chat List (Collapses cleanly when empty) */}
        <div
          ref={messagesContainerRef}
          className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5 text-xs scrollbar-thin"
        >
          {safeMessages.map((msg, index) => {
            if (!msg) return null;
            const isSystem = msg?.senderRole === "system";

            // 1. Clean System Dividers
            if (isSystem) {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="my-1 flex items-center gap-2 px-1"
                >
                  <div className="h-px flex-1 bg-purple-500/15" />
                  <span className="shrink-0 font-mono text-[9px] tracking-tight text-slate-500">
                    {msg.text}
                  </span>
                  <div className="h-px flex-1 bg-purple-500/15" />
                </motion.div>
              );
            }

            const isOwnMessage = msg.senderRole === roleView;
            const prevMsg = safeMessages[index - 1];
            const nextMsg = safeMessages[index + 1];
            const isFirstInGroup =
              !prevMsg ||
              prevMsg?.senderRole === "system" ||
              prevMsg?.senderRole !== msg.senderRole;
            const isLastInGroup =
              !nextMsg ||
              nextMsg?.senderRole === "system" ||
              nextMsg?.senderRole !== msg.senderRole;

            const isSelectedRootTarget = replyingToMsg?.id === msg.id;
            const isHighlightedRoot = highlightedNodeId === msg.id;
            const rootCategory: ThreadCategory =
              msg.replyCategory || msg.type || "message";
            const rootThreadPath = getRootThreadPath(msg);
            const rootTarget: ReplyTarget = {
              id: msg.id,
              rootMessageId: msg.id,
              senderName: msg.senderName,
              text: msg.text,
              timestamp: msg.timestamp,
              category: rootCategory,
              threadPath: rootThreadPath,
            };

            // 2. Strike / Revision Request Bubble (Warning / Amber-Orange Accent)
            if (msg.type === "revision_request") {
              return (
                <motion.div
                  key={msg.id}
                  id={`thread-node-${msg.id}`}
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={`flex flex-col ${
                    isOwnMessage ? "items-end" : "items-start"
                  }`}
                >
                  {!isOwnMessage && isFirstInGroup && (
                    <span className="mb-0.5 px-1 font-mono text-[9px] font-medium text-amber-400/95">
                      {msg.senderName}
                    </span>
                  )}
                  <motion.div
                    drag={isCompleted ? false : "x"}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.25}
                    onDragEnd={(_, info) => {
                      if (Math.abs(info.offset.x) > 32) {
                        handleInlineReply(rootTarget);
                      }
                    }}
                    className={`group/bubble flex w-full items-center gap-1.5 touch-pan-y ${
                      isOwnMessage ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl border border-amber-500/50 bg-gradient-to-br from-amber-950/45 to-orange-950/30 px-3 py-1.5 text-left font-mono text-[10px] text-amber-50 shadow-[0_2px_14px_rgba(245,158,11,0.14)] transition-all duration-200 ease-out hover:scale-[1.01] hover:border-amber-400/65 ${
                        isSelectedRootTarget || isHighlightedRoot
                          ? "ring-1 ring-amber-400/85"
                          : ""
                      } ${isOwnMessage ? "rounded-br-xs" : "rounded-bl-xs"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 font-semibold text-amber-300">
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                          <span>Strike {msg.strikeNumber || 1}/3</span>
                        </div>
                        {!isCompleted && roleView === "sender" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setStrikeFeedback("");
                              setIsSubmissionReviewModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-600/30 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-amber-100 transition hover:bg-amber-600/50"
                          >
                            <AlertTriangle className="h-2 w-2 text-amber-300" />
                            <span>Strike ({safeAttemptsUsed + 1}/3)</span>
                          </button>
                        ) : !isCompleted && roleView === "receiver" && canSubmitWork ? (
                          <button
                            type="button"
                            onClick={() => openSubmitModal(rootTarget)}
                            className="inline-flex items-center gap-1 rounded-md border border-teal-400/50 bg-teal-600/30 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-teal-100 transition hover:bg-teal-600/50"
                          >
                            <GitPullRequest className="h-2 w-2 text-teal-300" />
                            <span>Submit Revision</span>
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-amber-100/95">
                        {msg.text}
                      </p>
                    </div>
                    {renderDesktopActionIcons(rootTarget, "revision_request")}
                  </motion.div>
                  <div className="mt-0.5 flex items-center gap-1.5 px-1 font-mono text-[8.5px] text-slate-500/80">
                    {isLastInGroup && <span>{msg.timestamp}</span>}
                    {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => handleInlineReply(rootTarget)}
                        className="inline-flex items-center gap-0.5 text-amber-400/85 transition hover:text-amber-200"
                      >
                        <CornerDownRight className="h-2 w-2" />
                        <span>Reply</span>
                      </button>
                    )}
                  </div>
                  {renderSubThread(
                    msg.replies,
                    isOwnMessage,
                    rootTarget,
                    "revision_request",
                    1
                  )}
                </motion.div>
              );
            }

            // 3. Deliverable Submission Bubble (Success / Teal Accent)
            if (msg.type === "submission") {
              return (
                <motion.div
                  key={msg.id}
                  id={`thread-node-${msg.id}`}
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={`flex flex-col ${
                    isOwnMessage ? "items-end" : "items-start"
                  }`}
                >
                  {!isOwnMessage && isFirstInGroup && (
                    <span className="mb-0.5 px-1 font-mono text-[9px] font-medium text-teal-300/95">
                      {msg.senderName}
                    </span>
                  )}
                  <motion.div
                    drag={isCompleted ? false : "x"}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.25}
                    onDragEnd={(_, info) => {
                      if (Math.abs(info.offset.x) > 32) {
                        handleInlineReply(rootTarget);
                      }
                    }}
                    className={`group/bubble flex w-full items-center gap-1.5 touch-pan-y ${
                      isOwnMessage ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl border border-teal-500/45 bg-gradient-to-br from-teal-950/45 to-emerald-950/30 px-3 py-1.5 text-left font-mono text-[10px] text-teal-50 shadow-[0_2px_14px_rgba(20,184,166,0.14)] transition-all duration-200 ease-out hover:scale-[1.01] hover:border-teal-400/65 ${
                        isSelectedRootTarget || isHighlightedRoot
                          ? "ring-1 ring-teal-400/85"
                          : ""
                      } ${isOwnMessage ? "rounded-br-xs" : "rounded-bl-xs"}`}
                    >
                      {/* Explicit Amber Quote-Preview Bar Referencing Parent Strike */}
                      {(msg.replyToId || msg.replyToSnippet) && (
                        <button
                          type="button"
                          onClick={() =>
                            scrollToThreadNode(msg.replyToId || msg.replyToRootId)
                          }
                          title="Jump to strike message"
                          className="mb-1.5 flex w-full items-center gap-1.5 rounded-md border-l-2 border-amber-400/90 bg-amber-950/60 px-2 py-1 text-left font-mono text-[8.5px] text-amber-200/95 transition hover:bg-amber-900/60"
                        >
                          <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-400" />
                          <span className="shrink-0 font-semibold text-amber-300">
                            @{msg.replyToSenderName || "Buyer"}
                            {msg.strikeNumber ? ` (Strike ${msg.strikeNumber}/3)` : ""}:
                          </span>
                          <span className="truncate opacity-90">
                            {msg.replyToSnippet}
                          </span>
                        </button>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 font-semibold text-teal-300">
                          <GitPullRequest className="h-3 w-3 shrink-0 text-teal-400" />
                          <span>
                            {msg.replyToId ? "Revised Deliverable Proof" : "Deliverable Proof"}
                          </span>
                        </div>
                        {!isCompleted && roleView === "sender" && isLockedInReview && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={handleApprove}
                              className="inline-flex items-center gap-0.5 rounded-md border border-emerald-400/50 bg-emerald-600/35 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-emerald-100 transition hover:bg-emerald-600/55 disabled:opacity-40"
                            >
                              <Check className="h-2 w-2 text-emerald-300" />
                              <span>{busyAction === "approve" ? "..." : "Approve"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setStrikeFeedback("");
                                setIsSubmissionReviewModalOpen(true);
                              }}
                              className="inline-flex items-center gap-0.5 rounded-md border border-amber-400/50 bg-amber-600/30 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-amber-100 transition hover:bg-amber-600/50"
                            >
                              <AlertTriangle className="h-2 w-2 text-amber-300" />
                              <span>Strike</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-teal-50/95">
                        {msg.text}
                      </p>
                    </div>
                    {renderDesktopActionIcons(rootTarget, "submission")}
                  </motion.div>
                  <div className="mt-0.5 flex items-center gap-1.5 px-1 font-mono text-[8.5px] text-slate-500/80">
                    {isLastInGroup && <span>{msg.timestamp}</span>}
                    {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => handleInlineReply(rootTarget)}
                        className="inline-flex items-center gap-0.5 text-teal-400/85 transition hover:text-teal-200"
                      >
                        <CornerDownRight className="h-2 w-2" />
                        <span>Reply</span>
                      </button>
                    )}
                  </div>
                  {renderSubThread(
                    msg.replies,
                    isOwnMessage,
                    rootTarget,
                    "submission",
                    1
                  )}
                </motion.div>
              );
            }

            // 4. Standard iMessage Chat Bubble OR Chronological Quote-Back Bubble at Bottom of Stream
            const isQuoteBack = Boolean(msg.replyToId);
            const quoteCategory: ThreadCategory =
              msg.replyCategory || "message";
            const quotePathText =
              msg.threadPath && msg.threadPath.length > 0
                ? msg.threadPath.join(" › ")
                : `@${msg.replyToSenderName || "Thread"}`;

            const quoteBackRailBorder =
              quoteCategory === "submission"
                ? "border-teal-500/55"
                : quoteCategory === "revision_request"
                ? "border-amber-500/55"
                : "border-purple-500/45";

            const quoteBackTickBg =
              quoteCategory === "submission"
                ? "bg-teal-400/65"
                : quoteCategory === "revision_request"
                ? "bg-amber-400/65"
                : "bg-purple-400/55";

            const quoteBackPillTheme =
              quoteCategory === "submission"
                ? "border-teal-500/40 bg-teal-950/60 text-teal-200 hover:border-teal-400/70"
                : quoteCategory === "revision_request"
                ? "border-amber-500/40 bg-amber-950/60 text-amber-200 hover:border-amber-400/70"
                : "border-purple-500/35 bg-purple-950/55 text-purple-200 hover:border-purple-400/65";

            const quoteBackBubbleTheme = isQuoteBack
              ? quoteCategory === "submission"
                ? isOwnMessage
                  ? "rounded-br-xs border border-teal-400/45 bg-teal-900/40 text-teal-50 shadow-[0_2px_12px_rgba(20,184,166,0.16)]"
                  : "rounded-bl-xs border border-teal-500/35 bg-[#0A191B]/95 text-teal-50"
                : quoteCategory === "revision_request"
                ? isOwnMessage
                  ? "rounded-br-xs border border-amber-400/45 bg-amber-900/40 text-amber-50 shadow-[0_2px_12px_rgba(245,158,11,0.16)]"
                  : "rounded-bl-xs border border-amber-500/35 bg-[#1B130B]/95 text-amber-50"
                : isOwnMessage
                ? "rounded-br-xs border border-purple-400/40 bg-gradient-to-br from-purple-600/50 via-violet-600/45 to-fuchsia-600/40 text-white shadow-[0_2px_10px_rgba(168,85,247,0.2)]"
                : "rounded-bl-xs border border-purple-500/25 bg-[#151024]/95 text-slate-100"
              : isOwnMessage
              ? "rounded-br-xs border border-purple-400/40 bg-gradient-to-br from-purple-600/50 via-violet-600/45 to-fuchsia-600/40 text-white shadow-[0_2px_10px_rgba(168,85,247,0.2)] hover:border-purple-300/60"
              : "rounded-bl-xs border border-purple-500/20 bg-[#151024]/95 text-slate-100 hover:border-purple-400/40";

            const quoteBackInnerBarTheme =
              quoteCategory === "submission"
                ? "border-teal-400/80 bg-teal-950/65 text-teal-200/95 hover:bg-teal-900/60"
                : quoteCategory === "revision_request"
                ? "border-amber-400/80 bg-amber-950/65 text-amber-200/95 hover:bg-amber-900/60"
                : "border-purple-300/75 bg-purple-950/60 text-purple-200/95 hover:bg-purple-900/60";

            const quoteBackAccentText =
              quoteCategory === "submission"
                ? "text-teal-300"
                : quoteCategory === "revision_request"
                ? "text-amber-300"
                : "text-purple-300";

            const selectedRootRing =
              quoteCategory === "submission"
                ? "ring-1 ring-teal-400/85"
                : quoteCategory === "revision_request"
                ? "ring-1 ring-amber-400/85"
                : "ring-1 ring-purple-400/85";

            return (
              <motion.div
                key={msg.id}
                id={`thread-node-${msg.id}`}
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={`flex flex-col ${
                  isOwnMessage ? "items-end" : "items-start"
                }`}
              >
                {!isOwnMessage && isFirstInGroup && !isQuoteBack && (
                  <span className="mb-0.5 px-1 font-mono text-[9px] font-medium text-slate-400">
                    {msg.senderName}
                  </span>
                )}

                {/* Thread Path Context Pill when Replying to an Older Message Higher Up in the Chat */}
                {isQuoteBack && (
                  <button
                    type="button"
                    onClick={() =>
                      scrollToThreadNode(msg.replyToId || msg.replyToRootId)
                    }
                    title="Jump to earlier message in thread"
                    className={`mb-1 inline-flex max-w-[88%] items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[8.5px] transition ${quoteBackPillTheme}`}
                  >
                    <CornerDownRight
                      className={`h-2.5 w-2.5 shrink-0 ${quoteBackAccentText}`}
                    />
                    <span className={`font-semibold ${quoteBackAccentText}`}>
                      Thread:
                    </span>
                    <span className="truncate">{quotePathText}</span>
                    {msg.replyToTimestamp && (
                      <span className="shrink-0 opacity-70">
                        · {msg.replyToTimestamp}
                      </span>
                    )}
                  </button>
                )}

                <div
                  className={`relative flex w-full flex-col ${
                    isQuoteBack
                      ? isOwnMessage
                        ? `mr-1 items-end border-r-2 ${quoteBackRailBorder} pr-2.5`
                        : `ml-1 items-start border-l-2 ${quoteBackRailBorder} pl-2.5`
                      : isOwnMessage
                      ? "items-end"
                      : "items-start"
                  }`}
                >
                  {isQuoteBack && (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute top-3.5 h-[2px] w-2.5 ${quoteBackTickBg} ${
                        isOwnMessage ? "-right-2.5" : "-left-2.5"
                      }`}
                    />
                  )}

                  <motion.div
                    drag={isCompleted ? false : "x"}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.25}
                    onDragEnd={(_, info) => {
                      if (Math.abs(info.offset.x) > 32) {
                        handleInlineReply(rootTarget);
                      }
                    }}
                    className={`group/bubble flex w-full items-center gap-1.5 touch-pan-y ${
                      isOwnMessage ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[11px] leading-snug transition-all duration-200 ease-out hover:scale-[1.01] ${
                        isSelectedRootTarget || isHighlightedRoot
                          ? selectedRootRing
                          : ""
                      } ${quoteBackBubbleTheme}`}
                    >
                      {/* Quote-Preview Pill inside Chronological Quote-Back Bubble */}
                      {isQuoteBack && (
                        <button
                          type="button"
                          onClick={() =>
                            scrollToThreadNode(msg.replyToId || msg.replyToRootId)
                          }
                          title="Jump to quoted message"
                          className={`mb-1 flex w-full items-center gap-1 rounded-md border-l-2 px-1.5 py-0.5 text-left font-mono text-[8.5px] transition ${quoteBackInnerBarTheme}`}
                        >
                          <CornerDownRight
                            className={`h-2 w-2 shrink-0 ${quoteBackAccentText}`}
                          />
                          <span
                            className={`shrink-0 font-semibold ${quoteBackAccentText}`}
                          >
                            @{msg.replyToSenderName}:
                          </span>
                          <span className="truncate opacity-85">
                            {msg.replyToSnippet}
                          </span>
                        </button>
                      )}
                      <div>{msg.text}</div>
                    </div>
                    {renderDesktopActionIcons(rootTarget)}
                  </motion.div>
                </div>

                <div className="mt-0.5 flex items-center gap-1.5 px-1 font-mono text-[8.5px] text-slate-500/80">
                  {isQuoteBack && (
                    <span className={quoteBackAccentText}>
                      {msg.senderName}
                      {isOwnMessage ? " (You)" : ""} ·
                    </span>
                  )}
                  {(isLastInGroup || isQuoteBack) && <span>{msg.timestamp}</span>}
                  {!isCompleted && (
                    <button
                      type="button"
                      onClick={() => handleInlineReply(rootTarget)}
                      className="inline-flex items-center gap-0.5 text-purple-400/85 transition hover:text-purple-200"
                    >
                      <CornerDownRight className="h-2 w-2" />
                      <span>Reply</span>
                    </button>
                  )}
                </div>

                {renderSubThread(
                  msg.replies,
                  isOwnMessage,
                  rootTarget,
                  rootCategory,
                  1
                )}
              </motion.div>
            );
          })}

          {/* Minimal Collapsed Prompt When No User Messages Exist Yet */}
          {userMessagesCount === 0 && !isCompleted && (
            <div className="flex h-24 flex-col items-center justify-center gap-2 text-center">
              <p className="font-mono text-[10px] text-slate-500">
                No revision notes yet — send a message below or{" "}
                {roleView === "receiver"
                  ? "submit your deliverable."
                  : "await deliverable proof."}
              </p>
              {roleView === "receiver" && canSubmitWork && (
                <button
                  type="button"
                  onClick={() => openSubmitModal()}
                  className="inline-flex items-center gap-1 rounded-lg border border-teal-400/45 bg-teal-600/25 px-2.5 py-1 font-mono text-[9.5px] font-semibold text-teal-100 shadow-[0_0_12px_rgba(20,184,166,0.2)] transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-teal-600/45 active:scale-[0.98]"
                >
                  <GitPullRequest className="h-2.5 w-2.5 text-teal-300" />
                  <span>Submit Work</span>
                </button>
              )}
            </div>
          )}

          {/* Expanded Inline Settlement Breakdown Summary (Rendered in Card 03 upon Completion) */}
          {isCompleted && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`mt-2 rounded-2xl border p-3 font-mono text-[10.5px] shadow-[0_0_24px_rgba(16,185,129,0.12)] ${
                safeEscrowState === "Refunded"
                  ? "border-amber-500/40 bg-amber-950/25 text-amber-100"
                  : "border-emerald-500/40 bg-emerald-950/25 text-emerald-100"
              }`}
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                <span className="flex items-center gap-1.5 font-semibold text-white">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span>
                    {safeEscrowState === "Refunded"
                      ? "3-Strike Refund Executed"
                      : "Escrow Settled & Released"}
                  </span>
                </span>
                <span className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-300">
                  PDA Closed
                </span>
              </div>

              <div className="mt-2 space-y-1">
                {safeEscrowState === "Refunded" ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Creator Refund (100%):</span>
                    <span className="font-semibold text-amber-300">
                      +{breakdown.totalSol} SOL
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">Recipient Payout (99.25%):</span>
                      <span className="font-semibold text-emerald-300">
                        +{breakdown.recipientPayoutSol} SOL
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Protocol Fee (0.75%):</span>
                      <span>{breakdown.protocolFeeSol} SOL</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between border-t border-white/10 pt-1 text-purple-200">
                  <span>PDA Rent Reclaimed (100%):</span>
                  <span className="font-semibold text-purple-300">
                    +{breakdown.reclaimedRentSol} SOL
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Bottom Bar: Category-Coordinated Inline Reply Banner + Freeform Chat Input */}
        {isCompleted ? (
          <div className="flex h-10 shrink-0 items-center justify-between border-t border-emerald-500/20 bg-[#080B11]/95 px-3">
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                {safeEscrowState === "Refunded"
                  ? "100% Principal + Rent Refunded"
                  : `Released ${breakdown.recipientPayoutSol} SOL + Rent`}
              </span>
            </span>
            {onResetDeck && (
              <button
                type="button"
                onClick={onResetDeck}
                className="inline-flex items-center gap-1 rounded-lg border border-purple-400/45 bg-gradient-to-r from-purple-600/40 to-fuchsia-600/35 px-2.5 py-1 font-mono text-[10px] font-semibold text-white shadow-[0_0_12px_rgba(168,85,247,0.3)] transition hover:from-purple-500/60 hover:to-fuchsia-500/50"
              >
                <RotateCcw className="h-3 w-3" />
                <span>New Escrow</span>
              </button>
            )}
          </div>
        ) : (
          <div className="shrink-0 border-t border-purple-500/15 bg-[#080B11]/95">
            {replyingToMsg && (
              <div
                className={`flex items-center justify-between gap-2 border-b px-2.5 py-1 font-mono text-[9.5px] ${
                  replyingToMsg.category === "submission"
                    ? "border-teal-500/25 bg-teal-950/35 text-teal-200"
                    : replyingToMsg.category === "revision_request"
                    ? "border-amber-500/25 bg-amber-950/35 text-amber-200"
                    : "border-purple-500/15 bg-purple-950/35 text-purple-200"
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <CornerDownRight
                    className={`h-2.5 w-2.5 shrink-0 ${
                      replyingToMsg.category === "submission"
                        ? "text-teal-400"
                        : replyingToMsg.category === "revision_request"
                        ? "text-amber-400"
                        : "text-purple-400"
                    }`}
                  />
                  <span
                    className={`shrink-0 font-semibold ${
                      replyingToMsg.category === "submission"
                        ? "text-teal-300"
                        : replyingToMsg.category === "revision_request"
                        ? "text-amber-300"
                        : "text-purple-300"
                    }`}
                  >
                    Replying to {replyingToMsg.senderName}:
                  </span>
                  <span className="truncate text-slate-400">
                    {replyingToMsg.text}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMsg(null)}
                  title="Cancel inline reply"
                  className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
            <form
              onSubmit={handleSendMessage}
              className="flex h-9 items-center gap-1.5 p-1"
            >
              <input
                ref={chatInputRef}
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={
                  replyingToMsg
                    ? `Reply inline to ${replyingToMsg.senderName}...`
                    : `Message as ${roleView === "sender" ? "Buyer" : "Freelancer"}...`
                }
                className="flex-1 rounded-lg border border-purple-500/25 bg-[#110C1D] px-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
              />
              {roleView === "receiver" && canSubmitWork && (
                <button
                  type="button"
                  onClick={() => openSubmitModal()}
                  title={
                    isRevisionRequested
                      ? "Submit Revised Deliverable"
                      : "Submit Deliverable Proof"
                  }
                  className="inline-flex items-center justify-center rounded-lg border border-teal-500/40 bg-teal-950/60 p-1.5 text-teal-300 transition-all duration-200 ease-out hover:scale-105 hover:border-teal-400 hover:bg-teal-600/35 hover:text-white active:scale-95"
                >
                  <GitPullRequest className="h-3 w-3" />
                </button>
              )}
              <button
                type="submit"
                disabled={!inputMessage.trim()}
                title={replyingToMsg ? "Send Inline Reply" : "Send Message"}
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 p-1.5 text-white shadow-[0_0_10px_rgba(168,85,247,0.3)] transition-all duration-200 ease-out hover:scale-105 hover:from-purple-500 hover:to-fuchsia-500 hover:shadow-[0_0_16px_rgba(217,70,239,0.5)] active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
              >
                <Send className="h-3 w-3" />
              </button>
            </form>
          </div>
        )}
      </motion.div>
      )}

      {/* ============================================================== */}
      {/* BUYER FORMAL MODAL: Strictly for Strikes / Revision Requests   */}
      {/* ============================================================== */}
      {isSubmissionReviewModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex w-full flex-col rounded-2xl border border-amber-500/45 bg-[#0F0A19] p-4 shadow-[0_0_35px_rgba(245,158,11,0.22)]">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight text-white">
                    Issue Strike / Revision Request
                  </h3>
                  <p className="font-mono text-[10px] text-amber-300/90">
                    Strike {safeAttemptsUsed + 1} of {MAX_REVISION_ATTEMPTS} ·{" "}
                    {attemptsRemaining} revision{" "}
                    {attemptsRemaining === 1 ? "attempt" : "attempts"} left
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSubmissionReviewModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmStrikeWithModal}
              className="mt-3 flex flex-1 flex-col justify-between min-h-[190px]"
            >
              <div className="space-y-2.5">
                {isFinalStrikeWarning ? (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/15 p-2 text-[10.5px] leading-tight text-red-200">
                    <strong className="text-red-300">Final Strike Warning:</strong>{" "}
                    Strike 3/3 will cancel the escrow and refund 100% of the funds
                    ({safeAmountSol} SOL) to you.
                  </div>
                ) : (
                  <p className="text-[10.5px] leading-tight text-slate-300">
                    Issuing a strike formally requests a revision on-chain and
                    logs your required changes in the revision thread.
                  </p>
                )}

                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    Required Revision Feedback
                  </label>
                  <textarea
                    rows={3}
                    value={strikeFeedback}
                    onChange={(e) => setStrikeFeedback(e.target.value)}
                    placeholder="e.g. Please verify basis points math in Anchor tests and fix the 0.75% calculation..."
                    className="mt-1 w-full resize-none rounded-xl border border-amber-500/30 bg-[#0B0F17] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsSubmissionReviewModalOpen(false)}
                  className="flex h-9 w-full items-center justify-center rounded-xl border border-purple-500/25 bg-[#0B0F17] px-3 font-mono text-xs font-medium text-slate-300 transition hover:border-purple-400/50 hover:bg-purple-950/20 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null || !strikeFeedback.trim()}
                  className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-xl px-3 font-mono text-xs font-semibold text-white shadow-lg transition disabled:opacity-40 ${
                    isFinalStrikeWarning
                      ? "bg-gradient-to-r from-red-600 to-rose-600 shadow-red-500/30 hover:from-red-500 hover:to-rose-500"
                      : "bg-gradient-to-r from-amber-600 to-orange-600 shadow-amber-500/30 hover:from-amber-500 hover:to-orange-500"
                  }`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>
                    {busyAction === "revision"
                      ? "Recording Strike..."
                      : isFinalStrikeWarning
                      ? "Confirm Strike 3 (Refund)"
                      : `Confirm Strike (${safeAttemptsUsed + 1}/3)`}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* FREELANCER FORMAL MODAL: Strictly for Work Submissions (Teal)  */}
      {/* ============================================================== */}
      {isSubmitModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-3xl bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex w-full flex-col rounded-2xl border border-teal-500/45 bg-[#0F0A19] p-4 shadow-[0_0_35px_rgba(20,184,166,0.22)]">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-teal-500/40 bg-teal-500/15 text-teal-300">
                  <GitPullRequest className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight text-white">
                    {submitTargetStrike || isRevisionRequested
                      ? "Submit Revised Deliverable"
                      : "Submit Deliverable Proof"}
                  </h3>
                  <p className="font-mono text-[10px] text-teal-300/90">
                    {submitTargetStrike?.strikeNumber
                      ? `Addressing Strike ${submitTargetStrike.strikeNumber}/3`
                      : isRevisionRequested
                      ? `Addressing Strike ${safeAttemptsUsed}/3`
                      : "Formal Work Submission"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSubmitModalOpen(false);
                  setSubmitTargetStrike(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmSubmitWithModal}
              className="mt-3 flex flex-1 flex-col justify-between min-h-[190px]"
            >
              <div className="space-y-2">
                <p className="text-[10.5px] leading-tight text-slate-300">
                  Attach your deliverable proof URL and an optional release note
                  to transition the escrow into Buyer Review.
                </p>

                {submitTargetStrike && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-950/35 p-2 font-mono text-[10px] text-amber-200">
                    <div className="flex items-center gap-1 font-semibold text-amber-300">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>
                        Responding to Strike {submitTargetStrike.strikeNumber || safeAttemptsUsed}/3:
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[9.5px] opacity-85">
                      {submitTargetStrike.text}
                    </p>
                  </div>
                )}

                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    Deliverable Proof URL
                  </label>
                  <input
                    type="url"
                    value={submitUrlInput}
                    onChange={(e) => setSubmitUrlInput(e.target.value)}
                    placeholder="https://github.com/.../pull/1"
                    className="mt-1 w-full rounded-xl border border-teal-500/30 bg-[#0B0F17] px-3 py-1.5 font-mono text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    Submission Release Note
                  </label>
                  <textarea
                    rows={2}
                    value={submitMessageNote}
                    onChange={(e) => setSubmitMessageNote(e.target.value)}
                    placeholder="e.g. Implemented the requested changes, passes all unit tests..."
                    className="mt-1 w-full resize-none rounded-xl border border-teal-500/30 bg-[#0B0F17] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsSubmitModalOpen(false);
                    setSubmitTargetStrike(null);
                  }}
                  className="flex h-9 w-full items-center justify-center rounded-xl border border-purple-500/25 bg-[#0B0F17] px-3 font-mono text-xs font-medium text-slate-300 transition hover:border-purple-400/50 hover:bg-purple-950/20 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null || !submitUrlInput.trim()}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 px-3 font-mono text-xs font-semibold text-white shadow-[0_0_15px_rgba(20,184,166,0.35)] transition hover:from-teal-500 hover:to-emerald-500 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {busyAction === "submit"
                      ? "Submitting..."
                      : submitTargetStrike || isRevisionRequested
                      ? "Submit Revision"
                      : "Submit Deliverable"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});
