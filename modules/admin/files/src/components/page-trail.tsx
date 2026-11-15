import { createContext, useContext, useEffect } from "react";

// The page path a screen may set for the shell header. Without it the header reads the
// area and the nav label that owns the path ("Admin / Blog"). A record screen names
// itself as the last step ("Admin / Blog / Shipping the CMS module") by calling
// `usePageTrail` with the steps after the area. AppShell holds the value and passes it to
// ShellLayout's `trail`; the screen clears it again when it unmounts.

export interface PageTrailStep {
  label: string;
  /** A link for every step but the last, which is the current page. */
  to?: string;
}

type SetTrail = (trail: readonly PageTrailStep[] | undefined) => void;

/** Outside AppShell nothing reads the trail, so setting one does nothing. */
function ignoreTrail(): void {
  // No shell above the caller: there is no header to set.
}

export const PageTrailContext = createContext<SetTrail>(ignoreTrail);

/** Set the header's page path for as long as the calling screen is mounted. */
export function usePageTrail(trail: readonly PageTrailStep[]): void {
  const setTrail = useContext(PageTrailContext);
  // Compared as text, so a new array with the same steps on each render sets nothing.
  const key = JSON.stringify(trail);
  useEffect(() => {
    setTrail(JSON.parse(key) as PageTrailStep[]);
    return () => {
      setTrail(undefined);
    };
  }, [key, setTrail]);
}
