import { useEffect, useState } from "react";

/**
 * The time the CMS screens measure "38 min ago" from. It moves every half minute, so a
 * relative time on screen stays true, and render itself never reads the clock.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
