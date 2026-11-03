"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { Progress } from "@/lib/types";
import { DEFAULT_PROGRESS, PROGRESS_SCHEMA_VERSION } from "@/lib/types";
import { countValidCompleted, totalStepCount } from "@/lib/progress-math";
import workshopConfig from "@/workshop.config";

const STORAGE_KEY = `workshop-${workshopConfig.id}-progress`;
const SKIP_UNLOCK_KEY = `workshop-${workshopConfig.id}-skip-unlock-position`;

function loadSkipUnlockPosition(): number {
  try {
    const stored = sessionStorage.getItem(SKIP_UNLOCK_KEY);
    if (stored === null) return -1;
    const position = Number(stored);
    return Number.isSafeInteger(position) && position >= 0 ? position : -1;
  } catch {
    // The provider still keeps the unlock in memory if session storage is disabled.
    return -1;
  }
}

/**
 * Migrations from older schema versions → current. Each entry takes the
 * deserialized blob at version N and returns the blob at version N+1. On
 * schema bumps, add a new migration here rather than discarding user
 * progress. Keys run in ascending numeric order.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MIGRATIONS: Record<number, (old: any) => any> = {
  // Example for future reference — when bumping to v3, add:
  // 2: (v2) => ({ ...v2, schemaVersion: 3, someNewField: defaultValue }),
};

function migrate(blob: Record<string, unknown>): Progress | null {
  let current = blob;
  let safetyCounter = 0;
  while (
    typeof current.schemaVersion === "number" &&
    current.schemaVersion < PROGRESS_SCHEMA_VERSION &&
    safetyCounter++ < 20
  ) {
    const migration = MIGRATIONS[current.schemaVersion];
    if (!migration) return null; // no path forward — fall back to defaults
    current = migration(current);
  }
  if (current.schemaVersion !== PROGRESS_SCHEMA_VERSION) return null;
  if (!Array.isArray(current.completedSteps)) return null;
  // Shape validated above (schemaVersion + completedSteps); loadProgress()
  // spreads DEFAULT_PROGRESS underneath so any missing fields get filled.
  return current as unknown as Progress;
}

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PROGRESS;

    let resolved: Progress | null = null;
    if (parsed.schemaVersion === PROGRESS_SCHEMA_VERSION) {
      resolved = parsed as Progress;
    } else if (typeof parsed.schemaVersion === "number") {
      resolved = migrate(parsed);
      if (resolved) {
        console.info(
          `[workshop] Migrated progress from schema v${parsed.schemaVersion} to v${PROGRESS_SCHEMA_VERSION}.`,
        );
      } else {
        console.warn(
          `[workshop] No migration path from schema v${parsed.schemaVersion} to v${PROGRESS_SCHEMA_VERSION}; progress was reset.`,
        );
      }
    } else {
      console.warn(
        "[workshop] Stored progress has no schemaVersion; progress was reset.",
      );
    }

    if (!resolved) return DEFAULT_PROGRESS;
    // pendingBadge/pendingStep are ephemeral — never restore from storage
    return { ...DEFAULT_PROGRESS, ...resolved, pendingBadge: null, pendingStep: null };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

let loggedStorageFailure = false;
const storageFailureListeners = new Set<(failed: boolean) => void>();

function notifyStorageFailure(failed: boolean) {
  storageFailureListeners.forEach((fn) => fn(failed));
}

function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    // A previous save might have hit quota/blocked storage and raised the
    // failure banner. Now that a save succeeded, clear the flag so the
    // banner hides and we start warning fresh if it breaks again later.
    if (loggedStorageFailure) {
      loggedStorageFailure = false;
      notifyStorageFailure(false);
    }
    return true;
  } catch (err) {
    // localStorage full, disabled (private browsing in some browsers), or
    // blocked by site-settings. Log once so a developer inspecting the
    // console can spot why progress isn't persisting, but don't spam on
    // every save attempt.
    if (!loggedStorageFailure) {
      loggedStorageFailure = true;
      console.warn(
        "[workshop] Could not save progress to localStorage — progress will not persist across reloads.",
        err,
      );
    }
    notifyStorageFailure(true);
    return false;
  }
}

export function useProgress() {
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [loaded, setLoaded] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [skipUnlockPosition, setSkipUnlockPosition] = useState(-1);

  useEffect(() => {
    const stored = loadProgress();
    const storedSkipUnlockPosition = loadSkipUnlockPosition();
    queueMicrotask(() => {
      setProgress(stored);
      setSkipUnlockPosition((current) => Math.max(current, storedSkipUnlockPosition));
      setLoaded(true);
    });
  }, []);

  // Subscribe to module-level save failures so the UI can show a banner.
  // We use a listener set (not a direct React state) because `saveProgress`
  // fires inside setState updaters where you can't call another setState.
  useEffect(() => {
    const listener = (failed: boolean) => setStorageFailed(failed);
    storageFailureListeners.add(listener);
    return () => {
      storageFailureListeners.delete(listener);
    };
  }, []);

  const totalSteps = totalStepCount(workshopConfig.chapters);

  const update = useCallback((partial: Partial<Progress>) => {
    setProgress((prev) => {
      const next = { ...prev, ...partial };
      saveProgress(next);
      return next;
    });
  }, []);

  const unlockThroughPosition = useCallback((position: number) => {
    if (!Number.isSafeInteger(position) || position < 0) return;
    setSkipUnlockPosition((current) => {
      const next = Math.max(current, position);
      if (next !== current) {
        try {
          sessionStorage.setItem(SKIP_UNLOCK_KEY, String(next));
        } catch {
          // The in-memory unlock remains usable for this workshop visit.
        }
      }
      return next;
    });
  }, []);

  const completeStep = useCallback((chapterId: number, stepId: number, options?: { silent?: boolean }) => {
    const key = `chapter-${chapterId}:step-${stepId}`;
    const silent = options?.silent ?? false;
    setProgress((prev) => {
      if (prev.completedSteps.includes(key)) return prev;
      const newCompleted = [...prev.completedSteps, key];

      // Check if all steps in this chapter are now complete → earn badge
      const chapter = workshopConfig.chapters.find((c) => c.id === chapterId);
      const badgeId = `chapter-${chapterId}`;
      let newBadges = prev.badges;
      let newPendingBadge = prev.pendingBadge;

      if (chapter && !prev.badges.includes(badgeId)) {
        const allDone = chapter.steps.every((s) =>
          newCompleted.includes(`chapter-${chapterId}:step-${s.id}`)
        );
        if (allDone) {
          newBadges = [...prev.badges, badgeId];
          newPendingBadge = badgeId;
        }
      }

      const next = {
        ...prev,
        completedSteps: newCompleted,
        badges: newBadges,
        pendingBadge: newPendingBadge,
        // Silent completions skip the step toast, but chapter celebrations still fire
        pendingStep: (silent || newPendingBadge) ? null : key,
      };
      saveProgress(next);
      return next;
    });
  }, []);

  // Storage keeps completedSteps as a string[] (JSON-serializable). We derive
  // a Set once per update so membership checks (TopBar dot state, Sidebar step
  // state, auto-complete gates) are O(1) instead of O(n).
  const completedStepsSet = useMemo(
    () => new Set(progress.completedSteps),
    [progress.completedSteps]
  );

  const isStepCompleted = useCallback(
    (chapterId: number, stepId: number) => {
      return completedStepsSet.has(`chapter-${chapterId}:step-${stepId}`);
    },
    [completedStepsSet]
  );

  const earnBadge = useCallback((badgeId: string) => {
    setProgress((prev) => {
      if (prev.badges.includes(badgeId)) return prev;
      const next = { ...prev, badges: [...prev.badges, badgeId] };
      saveProgress(next);
      return next;
    });
  }, []);

  const updateWorkshopState = useCallback((partial: Record<string, string>) => {
    setProgress((prev) => {
      const next = {
        ...prev,
        workshopState: { ...prev.workshopState, ...partial },
      };
      saveProgress(next);
      return next;
    });
  }, []);

  const incrementCalls = useCallback(() => {
    setProgress((prev) => {
      const next = { ...prev, callCount: prev.callCount + 1 };
      saveProgress(next);
      return next;
    });
  }, []);

  const dismissBadge = useCallback(() => {
    setProgress((prev) => {
      const next = { ...prev, pendingBadge: null };
      saveProgress(next);
      return next;
    });
  }, []);

  const dismissStep = useCallback(() => {
    setProgress((prev) => {
      if (!prev.pendingStep) return prev;
      return { ...prev, pendingStep: null };
    });
  }, []);

  const resetProgress = useCallback(() => {
    setProgress(DEFAULT_PROGRESS);
    setSkipUnlockPosition(-1);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    // Session-scoped skip-ahead unlocks must die with the progress they were
    // tied to — otherwise a learner who reset would still bypass the skip modal
    // for steps they "unlocked" before the reset.
    try {
      sessionStorage.removeItem(SKIP_UNLOCK_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Storage can contain keys from a prior config (renamed/deleted steps) that
  // no longer exist in workshopConfig. Counting them inflates the percentage
  // past 100% and can mark the workshop "complete" without the learner having
  // actually finished the current step list. Filter through the live config.
  const validCompletedCount = useMemo(
    () => countValidCompleted(progress.completedSteps, workshopConfig.chapters),
    [progress.completedSteps],
  );

  const completionPercentage = useCallback(() => {
    if (totalSteps === 0) return 0;
    return Math.min(
      100,
      Math.round((validCompletedCount / totalSteps) * 100)
    );
  }, [validCompletedCount, totalSteps]);

  const dismissStorageWarning = useCallback(() => setStorageFailed(false), []);

  return {
    progress,
    completedStepsSet,
    loaded,
    skipUnlockPosition,
    unlockThroughPosition,
    storageFailed,
    dismissStorageWarning,
    update,
    completeStep,
    isStepCompleted,
    earnBadge,
    dismissBadge,
    dismissStep,
    resetProgress,
    updateWorkshopState,
    incrementCalls,
    completionPercentage,
  };
}
