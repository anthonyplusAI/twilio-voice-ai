"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useProgress } from "@/hooks/useProgress";
import { useAnalyticsContext } from "@/lib/AnalyticsContext";
import { useWorkshop } from "@/lib/WorkshopContext";

type ProgressContextType = ReturnType<typeof useProgress>;

const ProgressContext = createContext<ProgressContextType | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const progress = useProgress();
  const analytics = useAnalyticsContext();
  const { chapters } = useWorkshop();

  const wrapped: ProgressContextType = {
    ...progress,
    completeStep(chapterId: number, stepId: number, options?: { silent?: boolean }) {
      if (!progress.isStepCompleted(chapterId, stepId)) {
        const chapter = chapters.find(c => c.id === chapterId);
        const step = chapter?.steps.find(s => s.id === stepId);
        analytics.emit("step_completed", {
          chapterId, stepId,
          chapterSlug: chapter?.slug ?? "",
          stepSlug: step?.slug ?? "",
        });

        // If this step completion finishes a chapter, the hook grants the
        // badge in state but does not emit -- emit here so admin analytics
        // (chapter completion panel, users-with-badges counter) stay in sync.
        const badgeId = `chapter-${chapterId}`;
        if (chapter && !progress.progress.badges.includes(badgeId)) {
          const allDoneAfter = chapter.steps.every((s) =>
            s.id === stepId ||
            progress.progress.completedSteps.includes(`chapter-${chapterId}:step-${s.id}`),
          );
          if (allDoneAfter) {
            analytics.emit("badge_earned", { badgeId });
          }
        }
      }
      progress.completeStep(chapterId, stepId, options);
    },
    updateWorkshopState(partial: Record<string, string>) {
      progress.updateWorkshopState(partial);
      for (const [field, value] of Object.entries(partial)) {
        if (field === "phoneNumber") continue;
        analytics.emit("agent_configured", { field, value });
      }
    },
    incrementCalls() {
      progress.incrementCalls();
    },
    earnBadge(badgeId: string) {
      progress.earnBadge(badgeId);
      analytics.emit("badge_earned", { badgeId });
    },
    resetProgress() {
      progress.resetProgress();
      analytics.emit("progress_reset", {});
    },
  };

  return (
    <ProgressContext.Provider value={wrapped}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgressContext() {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgressContext must be inside ProgressProvider");
  return ctx;
}
