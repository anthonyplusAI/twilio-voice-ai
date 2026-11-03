"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useWorkshop } from "@/lib/WorkshopContext";
import { useProgressContext } from "./ProgressContext";
import { usePageContext } from "@/lib/PageContext";
import { useAudienceMode } from "@/lib/AudienceContext";
import { splitIntoPages } from "@/lib/page-utils";
import { stepRegistry } from "@/content/registry";
import { ChevronLeft, ChevronRight } from "lucide-react";
import workshopConfig from "@/workshop.config";

export function BottomNav() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const chapterSlug = params.chapter as string;
  const stepSlug = params.step as string;
  const { getAdjacentSteps, getStep } = useWorkshop();
  const { completionPercentage, completedStepsSet, completeStep, loaded } =
    useProgressContext();
  const { stepKey: pageStepKey, currentPage, totalPages, contentReady } = usePageContext();
  const { mode } = useAudienceMode();
  const accent = workshopConfig.branding.accentColor;
  const pct = completionPercentage();
  const onCompletePage = pathname === "/workshop/complete";

  const adjacent = chapterSlug && stepSlug
    ? getAdjacentSteps(chapterSlug, stepSlug)
    : null;

  const current = chapterSlug && stepSlug ? getStep(chapterSlug, stepSlug) : null;

  const hasCurrentPageInfo =
    pageStepKey === `${chapterSlug}/${stepSlug}` && contentReady;
  const hasSubPages = hasCurrentPageInfo && totalPages > 1;

  const prevStepLastPage = useMemo(() => {
    if (!adjacent?.prev) return 0;
    const prevKey = `${adjacent.prev.chapter.slug}/${adjacent.prev.step.slug}`;
    const prevDef = stepRegistry[prevKey];
    if (!prevDef) return 0;
    const prevPages = splitIntoPages(prevDef.blocks, mode);
    return Math.max(0, prevPages.length - 1);
  }, [adjacent?.prev, mode]);

  const prevHref = useMemo(() => {
    if (!adjacent || !hasCurrentPageInfo) return null;
    if (hasSubPages && currentPage > 0) {
      return `/workshop/${chapterSlug}/${stepSlug}?p=${currentPage - 1}`;
    }
    if (adjacent.prev) {
      const base = `/workshop/${adjacent.prev.chapter.slug}/${adjacent.prev.step.slug}`;
      return prevStepLastPage > 0 ? `${base}?p=${prevStepLastPage}` : base;
    }
    return null;
  }, [adjacent, hasCurrentPageInfo, hasSubPages, currentPage, chapterSlug, stepSlug, prevStepLastPage]);

  const prevLabel = useMemo(() => {
    if (hasSubPages && currentPage > 0) return current?.step.title ?? "Previous";
    return adjacent?.prev?.step.title ?? null;
  }, [hasSubPages, currentPage, current, adjacent]);

  const nextHref = useMemo(() => {
    if (!adjacent || !hasCurrentPageInfo) return null;
    if (hasSubPages && currentPage < totalPages - 1) {
      return `/workshop/${chapterSlug}/${stepSlug}?p=${currentPage + 1}`;
    }
    if (adjacent.next) {
      return `/workshop/${adjacent.next.chapter.slug}/${adjacent.next.step.slug}`;
    }
    return null;
  }, [adjacent, hasCurrentPageInfo, hasSubPages, currentPage, totalPages, chapterSlug, stepSlug]);

  const nextLabel = useMemo(() => {
    if (hasSubPages && currentPage < totalPages - 1) return current?.step.title ?? "Next";
    return adjacent?.next?.step.title ?? null;
  }, [hasSubPages, currentPage, totalPages, current, adjacent]);

  useEffect(() => {
    if (!adjacent) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      if (target.closest('[data-scroll-x="true"]')) return;

      if (e.key === "ArrowLeft" && prevHref) {
        e.preventDefault();
        router.push(prevHref);
      } else if (e.key === "ArrowRight" && nextHref) {
        e.preventDefault();
        router.push(nextHref);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [adjacent, router, prevHref, nextHref]);

  const isLastStep = adjacent?.next === null;
  const isLastPage = hasCurrentPageInfo && currentPage === totalPages - 1;
  const currentStepCompleted =
    current != null &&
    completedStepsSet.has(
      `chapter-${current.chapter.id}:step-${current.step.id}`
    );
  const firstIncompleteHref = useMemo(() => {
    for (const chapter of workshopConfig.chapters) {
      for (const step of chapter.steps) {
        if (!completedStepsSet.has(`chapter-${chapter.id}:step-${step.id}`)) {
          return `/workshop/${chapter.slug}/${step.slug}`;
        }
      }
    }
    return null;
  }, [completedStepsSet]);

  // The terminal step has nowhere to navigate forward to, so ProgressTracker's
  // "complete on leave" trigger never fires for it. Auto-complete it once the
  // learner reaches the final page so the Finish CTA can appear and the
  // /workshop/complete guard stops redirecting them back. Keep this hook
  // *before* the early returns below so hook order stays stable across renders.
  useEffect(() => {
    if (!loaded || !current || !isLastStep || !isLastPage || currentStepCompleted) return;
    completeStep(current.chapter.id, current.step.id, { silent: true });
  }, [loaded, current, isLastStep, isLastPage, currentStepCompleted, completeStep]);

  if (!adjacent || onCompletePage) return null;

  const stepIndexInChapter = current
    ? current.chapter.steps.findIndex((s) => s.slug === current.step.slug)
    : -1;

  const showFinishCta = isLastStep && isLastPage && currentStepCompleted && pct === 100;
  const showReviewCta = isLastStep && isLastPage && currentStepCompleted &&
    pct < 100 && firstIncompleteHref;

  return (
    <footer className="min-h-16 border-t border-navy-border bg-navy/80 backdrop-blur-md grid grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-2 shrink-0 z-30 sm:h-16 sm:flex sm:gap-0 sm:px-6 sm:py-0">
      {/* Previous */}
      <div className="order-1 min-w-0 sm:w-52 sm:shrink-0">
        {prevHref && prevLabel && (
          <Link
            href={prevHref}
            className="flex min-w-0 items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ChevronLeft className="w-4 h-4 shrink-0" />
            <span className="font-bold truncate">{prevLabel}</span>
          </Link>
        )}
      </div>

      {/* Center: Progress bar + page dots */}
      <div className="order-3 col-span-2 min-w-0 flex flex-col items-center gap-1.5 sm:order-2 sm:flex-1 sm:px-6">
        <div className="w-full max-w-md h-2.5 rounded-full bg-surface-3 overflow-hidden border border-navy-border">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out relative"
            style={{
              width: `${pct}%`,
              backgroundImage: `linear-gradient(to right, ${accent}, var(--color-success))`,
            }}
          >
            {pct > 0 && (
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" style={{ animationDelay: "0s" }} />
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono text-text-muted">
          {current && stepIndexInChapter >= 0 ? (
            <span>
              Chapter {current.chapter.id} &middot; Step {stepIndexInChapter + 1}/{current.chapter.steps.length}
            </span>
          ) : null}
          {hasSubPages && (
            <>
              <span className="text-text-muted">|</span>
              <span className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => (
                  <span
                    key={i}
                    className={`inline-block w-1.5 h-1.5 rounded-full transition-colors ${
                      i === currentPage
                        ? "bg-text-primary"
                        : "bg-text-muted/40"
                    }`}
                  />
                ))}
              </span>
            </>
          )}
          <span className="text-text-muted">|</span>
          <span className={pct === 100 ? "text-success font-bold" : ""}>{pct}% overall</span>
        </div>
      </div>

      {/* Next */}
      <div className="order-2 min-w-0 flex justify-end sm:order-3 sm:w-52 sm:shrink-0">
        {nextHref && nextLabel ? (
          <Link
            href={nextHref}
            className="flex min-w-0 items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="font-bold truncate">{nextLabel}</span>
            <ChevronRight className="w-4 h-4 shrink-0" />
          </Link>
        ) : showFinishCta ? (
          <Link
            href="/workshop/complete"
            className="flex min-w-0 max-w-full items-center gap-2 px-4 py-2 rounded-lg bg-twilio-red text-white font-display font-extrabold text-sm shadow-[0_2px_10px_rgba(239,34,58,0.3)] hover:brightness-110 transition-all"
          >
            <span className="truncate">Finish workshop</span>
            <ChevronRight className="w-4 h-4 shrink-0" />
          </Link>
        ) : showReviewCta ? (
          <Link
            href={showReviewCta}
            className="flex min-w-0 max-w-full items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="font-bold truncate">Review unfinished steps</span>
            <ChevronRight className="w-4 h-4 shrink-0" />
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
