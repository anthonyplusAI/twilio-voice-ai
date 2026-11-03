"use client";

import { createContext, useContext, useState, useCallback, useMemo } from "react";

interface PageContextValue {
  stepKey: string | null;
  currentPage: number;
  totalPages: number;
  contentReady: boolean;
  setPageInfo: (stepKey: string, currentPage: number, totalPages: number, contentReady: boolean) => void;
}

const PageContext = createContext<PageContextValue>({
  stepKey: null,
  currentPage: 0,
  totalPages: 1,
  contentReady: false,
  setPageInfo: () => {},
});

export function PageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({ stepKey: null as string | null, currentPage: 0, totalPages: 1, contentReady: false });

  const setPageInfo = useCallback((stepKey: string, currentPage: number, totalPages: number, contentReady: boolean) => {
    setState((prev) => {
      if (prev.stepKey === stepKey && prev.currentPage === currentPage && prev.totalPages === totalPages && prev.contentReady === contentReady) return prev;
      return { stepKey, currentPage, totalPages, contentReady };
    });
  }, []);

  const value = useMemo(
    () => ({ ...state, setPageInfo }),
    [state, setPageInfo]
  );

  return <PageContext value={value}>{children}</PageContext>;
}

export const usePageContext = () => useContext(PageContext);
