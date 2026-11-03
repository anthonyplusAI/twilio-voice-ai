"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useWorkshop } from "@/lib/WorkshopContext";
import { useProgressContext } from "./ProgressContext";

/**
 * Lives in the workshop layout (persists across navigation).
 * When the user navigates away from any step that isn't completed yet,
 * silently marks it as complete. This catches skipped verify steps —
 * if they moved past it, they did the work and just forgot to click.
 *
 * Guard against skip-ahead leaks: a deep-linked step cannot count until the
 * learner explicitly unlocks it in the skip modal. Once unlocked, only the
 * step they actually visited counts when they advance, never the intervening
 * steps they skipped.
 */
export function ProgressTracker() {
  const params = useParams();
  const chapterSlug = params.chapter as string | undefined;
  const stepSlug = params.step as string | undefined;
  const { getStep, chapters } = useWorkshop();
  const { completeStep, isStepCompleted, loaded, completedStepsSet, skipUnlockPosition } =
    useProgressContext();

  const prevRef = useRef<{ chapterSlug?: string; stepSlug?: string }>({});

  useEffect(() => {
    if (!loaded) return;

    const prev = prevRef.current;

    // If the step changed, check if the PREVIOUS step was incomplete
    if (prev.chapterSlug && prev.stepSlug &&
        (prev.chapterSlug !== chapterSlug || prev.stepSlug !== stepSlug)) {
      const resolved = getStep(prev.chapterSlug, prev.stepSlug);
      if (resolved && !isStepCompleted(resolved.chapter.id, resolved.step.id)) {
        // Build flat step order. Celebrating a step only makes sense when
        // the learner is *advancing* past it — not when they hit the back
        // button or jump to an earlier step. Track three positions:
        //   - leavingPos:     the step they just left
        //   - destinationPos: the step they arrived at
        //   - maxCompletedPos: their furthest-completed step (guards against
        //                     deep-link/skip-ahead drive-bys)
        let leavingPos = -1;
        let destinationPos = -1;
        let maxCompletedPos = -1;
        let pos = 0;
        for (const c of chapters) {
          for (const s of c.steps) {
            if (c.slug === prev.chapterSlug && s.slug === prev.stepSlug) {
              leavingPos = pos;
            }
            if (c.slug === chapterSlug && s.slug === stepSlug) {
              destinationPos = pos;
            }
            if (completedStepsSet.has(`chapter-${c.id}:step-${s.id}`)) {
              if (pos > maxCompletedPos) maxCompletedPos = pos;
            }
            pos++;
          }
        }
        const movedForward =
          leavingPos >= 0 && destinationPos > leavingPos;
        const isNaturalProgress =
          movedForward && leavingPos <= maxCompletedPos + 1;
        const isConfirmedSkipProgress =
          movedForward && leavingPos <= skipUnlockPosition;
        if (isNaturalProgress || isConfirmedSkipProgress) {
          // Fire the step celebration as the learner advances past the step
          // they just left — this is the only moment "step complete" is
          // unambiguously true without stepping on their reading flow.
          completeStep(resolved.chapter.id, resolved.step.id);
        }
      }
    }

    prevRef.current = { chapterSlug, stepSlug };
  }, [
    loaded,
    chapterSlug,
    stepSlug,
    getStep,
    completeStep,
    isStepCompleted,
    chapters,
    completedStepsSet,
    skipUnlockPosition,
  ]);

  return null;
}
