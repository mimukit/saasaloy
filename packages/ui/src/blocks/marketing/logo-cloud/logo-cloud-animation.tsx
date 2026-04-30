import React, { useEffect, useState } from "react";

import { Beacon } from "@repo/ui/svgs/beacon";
import { Bolt } from "@repo/ui/svgs/bolt";
import { Cisco } from "@repo/ui/svgs/cisco";
import { Hulu } from "@repo/ui/svgs/hulu";
import { Spotify } from "@repo/ui/svgs/spotify";
import { Supabase } from "@repo/ui/svgs/supabase";
import { VercelFull } from "@repo/ui/svgs/vercel";
import { AnimatePresence, motion } from "motion/react";

const aiLogos: React.ReactNode[] = [
  <Bolt key="bolt" className="h-3.5 w-full" />,
  <Beacon key="beacon" className="h-3.5 w-full" />,
  <Hulu key="hulu" className="h-3.5 w-full" />,
];

const hostingLogos: React.ReactNode[] = [
  <Supabase key="supabase" className="size-5" />,
  <Spotify key="spotify" className="h-5 w-full" />,
  <VercelFull key="vercel" className="h-3.5 w-full" />,
];

const paymentsLogos: React.ReactNode[] = [
  <Hulu key="hulu" className="h-3.5 w-full" />,
  <VercelFull key="vercel" className="h-3.5 w-full" />,
  <Spotify key="spotify" className="h-5 w-full" />,
];

const streamingLogos: React.ReactNode[] = [
  <Cisco key="cisco" className="h-5 w-full" />,
  <Hulu key="hulu" className="h-3.5 w-full" />,
  <Spotify key="spotify" className="h-5 w-full" />,
];

type LogoGroup = "ai" | "hosting" | "payments" | "streaming";

const logos: { [key in LogoGroup]: React.ReactNode[] } = {
  ai: aiLogos,
  hosting: hostingLogos,
  payments: paymentsLogos,
  streaming: streamingLogos,
};

export function LogoCloud() {
  const [currentGroup, setCurrentGroup] = useState<LogoGroup>("ai");

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentGroup((prev) => {
        const groups = Object.keys(logos) as LogoGroup[];
        const currentIndex = groups.indexOf(prev);
        const nextIndex = (currentIndex + 1) % groups.length;
        return groups[nextIndex] ?? "ai";
      });
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="bg-background py-12">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto grid h-8 max-w-2xl grid-cols-3 items-center gap-8">
          <AnimatePresence initial={false} mode="popLayout">
            {logos[currentGroup].map((logo, i) => (
              <motion.div
                key={`${currentGroup}-${i}`}
                className="**:fill-foreground! flex items-center justify-center"
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 12, filter: "blur(6px)", scale: 0.5 }}
                transition={{
                  delay: i * 0.1,
                  duration: 1.5,
                  type: "spring",
                  bounce: 0.2,
                }}
              >
                {logo}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
