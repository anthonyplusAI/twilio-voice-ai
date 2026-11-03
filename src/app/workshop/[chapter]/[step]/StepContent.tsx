"use client";

import { useMemo, useEffect, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { stepRegistry } from "@/content/registry";
import { StepRenderer } from "@/components/content/StepRenderer";
import { StepErrorBoundary } from "@/components/content/StepErrorBoundary";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { useWorkshop } from "@/lib/WorkshopContext";
import { useProgressContext } from "@/components/layout/ProgressContext";
import { useAnalyticsContext } from "@/lib/AnalyticsContext";
import { useAudienceMode } from "@/lib/AudienceContext";
import { splitIntoPages } from "@/lib/page-utils";
import { usePageContext } from "@/lib/PageContext";
import { SKIP_AHEAD_COPY } from "@/lib/workshop-copy";

interface StepContentProps {
  chapterSlug: string;
  stepSlug: string;
}

export function StepContent({ chapterSlug, stepSlug }: StepContentProps) {
  const key = `${chapterSlug}/${stepSlug}`;
  const stepDef = useMemo(() => stepRegistry[key], [key]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mode } = useAudienceMode();
  const { getStep, chapters } = useWorkshop();
  const {
    completeStep,
    loaded,
    completedStepsSet,
    skipUnlockPosition,
    unlockThroughPosition,
  } = useProgressContext();
  const { emit } = useAnalyticsContext();
  const { setPageInfo } = usePageContext();

  const resolved = useMemo(
    () => getStep(chapterSlug, stepSlug),
    [getStep, chapterSlug, stepSlug]
  );

  const chapterId = resolved?.chapter.id;
  const stepId = resolved?.step.id;

  // Flat, ordered list of every step across the workshop. Used to detect when
  // a deep-link (or back/forward nav) lands the learner on a step further
  // ahead than their progress allows.
  const flatSteps = useMemo(
    () =>
      chapters.flatMap((c) =>
        c.steps.map((s) => ({
          chapterId: c.id,
          stepId: s.id,
          chapterSlug: c.slug,
          stepSlug: s.slug,
        }))
      ),
    [chapters]
  );

  const targetPosition = useMemo(
    () =>
      flatSteps.findIndex(
        (s) => s.chapterSlug === chapterSlug && s.stepSlug === stepSlug
      ),
    [flatSteps, chapterSlug, stepSlug]
  );

  const maxAllowedPosition = useMemo(() => {
    let max = -1;
    flatSteps.forEach((s, i) => {
      if (completedStepsSet.has(`chapter-${s.chapterId}:step-${s.stepId}`)) {
        if (i > max) max = i;
      }
    });
    return max + 1; // one past the furthest completed step
  }, [flatSteps, completedStepsSet]);

  const [skipConfirm, setSkipConfirm] = useState<"pending" | "declined">("pending");

  // Closing a skip dialog is local to this route. The shared unlock position
  // lives in ProgressProvider so it remains available across route changes.
  useEffect(() => {
    queueMicrotask(() => setSkipConfirm("pending"));
  }, [key]);

  useEffect(() => {
    if (loaded && chapterId && stepId) {
      emit("step_viewed", { chapterId, stepId, chapterSlug, stepSlug });
    }
  }, [loaded, chapterId, stepId, chapterSlug, stepSlug, emit]);

  const pages = useMemo(
    () => (stepDef ? splitIntoPages(stepDef.blocks, mode) : []),
    [stepDef, mode]
  );
  const totalPages = pages.length;

  const rawPage = parseInt(searchParams.get("p") ?? "0", 10);
  const currentPage = Math.max(0, Math.min(rawPage, totalPages - 1));
  const currentBlocks = pages[currentPage] ?? [];

  const isAhead =
    loaded && targetPosition >= 0 && targetPosition > maxAllowedPosition;
  const blockContent = isAhead && targetPosition > skipUnlockPosition;
  const showSkipModal = blockContent && skipConfirm === "pending";

  useEffect(() => {
    setPageInfo(key, currentPage, totalPages, loaded && !blockContent);
  }, [key, currentPage, totalPages, loaded, blockContent, setPageInfo]);

  const allowSkip = useCallback(() => {
    unlockThroughPosition(targetPosition);
    const fromStep = flatSteps[maxAllowedPosition];
    const toStep = flatSteps[targetPosition];
    if (fromStep && toStep) {
      emit("skip_ahead", {
        fromStep: `${fromStep.chapterSlug}/${fromStep.stepSlug}`,
        toStep: `${toStep.chapterSlug}/${toStep.stepSlug}`,
      });
    }
  }, [targetPosition, maxAllowedPosition, flatSteps, emit, unlockThroughPosition]);

  const fallbackStep = flatSteps[Math.max(0, maxAllowedPosition)] ?? flatSteps[0];

  // Non-verify steps complete when the learner *leaves* the step (handled by
  // ProgressTracker). Verify-gated steps complete via the button below.

  // Verify callback: mark step complete when user confirms
  const handleVerifySuccess = useCallback(() => {
    if (chapterId && stepId) {
      completeStep(chapterId, stepId);
    }
  }, [chapterId, stepId, completeStep]);

  if (!stepDef) {
    return (
      <div className="text-text-muted text-center py-20">
        <p className="text-lg mb-2">Content coming soon</p>
        <p className="text-sm">This step is under construction.</p>
      </div>
    );
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {!blockContent && (
          <motion.div
            key={`${key}?p=${currentPage}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <StepErrorBoundary chapterSlug={chapterSlug} stepSlug={stepSlug}>
              <StepRenderer
                blocks={currentBlocks}
                chapterId={chapterId}
                stepId={stepId}
                onVerifySuccess={handleVerifySuccess}
              />
            </StepErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        open={showSkipModal}
        title={SKIP_AHEAD_COPY.title}
        message={SKIP_AHEAD_COPY.message}
        confirmLabel={SKIP_AHEAD_COPY.confirmLabel}
        cancelLabel="Go back"
        onConfirm={allowSkip}
        onCancel={() => {
          setSkipConfirm("declined");
          if (fallbackStep) {
            router.replace(
              `/workshop/${fallbackStep.chapterSlug}/${fallbackStep.stepSlug}`
            );
          }
        }}
      />
    </>
  );
}
