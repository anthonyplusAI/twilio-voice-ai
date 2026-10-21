"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import workshopConfig from "@/workshop.config";
import { useProgressContext } from "@/components/layout/ProgressContext";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { useAnalyticsContext } from "@/lib/AnalyticsContext";
import { countValidCompleted, totalStepCount } from "@/lib/progress-math";
import { RESET_COPY } from "@/lib/workshop-copy";
import { Home, RotateCcw } from "lucide-react";

function buildXShareUrl() {
  const x = workshopConfig.sharing?.platforms.x;
  if (!x) return null;
  const event = workshopConfig.sharing?.eventName ?? "";
  const text = x.message.replace(/\{title\}/g, workshopConfig.title).replace(/\{event\}/g, event);
  const params = new URLSearchParams({ text });
  if (workshopConfig.sharing?.shareUrl) params.set("url", workshopConfig.sharing.shareUrl);
  if (x.hashtags?.length) params.set("hashtags", x.hashtags.join(","));
  return `https://x.com/intent/tweet?${params.toString()}`;
}

function buildLinkedInShareUrl() {
  const li = workshopConfig.sharing?.platforms.linkedin;
  if (!li) return null;
  const event = workshopConfig.sharing?.eventName ?? "";
  const text = li.message.replace(/\{title\}/g, workshopConfig.title).replace(/\{event\}/g, event);
  const params = new URLSearchParams();
  if (workshopConfig.sharing?.shareUrl) params.set("url", workshopConfig.sharing.shareUrl);
  params.set("summary", text);
  params.set("title", workshopConfig.title);
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
}

export default function WorkshopComplete() {
  const { progress, loaded, resetProgress } = useProgressContext();
  const [showReset, setShowReset] = useState(false);
  const router = useRouter();
  const { emit } = useAnalyticsContext();

  const totalSteps = useMemo(
    () => totalStepCount(workshopConfig.chapters),
    [],
  );

  // Filter stored completion keys through the live config. Stale keys from a
  // prior step list would otherwise let a learner land on the completion
  // screen with gaps in the current workshop.
  const validCompleted = useMemo(
    () => countValidCompleted(progress.completedSteps, workshopConfig.chapters),
    [progress.completedSteps],
  );

  // Guard against deep-links: if someone hits /workshop/complete directly
  // without actually completing every step, bounce them back to the first
  // step they haven't finished. Without this the celebration + sharing UI
  // misrepresents their progress.
  useEffect(() => {
    if (!loaded) return;
    if (validCompleted >= totalSteps) return;
    // Find first incomplete step in config order.
    const completed = new Set(progress.completedSteps);
    for (const chapter of workshopConfig.chapters) {
      for (const step of chapter.steps) {
        const key = `chapter-${chapter.id}:step-${step.id}`;
        if (!completed.has(key)) {
          router.replace(`/workshop/${chapter.slug}/${step.slug}`);
          return;
        }
      }
    }
  }, [loaded, progress.completedSteps, validCompleted, totalSteps, router]);

  const isActuallyComplete = loaded && validCompleted >= totalSteps;

  // Small, single celebration burst on first paint — different from the
  // confetti-overlay in MilestoneBadge (that one only fires mid-workshop when
  // the final badge is earned). This page is persistent, so the burst is
  // quieter and one-shot. Gate on `isActuallyComplete` so confetti doesn't
  // fire for a half-done learner who just got redirected away.
  useEffect(() => {
    if (!isActuallyComplete) return;
    const colors =
      workshopConfig.completionCopy?.confettiColors ??
      ["#EF223A", "#F4B400", "#10B981", "#0263E0"];
    confetti({ particleCount: 100, spread: 80, origin: { x: 0.2, y: 0.4 }, colors, startVelocity: 55, ticks: 250, angle: 70 });
    confetti({ particleCount: 100, spread: 80, origin: { x: 0.8, y: 0.4 }, colors, startVelocity: 55, ticks: 250, angle: 110 });
  }, [isActuallyComplete]);

  // While loaded is false (hydrating) or the redirect is in flight, render
  // nothing so the learner doesn't see a flash of the celebration screen.
  if (!isActuallyComplete) return null;

  const xUrl = workshopConfig.sharing?.enabled ? buildXShareUrl() : null;
  const liUrl = workshopConfig.sharing?.enabled ? buildLinkedInShareUrl() : null;

  const eyebrow =
    workshopConfig.completionCopy?.eyebrow ?? "Workshop Complete";
  const headline =
    workshopConfig.completionCopy?.headline ?? "You built a Voice AI Agent.";
  const description =
    workshopConfig.completionCopy?.description ??
    "You went from zero to a working conversational agent with a custom persona, streaming responses, interrupt handling, and tool calling. That's a real, production-shaped voice application.";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center relative overflow-hidden py-16 px-6">
      {/* Ambient background glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, rgba(239, 34, 58, 0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(244, 180, 0, 0.06) 0%, transparent 50%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 max-w-2xl w-full text-center"
      >
        <div className="inline-flex items-center justify-center mb-8">
          <img
            src={workshopConfig.completionCopy?.icon ?? "/images/icons/award-badge.svg"}
            alt=""
            className="w-24 h-24 theme-icon"
            style={{ filter: `drop-shadow(0 0 40px rgba(${workshopConfig.branding.accentColorRgb},0.5))` }}
          />
        </div>

        <div className="inline-block px-3 py-1 mb-4 rounded-full border border-yellow-400/30 bg-yellow-400/10 text-yellow-400 text-xs font-mono uppercase tracking-[0.35em]">
          {eyebrow}
        </div>

        <h1 className="font-display font-extrabold text-5xl md:text-6xl text-text-primary leading-[1.05] tracking-tight mb-4">
          {headline}
        </h1>

        <p className="text-lg text-text-secondary leading-relaxed mb-10 max-w-xl mx-auto">
          {description}
        </p>

        {(xUrl || liUrl) && (
          <div className="mb-10">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">
              Share your achievement
            </div>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {xUrl && (
                <a
                  href={xUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => emit("share_clicked", { platform: "x" })}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 border border-navy-border hover:bg-surface-3 transition-all duration-200 group"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current text-text-secondary group-hover:text-text-primary transition-colors" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  <span className="text-sm font-bold text-text-secondary group-hover:text-text-primary transition-colors">
                    Post on X
                  </span>
                </a>
              )}
              {liUrl && (
                <a
                  href={liUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => emit("share_clicked", { platform: "linkedin" })}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 border border-navy-border hover:bg-surface-3 transition-all duration-200 group"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current text-text-secondary group-hover:text-[#0A66C2] transition-colors" aria-hidden="true">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                  <span className="text-sm font-bold text-text-secondary group-hover:text-text-primary transition-colors">
                    Share on LinkedIn
                  </span>
                </a>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-twilio-red text-white font-display font-extrabold text-sm shadow-[0_4px_20px_rgba(239,34,58,0.35)] hover:brightness-110 transition-all"
          >
            <Home className="w-4 h-4" />
            Back to home
          </Link>
          <button
            onClick={() => setShowReset(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-text-muted hover:text-twilio-red transition-colors text-sm"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset progress
          </button>
        </div>
      </motion.div>

      <ConfirmModal
        open={showReset}
        title={RESET_COPY.title}
        message={RESET_COPY.message}
        confirmLabel={RESET_COPY.confirmLabel}
        cancelLabel={RESET_COPY.cancelLabel}
        onConfirm={() => {
          resetProgress();
          setShowReset(false);
        }}
        onCancel={() => setShowReset(false)}
      />
    </div>
  );
}
