"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useWorkshop } from "@/lib/WorkshopContext";
import { useAudienceMode } from "@/lib/AudienceContext";
import { useProgressContext } from "./ProgressContext";
import { ConfirmModal } from "./ConfirmModal";
import { Menu, X } from "lucide-react";
import workshopConfig from "@/workshop.config";
import { SKIP_AHEAD_COPY } from "@/lib/workshop-copy";

const SKIP_UNLOCK_KEY = `workshop-${workshopConfig.id}-skip-unlock-position`;

function StepIcon({ state }: { state: "pending" | "active" | "completed" }) {
  if (state === "completed") {
    return (
      <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center shrink-0 text-success">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="w-5 h-5 rounded-full border-2 border-twilio-red flex items-center justify-center shrink-0">
        <div className="w-2 h-2 rounded-full bg-twilio-red animate-pulse-glow" />
      </div>
    );
  }
  return <div className="w-5 h-5 rounded-full border border-surface-5 shrink-0" />;
}

export function Sidebar() {
  const pathname = usePathname();
  // The /workshop/complete page renders its own full-bleed layout — no sidebar.
  if (pathname === "/workshop/complete") return null;

  // A completed navigation resets transient drawer and skip-confirmation state,
  // including when the route changes outside the sidebar or via browser history.
  return <SidebarContent key={pathname} />;
}

function SidebarContent() {
  const params = useParams();
  const router = useRouter();
  const chapterSlug = params.chapter as string | undefined;
  const stepSlug = params.step as string | undefined;
  const { config, chapters, getChapter } = useWorkshop();
  const chapter = chapterSlug ? getChapter(chapterSlug) : chapters[0];
  const { progress, completedStepsSet } = useProgressContext();
  const { isBuilder } = useAudienceMode();

  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Lock body scroll while the drawer is open so the page behind doesn't
  // scroll through the backdrop.
  useEffect(() => {
    if (!mobileOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileOpen]);

  // Flattened step list so we can reason about absolute "step position" across
  // chapters (chapter 1 step 3 vs. chapter 2 step 1). Built once per chapters
  // change and keyed by "chId:stId" for O(1) lookup instead of findIndex.
  const positionMap = useMemo(() => {
    const map = new Map<string, number>();
    let pos = 0;
    for (const c of chapters) {
      for (const s of c.steps) {
        map.set(`${c.id}:${s.id}`, pos++);
      }
    }
    return map;
  }, [chapters]);

  const positionOf = useCallback(
    (chId: number, stId: number): number =>
      positionMap.get(`${chId}:${stId}`) ?? -1,
    [positionMap]
  );

  // The furthest step the learner has completed (−1 if nothing complete yet).
  const maxCompletedPosition = useMemo(
    () =>
      progress.completedSteps.reduce((max, key) => {
        const m = key.match(/^chapter-(\d+):step-(\d+)$/);
        if (!m || !m[1] || !m[2]) return max;
        const chId = Number(m[1]);
        const stId = Number(m[2]);
        if (!Number.isFinite(chId) || !Number.isFinite(stId)) return max;
        const pos = positionOf(chId, stId);
        return pos > max ? pos : max;
      }, -1),
    [progress.completedSteps, positionOf]
  );

  const currentPosition =
    chapter && stepSlug
      ? positionOf(
          chapter.id,
          chapter.steps.find((s) => s.slug === stepSlug)?.id ?? -1
        )
      : -1;

  function handleStepClick(
    e: React.MouseEvent,
    targetChapterId: number,
    targetStepId: number,
    href: string
  ) {
    const targetPos = positionOf(targetChapterId, targetStepId);
    // Allowed without confirm: backward nav, same step, or "next-available" step
    // (one past their furthest completion, or one past where they currently are).
    const maxAllowed = Math.max(maxCompletedPosition + 1, currentPosition);
    if (targetPos <= maxAllowed) return;

    // Shared session-scoped unlock with StepContent: if the learner already
    // confirmed a skip to a position ≥ this target in this session, don't
    // re-prompt. Prevents modal fatigue when navigating around ahead-of-progress
    // steps they've already unlocked.
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(SKIP_UNLOCK_KEY);
        const unlocked = stored ? parseInt(stored, 10) : -1;
        if (Number.isFinite(unlocked) && targetPos <= unlocked) return;
      } catch {
        // ignore and show the modal
      }
    }

    e.preventDefault();
    setPendingHref(href);
  }

  // Not memoized — React Compiler auto-memoizes where useful, and the function
  // captures live state (pendingHref) that changes per click anyway.
  function confirmSkipAhead() {
    if (!pendingHref) return;
    // Persist the unlock so the learner isn't re-prompted in this session.
    // Derive the target position from the href we queued.
    const match = pendingHref.match(/^\/workshop\/([^/]+)\/([^/]+)$/);
    if (match && match[1] && match[2]) {
      const chap = chapters.find((c) => c.slug === match[1]);
      const step = chap?.steps.find((s) => s.slug === match[2]);
      if (chap && step && typeof window !== "undefined") {
        try {
          const pos = positionOf(chap.id, step.id);
          const stored = sessionStorage.getItem(SKIP_UNLOCK_KEY);
          const prev = stored ? parseInt(stored, 10) : -1;
          if (pos >= 0 && (!Number.isFinite(prev) || pos > prev)) {
            sessionStorage.setItem(SKIP_UNLOCK_KEY, String(pos));
          }
        } catch {
          // storage disabled — still navigate
        }
      }
    }
    router.push(pendingHref);
    setPendingHref(null);
  }

  if (!chapter) return null;

  const sidebarConfig = config.sidebar;

  const body = (
    <>
      {/* Chapter title */}
      <div className="p-5 pb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-mono text-twilio-red uppercase tracking-wider mb-1">
            Chapter {chapter.id}
          </div>
          <h2 className="font-display font-extrabold text-lg text-text-primary">
            {chapter.title}
          </h2>
          <p className="text-xs text-text-muted mt-1">{chapter.subtitle}</p>
        </div>
        {/* Close button only shows inside the mobile drawer */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
          className="md:hidden shrink-0 w-9 h-9 rounded-lg bg-surface-2 border border-navy-border flex items-center justify-center text-text-secondary hover:text-text-primary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="h-px bg-navy-border mx-4" />

      {/* Step navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-0.5">
        {chapter.steps.map((step) => {
          const isActive = step.slug === stepSlug;
          const isCompleted = completedStepsSet.has(
            `chapter-${chapter.id}:step-${step.id}`
          );
          const state = isCompleted ? "completed" : isActive ? "active" : "pending";

          const href = `/workshop/${chapter.slug}/${step.slug}`;
          return (
            <Link
              key={step.id}
              href={href}
              onClick={(e) => handleStepClick(e, chapter.id, step.id, href)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150
                ${
                  isActive
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
                }
              `}
            >
              <StepIcon state={state} />
              <span className="font-bold">{step.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="h-px bg-navy-border mx-4" />

      {/* Agent profile widget */}
      {sidebarConfig.widget === "custom" && sidebarConfig.fields && (
        <div className="p-4">
          <div className="rounded-xl bg-gradient-to-b from-surface-2 to-surface-1 border border-twilio-red/20 p-4 relative overflow-hidden">
            {/* Accent glow */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-twilio-red/40 to-transparent" />

            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-twilio-red/15 flex items-center justify-center text-twilio-red">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div className="text-xs font-display font-extrabold text-text-primary uppercase tracking-wider">
                {sidebarConfig.title || "Workshop State"}
              </div>
            </div>

            <div className="space-y-2.5 text-sm">
              {isBuilder ? (
                <p className="text-xs text-text-muted leading-relaxed">
                  Your agent settings live in your Codespace code. Save your edits,
                  then use your tunnel URL in Call Me to hear them on the next call.
                </p>
              ) : sidebarConfig.fields.map((field) => {
                const userVal = progress.workshopState[field.key];
                // Explorer settings are stored here; Builder settings live in
                // their Codespace and cannot be read by this app.
                let val: string | undefined;
                let isDefault = false;
                if (field.key === "_handoff") {
                  const toggled = progress.workshopState.handoffEnabled === "true";
                  val = toggled ? "On" : "Off";
                  isDefault = !toggled;
                } else if (field.key === "enabledTools") {
                  const BUILTIN_TOOL_COUNT = 3;
                  if (userVal !== undefined) {
                    const count = userVal
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean).length;
                    val = `${count} / ${BUILTIN_TOOL_COUNT}`;
                  } else {
                    // All tools start on until the Explorer changes the picker.
                    val = `${BUILTIN_TOOL_COUNT} / ${BUILTIN_TOOL_COUNT}`;
                    isDefault = true;
                  }
                } else if (field.key === "voiceLabel") {
                  const label = progress.workshopState.voiceLabel?.trim();
                  const provider = progress.workshopState.ttsProvider?.trim();
                  if (label && provider) {
                    val = `${label} (${provider})`;
                    isDefault = false;
                  } else if (label) {
                    val = label;
                    isDefault = false;
                  } else {
                    val = undefined;
                  }
                } else {
                  val = userVal || undefined;
                }

                return (
                  <div key={field.key} className="flex justify-between items-center">
                    <span className="text-text-muted text-xs">{field.label}</span>
                    <span className={`font-mono text-xs px-2 py-0.5 rounded-md ${
                      val
                        ? isDefault
                          ? "bg-surface-1 text-text-muted border border-navy-border"
                          : "bg-twilio-red/10 text-twilio-red border border-twilio-red/20"
                        : "bg-surface-1 text-text-muted border border-navy-border"
                    }`}>
                      {val || "\u2014"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Badges */}
            {progress.badges.length > 0 && (
              <div className="mt-3 pt-3 border-t border-navy-border">
                <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Badges</div>
                <div className="flex flex-wrap gap-2">
                  {progress.badges.map((badge) => {
                    const ch = chapters.find((c) => `chapter-${c.id}` === badge);
                    if (!ch) return null;
                    return (
                      <div
                        key={badge}
                        className="w-7 h-7 rounded-lg bg-surface-3 border border-surface-4 flex items-center justify-center"
                        title={ch.badgeName}
                      >
                        {ch.badgeIcon.startsWith("/") ? (
                          <img src={ch.badgeIcon} alt="" className="w-4 h-4 theme-icon" />
                        ) : (
                          <span className="text-sm">{ch.badgeIcon}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </>
  );

  return (
    <>
      {/* Mobile trigger — fixed so it sits above scrolling content. Hidden on
          md+ where the persistent sidebar takes over. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open chapter steps"
        aria-expanded={mobileOpen}
        className="md:hidden fixed bottom-20 left-4 z-40 w-12 h-12 rounded-full bg-twilio-red text-white shadow-[0_8px_24px_rgba(239,34,58,0.4)] flex items-center justify-center hover:brightness-110 active:scale-95 transition-all"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-72 border-r border-navy-border bg-navy/50 flex-col shrink-0 overflow-hidden">
        {body}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Chapter steps"
            aria-modal="true"
            className="absolute inset-y-0 left-0 w-[85%] max-w-xs border-r border-navy-border bg-navy flex flex-col shadow-[0_0_48px_rgba(0,0,0,0.6)]"
          >
            {body}
          </aside>
        </div>
      )}

      <ConfirmModal
        open={pendingHref !== null}
        title={SKIP_AHEAD_COPY.title}
        message={SKIP_AHEAD_COPY.message}
        confirmLabel={SKIP_AHEAD_COPY.confirmLabel}
        cancelLabel={SKIP_AHEAD_COPY.cancelLabel}
        onConfirm={confirmSkipAhead}
        onCancel={() => setPendingHref(null)}
      />
    </>
  );
}
