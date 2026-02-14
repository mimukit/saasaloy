import { createContext, useContext } from "react";
import type React from "react";

import { defaultAdapters } from "./defaults";
import type { FrameworkAdapter } from "./types";

export const FrameworkContext = createContext<FrameworkAdapter | null>(null);

export function FrameworkProvider({
  adapters,
  children,
}: {
  adapters: FrameworkAdapter;
  children: React.ReactNode;
}) {
  return (
    <FrameworkContext.Provider value={adapters}>
      {children}
    </FrameworkContext.Provider>
  );
}

export function useFramework(): FrameworkAdapter {
  const context = useContext(FrameworkContext);
  if (!context) {
    return defaultAdapters;
  }
  return context;
}
