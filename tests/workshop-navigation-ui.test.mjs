import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

function loadComponent(path, imports, globals = {}) {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    ...globals,
    require(specifier) {
      if (Object.hasOwn(imports, specifier)) return imports[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return loaded.exports;
}

function findElement(root, type) {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = findElement(child, type);
      if (found) return found;
    }
  }
  if (!root || typeof root !== "object") return null;
  if (root.type === type) return root;
  return findElement(root.props?.children, type);
}

test("confirming a deep-link skip unlocks navigation without completing unvisited steps", () => {
  const chapters = [
    { id: 1, slug: "intro", steps: [
      { id: 1, slug: "first" },
      { id: 2, slug: "second" },
    ] },
    { id: 2, slug: "launch", steps: [{ id: 1, slug: "polish" }] },
  ];
  let unlockedPosition = -1;
  const completed = [];
  const events = [];
  const ConfirmModal = () => null;
  const { StepContent } = loadComponent(
    "../src/app/workshop/[chapter]/[step]/StepContent.tsx",
    {
      react: {
        useMemo: (fn) => fn(),
        useEffect: () => {},
        useCallback: (fn) => fn,
        useState: (initial) => [initial, () => {}],
      },
      "react/jsx-runtime": jsxRuntime,
      "next/navigation": {
        useRouter: () => ({ replace() {} }),
        useSearchParams: () => ({ get: () => null }),
      },
      "framer-motion": { AnimatePresence: "AnimatePresence", motion: { div: "motion.div" } },
      "@/content/registry": { stepRegistry: { "launch/polish": { blocks: [] } } },
      "@/components/content/StepRenderer": { StepRenderer: "StepRenderer" },
      "@/components/content/StepErrorBoundary": { StepErrorBoundary: "StepErrorBoundary" },
      "@/components/layout/ConfirmModal": { ConfirmModal },
      "@/lib/WorkshopContext": {
        useWorkshop: () => ({
          chapters,
          getStep: (chapterSlug, stepSlug) => {
            const chapter = chapters.find((c) => c.slug === chapterSlug);
            const step = chapter?.steps.find((s) => s.slug === stepSlug);
            return chapter && step ? { chapter, step } : null;
          },
        }),
      },
      "@/components/layout/ProgressContext": {
        useProgressContext: () => ({
          loaded: true,
          completedStepsSet: new Set(["chapter-1:step-1"]),
          completeStep: (...args) => completed.push(args),
          skipUnlockPosition: -1,
          unlockThroughPosition: (position) => { unlockedPosition = position; },
        }),
      },
      "@/lib/AnalyticsContext": { useAnalyticsContext: () => ({ emit: (...args) => events.push(args) }) },
      "@/lib/AudienceContext": { useAudienceMode: () => ({ mode: "builder" }) },
      "@/lib/page-utils": { splitIntoPages: () => [[]] },
      "@/lib/PageContext": { usePageContext: () => ({ setPageInfo() {} }) },
      "@/workshop.config": { default: { id: "voice-ai" } },
      "@/lib/workshop-copy": { SKIP_AHEAD_COPY: { title: "Skip ahead?", message: "Skip?", confirmLabel: "Jump ahead" } },
    },
    { window: {} },
  );

  const tree = StepContent({ chapterSlug: "launch", stepSlug: "polish" });
  const modal = findElement(tree, ConfirmModal);
  assert.equal(modal.props.open, true);
  modal.props.onConfirm();

  assert.equal(unlockedPosition, 2);
  assert.equal(completed.length, 0, "skipped steps must not receive completion credit");
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "skip_ahead");
  assert.equal(events[0][1].toStep, "launch/polish");
});

test("Enter keeps the focused dialog button's native action", () => {
  let keyHandler;
  let confirmed = 0;
  let cancelled = 0;
  let prevented = 0;
  const { ConfirmModal } = loadComponent(
    "../src/components/layout/ConfirmModal.tsx",
    {
      react: { useEffect: (fn) => fn() },
      "react/jsx-runtime": jsxRuntime,
      "framer-motion": { AnimatePresence: "AnimatePresence", motion: { div: "motion.div" } },
      "lucide-react": { AlertTriangle: "AlertTriangle" },
      "@/hooks/useFocusTrap": { useFocusTrap: () => ({ current: null }) },
    },
    {
      window: { addEventListener: (_, handler) => { keyHandler = handler; }, removeEventListener() {} },
    },
  );
  const tree = ConfirmModal({
    open: true,
    title: "Reset",
    message: "Reset progress?",
    confirmLabel: "Reset Everything",
    cancelLabel: "Keep Progress",
    onConfirm: () => { confirmed++; },
    onCancel: () => { cancelled++; },
  });
  const cancelButton = findElement(tree, "button");
  assert.equal(cancelButton.props.children, "Keep Progress");

  keyHandler({ key: "Enter", preventDefault: () => { prevented++; } });
  assert.equal(confirmed, 0, "a global Enter handler must not override the focused Cancel button");
  assert.equal(prevented, 0, "the native button activation must remain available");
  cancelButton.props.onClick();
  assert.equal(cancelled, 1);
});

test("terminal step waits for its own visible final page before recording completion", () => {
  const first = { chapter: { id: 1, slug: "intro", steps: [{ id: 1, slug: "first" }] }, step: { id: 1, slug: "first", title: "First" } };
  const terminal = { chapter: { id: 2, slug: "launch", steps: [{ id: 1, slug: "polish" }] }, step: { id: 1, slug: "polish", title: "Polish" } };
  const completed = [];
  let pageInfo = { stepKey: "intro/first", currentPage: 0, totalPages: 1, contentReady: true };
  let effects = [];
  const { BottomNav } = loadComponent(
    "../src/components/layout/BottomNav.tsx",
    {
      react: { useEffect: (fn) => effects.push(fn), useMemo: (fn) => fn() },
      "react/jsx-runtime": jsxRuntime,
      "next/link": { default: "Link" },
      "next/navigation": {
        useParams: () => ({ chapter: "launch", step: "polish" }),
        usePathname: () => "/workshop/launch/polish",
        useRouter: () => ({ push() {} }),
      },
      "@/lib/WorkshopContext": {
        useWorkshop: () => ({
          getAdjacentSteps: () => ({ prev: first, next: null }),
          getStep: () => terminal,
        }),
      },
      "./ProgressContext": {
        useProgressContext: () => ({
          completionPercentage: () => 50,
          completedStepsSet: new Set(),
          completeStep: (...args) => completed.push(args),
          loaded: true,
        }),
      },
      "@/lib/PageContext": { usePageContext: () => pageInfo },
      "@/lib/AudienceContext": { useAudienceMode: () => ({ mode: "builder" }) },
      "@/lib/page-utils": { splitIntoPages: () => [[]] },
      "@/content/registry": { stepRegistry: { "intro/first": { blocks: [] } } },
      "lucide-react": { ChevronLeft: "ChevronLeft", ChevronRight: "ChevronRight" },
      "@/workshop.config": { default: { chapters: [first.chapter, terminal.chapter], branding: { accentColor: "red" } } },
    },
  );

  function renderAndRunCompletionEffect() {
    effects = [];
    BottomNav();
    effects.at(-1)();
  }

  renderAndRunCompletionEffect();
  assert.equal(completed.length, 0, "previous step's one-page state must not complete the terminal step");

  pageInfo = { stepKey: "launch/polish", currentPage: 0, totalPages: 3, contentReady: true };
  renderAndRunCompletionEffect();
  assert.equal(completed.length, 0, "opening the first page of the terminal step is not completion");

  pageInfo = { stepKey: "launch/polish", currentPage: 2, totalPages: 3, contentReady: false };
  renderAndRunCompletionEffect();
  assert.equal(completed.length, 0, "a skip dialog blocks completion even when the URL points at the final page");

  pageInfo = { stepKey: "launch/polish", currentPage: 2, totalPages: 3, contentReady: true };
  renderAndRunCompletionEffect();
  assert.equal(completed.length, 1);
  assert.equal(completed[0][0], 2);
  assert.equal(completed[0][1], 1);
  assert.equal(completed[0][2].silent, true);
});

test("a disabled session store still leaves the deep-link skip dialog usable", () => {
  const chapters = [
    { id: 1, slug: "intro", steps: [{ id: 1, slug: "first" }] },
    { id: 2, slug: "launch", steps: [{ id: 1, slug: "polish" }] },
  ];
  const pageInfo = [];
  const ConfirmModal = () => null;
  const { StepContent } = loadComponent(
    "../src/app/workshop/[chapter]/[step]/StepContent.tsx",
    {
      react: {
        useMemo: (fn) => fn(),
        useEffect: (fn) => fn(),
        useCallback: (fn) => fn,
        useState: (initial) => [initial, () => {}],
      },
      "react/jsx-runtime": jsxRuntime,
      "next/navigation": {
        useRouter: () => ({ replace() {} }),
        useSearchParams: () => ({ get: () => null }),
      },
      "framer-motion": { AnimatePresence: "AnimatePresence", motion: { div: "motion.div" } },
      "@/content/registry": { stepRegistry: { "launch/polish": { blocks: [] } } },
      "@/components/content/StepRenderer": { StepRenderer: "StepRenderer" },
      "@/components/content/StepErrorBoundary": { StepErrorBoundary: "StepErrorBoundary" },
      "@/components/layout/ConfirmModal": { ConfirmModal },
      "@/lib/WorkshopContext": {
        useWorkshop: () => ({
          chapters,
          getStep: (chapterSlug, stepSlug) => {
            const chapter = chapters.find((c) => c.slug === chapterSlug);
            const step = chapter?.steps.find((s) => s.slug === stepSlug);
            return chapter && step ? { chapter, step } : null;
          },
        }),
      },
      "@/components/layout/ProgressContext": {
        useProgressContext: () => ({
          loaded: true,
          completedStepsSet: new Set(),
          completeStep() {},
          skipUnlockPosition: -1,
        }),
      },
      "@/lib/AnalyticsContext": { useAnalyticsContext: () => ({ emit() {} }) },
      "@/lib/AudienceContext": { useAudienceMode: () => ({ mode: "builder" }) },
      "@/lib/page-utils": { splitIntoPages: () => [[]] },
      "@/lib/PageContext": { usePageContext: () => ({ setPageInfo: (...args) => pageInfo.push(args) }) },
      "@/workshop.config": { default: { id: "voice-ai" } },
      "@/lib/workshop-copy": { SKIP_AHEAD_COPY: { title: "Skip ahead?", message: "Skip?", confirmLabel: "Jump ahead" } },
    },
    {
      window: {},
      queueMicrotask: (fn) => fn(),
      sessionStorage: { getItem() { throw new Error("storage denied"); } },
    },
  );

  const tree = StepContent({ chapterSlug: "launch", stepSlug: "polish" });
  const modal = findElement(tree, ConfirmModal);
  assert.equal(modal.props.open, true);
  assert.equal(pageInfo.length, 1);
  assert.equal(pageInfo[0][0], "launch/polish");
  assert.equal(pageInfo[0][3], false, "a blocked step is not available for completion");
});

test("a confirmed skip completes only the visited step when session storage is disabled", async () => {
  const chapters = [
    { id: 1, slug: "intro", steps: [{ id: 1, slug: "first" }, { id: 2, slug: "second" }] },
    { id: 2, slug: "launch", steps: [{ id: 1, slug: "polish" }, { id: 2, slug: "review" }] },
  ];
  const config = { id: "voice-ai", chapters };
  const getStep = (chapterSlug, stepSlug) => {
    const chapter = chapters.find((c) => c.slug === chapterSlug);
    const step = chapter?.steps.find((s) => s.slug === stepSlug);
    return chapter && step ? { chapter, step } : null;
  };
  const deniedStorage = {
    getItem() { throw new Error("storage denied"); },
    setItem() { throw new Error("storage denied"); },
    removeItem() { throw new Error("storage denied"); },
  };
  const hookState = [];
  let stateIndex = 0;
  let firstRender = true;
  let mountEffects = [];
  const reactHooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!Object.hasOwn(hookState, index)) hookState[index] = initial;
      return [hookState[index], (update) => {
        hookState[index] = typeof update === "function" ? update(hookState[index]) : update;
      }];
    },
    useEffect(effect) { if (firstRender) mountEffects.push(effect); },
    useMemo: (calculate) => calculate(),
    useCallback: (callback) => callback,
  };
  const { useProgress } = loadComponent(
    "../src/hooks/useProgress.ts",
    {
      react: reactHooks,
      "@/lib/types": {
        DEFAULT_PROGRESS: {
          schemaVersion: 2,
          completedSteps: [],
          workshopState: {},
          badges: [],
          callCount: 0,
          pendingBadge: null,
          pendingStep: null,
        },
        PROGRESS_SCHEMA_VERSION: 2,
      },
      "@/lib/progress-math": {
        countValidCompleted: (completed) => completed.length,
        totalStepCount: () => 4,
      },
      "@/workshop.config": { default: config },
    },
    {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorage: deniedStorage,
      queueMicrotask,
      console,
    },
  );
  const { ProgressProvider } = loadComponent(
    "../src/components/layout/ProgressContext.tsx",
    {
      react: { createContext: () => ({ Provider: "ProgressContextProvider" }), useContext: () => null },
      "react/jsx-runtime": jsxRuntime,
      "@/hooks/useProgress": { useProgress },
      "@/lib/AnalyticsContext": { useAnalyticsContext: () => ({ emit() {} }) },
      "@/lib/WorkshopContext": { useWorkshop: () => ({ chapters }) },
    },
  );
  function renderProgressProvider() {
    stateIndex = 0;
    mountEffects = [];
    const value = ProgressProvider({ children: null }).props.value;
    if (firstRender) {
      firstRender = false;
      for (const effect of mountEffects) effect();
    }
    return value;
  }

  let progress = renderProgressProvider();
  await Promise.resolve();
  progress = renderProgressProvider();
  assert.equal(progress.loaded, true);

  const ConfirmModal = () => null;
  const { StepContent } = loadComponent(
    "../src/app/workshop/[chapter]/[step]/StepContent.tsx",
    {
      react: {
        useMemo: (fn) => fn(),
        useEffect: (fn) => fn(),
        useCallback: (fn) => fn,
        useState: (initial) => [initial, () => {}],
      },
      "react/jsx-runtime": jsxRuntime,
      "next/navigation": {
        useRouter: () => ({ replace() {} }),
        useSearchParams: () => ({ get: () => null }),
      },
      "framer-motion": { AnimatePresence: "AnimatePresence", motion: { div: "motion.div" } },
      "@/content/registry": { stepRegistry: { "launch/polish": { blocks: [] } } },
      "@/components/content/StepRenderer": { StepRenderer: "StepRenderer" },
      "@/components/content/StepErrorBoundary": { StepErrorBoundary: "StepErrorBoundary" },
      "@/components/layout/ConfirmModal": { ConfirmModal },
      "@/lib/WorkshopContext": { useWorkshop: () => ({ chapters, getStep }) },
      "@/components/layout/ProgressContext": { useProgressContext: () => progress },
      "@/lib/AnalyticsContext": { useAnalyticsContext: () => ({ emit() {} }) },
      "@/lib/AudienceContext": { useAudienceMode: () => ({ mode: "builder" }) },
      "@/lib/page-utils": { splitIntoPages: () => [[]] },
      "@/lib/PageContext": { usePageContext: () => ({ setPageInfo() {} }) },
      "@/workshop.config": { default: config },
      "@/lib/workshop-copy": { SKIP_AHEAD_COPY: { title: "Skip ahead?", message: "Skip?", confirmLabel: "Jump ahead" } },
    },
    { window: {}, sessionStorage: deniedStorage, queueMicrotask },
  );
  const modal = findElement(StepContent({ chapterSlug: "launch", stepSlug: "polish" }), ConfirmModal);
  assert.equal(modal.props.open, true);
  modal.props.onConfirm();

  progress = renderProgressProvider();
  assert.equal(progress.skipUnlockPosition, 2, "the confirmed position must survive the route transition in memory");
  assert.equal(progress.progress.completedSteps.length, 0, "confirming a skip must not complete unvisited steps");

  let params = { chapter: "launch", step: "polish" };
  const trackerRef = { current: {} };
  const { ProgressTracker } = loadComponent(
    "../src/components/layout/ProgressTracker.tsx",
    {
      react: { useEffect: (effect) => effect(), useRef: () => trackerRef },
      "next/navigation": { useParams: () => params },
      "@/lib/WorkshopContext": { useWorkshop: () => ({ chapters, getStep }) },
      "./ProgressContext": { useProgressContext: () => progress },
      "@/workshop.config": { default: config },
    },
    { sessionStorage: deniedStorage },
  );
  ProgressTracker();
  params = { chapter: "launch", step: "review" };
  ProgressTracker();

  progress = renderProgressProvider();
  assert.equal(progress.progress.completedSteps.length, 1);
  assert.equal(progress.progress.completedSteps[0], "chapter-2:step-1");
  assert.equal(progress.progress.badges.length, 0);
});
