"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkshop } from "@/lib/WorkshopContext";
import { useAudienceMode, type AudienceMode } from "@/lib/AudienceContext";
import { useTheme } from "@/lib/ThemeContext";
import { useProgressContext } from "./ProgressContext";
import { Code, Eye, ChevronDown, Check, Sun, Moon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { FeedbackButton } from "@/components/FeedbackButton";
import { GitHubLink } from "@/components/GitHubLink";

const MODE_INFO: Record<AudienceMode, { icon: typeof Code; label: string; description: string }> = {
  builder: {
    icon: Code,
    label: "Builder",
    description: "Full code blocks, terminal commands, diffs, and deep dives. You'll write real code step by step.",
  },
  explorer: {
    icon: Eye,
    label: "Explorer",
    description: "Visual summaries, concept cards, and high-level overviews. No coding required.",
  },
};

export function TopBar() {
  const params = useParams();
  const currentChapterSlug = params.chapter as string | undefined;
  const { config, chapters } = useWorkshop();
  const { mode, setMode } = useAudienceMode();
  const { toggleTheme, isDark } = useTheme();
  const { progress, completedStepsSet } = useProgressContext();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  const ActiveIcon = MODE_INFO[mode].icon;

  // Pre-compute chapter completion once per progress change. Without this, the
  // chapter-dots render path is O(chapters × steps × badges) on every render,
  // which gets triggered by every context state tick.
  const chapterCompletion = useMemo(() => {
    const badgeSet = new Set(progress.badges);
    const map = new Map<number, boolean>();
    for (const chapter of chapters) {
      const done =
        badgeSet.has(`chapter-${chapter.id}`) ||
        chapter.steps.every((s) =>
          completedStepsSet.has(`chapter-${chapter.id}:step-${s.id}`),
        );
      map.set(chapter.id, done);
    }
    return map;
  }, [chapters, progress.badges, completedStepsSet]);

  return (
    <header className="h-14 border-b border-navy-border bg-navy/80 backdrop-blur-md flex items-center px-3 sm:px-6 shrink-0 z-30 gap-2 sm:gap-0">
      {/* Logo */}
      <Link href="/" aria-label="Home" className="flex items-center gap-2.5 sm:mr-8 shrink-0">
        <img
          src={config.branding.logo?.src ?? "/images/twilio-bug-red.svg"}
          alt={config.branding.logo?.alt ?? ""}
          className="w-7 h-7"
        />
        <span className="hidden sm:inline font-display font-extrabold text-sm text-text-primary whitespace-nowrap">
          {config.shortTitle}
        </span>
      </Link>

      {/* Chapter dots — horizontally scrollable on smaller screens */}
      <nav
        aria-label="Workshop chapters"
        data-scroll-x="true"
        className="flex items-center gap-1.5 flex-1 justify-start sm:justify-center overflow-x-auto scrollbar-none -mx-1 px-1"
      >
        {chapters.map((chapter, idx) => {
          const isCurrent = chapter.slug === currentChapterSlug;
          const isCompleted = chapterCompletion.get(chapter.id) ?? false;
          // Display number is array position, not chapter.id — IDs don't have
          // to be 1..N and the divider "is this the last one?" check is a
          // positional question, not an ID one.
          const displayNumber = idx + 1;
          const isLast = idx === chapters.length - 1;

          return (
            <Link
              key={chapter.id}
              href={`/workshop/${chapter.slug}/${chapter.steps[0].slug}`}
              aria-label={`Chapter ${displayNumber}: ${chapter.title}${
                isCompleted ? " (completed)" : isCurrent ? " (current)" : ""
              }`}
              aria-current={isCurrent ? "page" : undefined}
              className="group flex items-center gap-1.5"
            >
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200
                  ${
                    isCurrent
                      ? "bg-twilio-red text-white shadow-[0_0_12px_rgba(239,34,58,0.4)]"
                      : isCompleted
                        ? "bg-success/20 text-success"
                        : "bg-surface-2 text-text-muted hover:bg-surface-4 hover:text-text-secondary"
                  }
                `}
                title={chapter.title}
              >
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  displayNumber
                )}
              </div>
              <span
                className={`text-xs font-bold hidden 2xl:block transition-colors ${
                  isCurrent ? "text-text-primary" : "text-text-muted group-hover:text-text-secondary"
                }`}
              >
                {chapter.title}
              </span>
              {!isLast && (
                <div className="w-4 h-px bg-surface-4 hidden 2xl:block" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Theme toggle */}
      {config.features.themeToggle && (
        <button
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="shrink-0 sm:ml-6 flex items-center justify-center w-8 h-8 rounded-lg bg-surface-2 border border-navy-border hover:bg-surface-3 transition-colors"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            <Sun className="w-4 h-4 text-text-secondary" />
          ) : (
            <Moon className="w-4 h-4 text-text-secondary" />
          )}
        </button>
      )}

      {/* Feedback */}
      <FeedbackButton />

      {config.repositoryUrl && (
        <div className="shrink-0 sm:ml-2">
          <GitHubLink href={config.repositoryUrl} placement="topbar" />
        </div>
      )}

      {/* Audience mode toggle with popover */}
      {config.features.audienceToggle && (
        <div className="relative shrink-0 ml-2 sm:ml-6" ref={popoverRef}>
          <button
            onClick={() => setPopoverOpen((v) => !v)}
            aria-label={`Experience level: ${MODE_INFO[mode].label}. Click to change.`}
            aria-expanded={popoverOpen}
            aria-haspopup="menu"
            className="flex h-8 w-8 items-center justify-center gap-2 rounded-lg bg-surface-2 border border-navy-border hover:bg-surface-3 transition-colors sm:h-auto sm:w-auto sm:px-3 sm:py-1.5"
          >
            <ActiveIcon className="w-3.5 h-3.5 text-twilio-red" />
            <span className="hidden text-xs font-bold text-text-primary sm:inline">
              {MODE_INFO[mode].label}
            </span>
            <ChevronDown className={`hidden w-3 h-3 text-text-muted transition-transform duration-200 sm:block ${popoverOpen ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {popoverOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-panel border border-navy-border shadow-[0_16px_48px_rgba(0,0,0,0.4)] overflow-hidden z-50"
              >
                {/* Header */}
                <div className="px-4 pt-4 pb-2">
                  <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Experience Level</div>
                  <p className="text-xs text-text-muted/70 mt-1">
                    Choose how technical the content should be. You can switch anytime.
                  </p>
                </div>

                {/* Options */}
                <div className="px-3 pb-3 space-y-1">
                  {(["builder", "explorer"] as const).map((m) => {
                    const info = MODE_INFO[m];
                    const Icon = info.icon;
                    const isActive = mode === m;

                    return (
                      <button
                        key={m}
                        onClick={() => {
                          setMode(m);
                          setPopoverOpen(false);
                        }}
                        className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all duration-150 ${
                          isActive
                            ? "bg-twilio-red/10 border border-twilio-red/25"
                            : "hover:bg-surface-2 border border-transparent"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isActive ? "bg-twilio-red/20" : "bg-surface-2"
                        }`}>
                          <Icon className={`w-4 h-4 ${isActive ? "text-twilio-red" : "text-text-muted"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-display font-extrabold ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
                              {info.label}
                            </span>
                            {isActive && <Check className="w-3.5 h-3.5 text-twilio-red" />}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
                            {info.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </header>
  );
}
