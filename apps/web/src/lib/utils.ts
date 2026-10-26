import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The canonical shadcn `cn()`: clsx resolves conditionals/arrays into a class string,
// then tailwind-merge drops earlier utilities that a later one overrides (so a caller's
// `className="p-8"` actually beats a component's default `p-4` instead of racing it in
// the cascade). Every component and block in this package composes classes through it.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
