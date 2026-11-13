import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

// shadcn's Toaster reads the theme from next-themes. This package has no theme provider:
// the pre-paint script in ../lib/theme.ts puts the `.dark` class on <html>, so the
// Toaster watches that class instead and needs no next-themes dependency.

// Sonner reads its colours from these custom properties; they map it onto the theme.
const TOAST_STYLE: CSSProperties & Record<`--${string}`, string> = {
  "--border-radius": "var(--radius)",
  "--normal-bg": "var(--popover)",
  "--normal-border": "var(--border)",
  "--normal-text": "var(--popover-foreground)",
};

function subscribeToDarkClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  return () => {
    observer.disconnect();
  };
}

function readTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readServerTheme(): "light" | "dark" {
  return "light";
}

function Toaster({ ...props }: ToasterProps) {
  const theme = useSyncExternalStore(
    subscribeToDarkClass,
    readTheme,
    readServerTheme
  );

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={TOAST_STYLE}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from "sonner";
