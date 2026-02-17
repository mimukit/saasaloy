import { cn } from "@repo/ui/lib/utils";

// Earthy, muted color palette for card illustrations (matching reference design)
const BLOG_CARD_BG_COLORS = [
  "bg-[oklch(0.55_0.08_25)]", // terracotta
  "bg-[oklch(0.58_0.06_155)]", // sage green
  "bg-[oklch(0.52_0.06_250)]", // dusty blue
  "bg-[oklch(0.50_0.04_65)]", // warm brown
  "bg-[oklch(0.55_0.07_30)]", // clay
  "bg-[oklch(0.53_0.05_200)]", // steel blue
  "bg-[oklch(0.56_0.06_140)]", // moss
  "bg-[oklch(0.48_0.05_280)]", // slate purple
];

// Decorative SVG icons for card illustrations
function CardIllustration({
  index,
  className,
}: {
  index: number;
  className?: string;
}) {
  const BLOG_CARD_ICONS = [
    // Trees/nature
    <svg
      key="trees"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <line
        x1="20"
        y1="55"
        x2="20"
        y2="30"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="40"
        y1="55"
        x2="40"
        y2="25"
        stroke="currentColor"
        strokeWidth="2"
      />
      <line
        x1="60"
        y1="55"
        x2="60"
        y2="32"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M10 35 L20 15 L30 35"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M28 30 L40 8 L52 30"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M50 37 L60 20 L70 37"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line
        x1="5"
        y1="55"
        x2="75"
        y2="55"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
      />
    </svg>,
    // Circles/dots pattern
    <svg
      key="dots"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="25" cy="20" r="8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="50" cy="25" r="5" fill="currentColor" opacity="0.3" />
      <circle cx="55" cy="35" r="10" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="30" cy="40" r="4" fill="currentColor" opacity="0.5" />
      <line
        x1="33"
        y1="20"
        x2="45"
        y2="25"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.4"
      />
    </svg>,
    // Mountains
    <svg
      key="mountains"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 50 L25 15 L45 50" stroke="currentColor" strokeWidth="1.5" />
      <path d="M30 50 L50 20 L70 50" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M50 50 L65 30 L80 50"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
      />
      <circle cx="60" cy="12" r="5" stroke="currentColor" strokeWidth="1" />
    </svg>,
    // Code brackets
    <svg
      key="code"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M25 15 L10 30 L25 45"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M55 15 L70 30 L55 45"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="45"
        y1="12"
        x2="35"
        y2="48"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>,
    // Waves
    <svg
      key="waves"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 20 Q15 10 25 20 Q35 30 45 20 Q55 10 65 20 Q75 30 80 20"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M5 32 Q15 22 25 32 Q35 42 45 32 Q55 22 65 32 Q75 42 80 32"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M5 44 Q15 34 25 44 Q35 54 45 44 Q55 34 65 44 Q75 54 80 44"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
        opacity="0.4"
      />
    </svg>,
    // Grid/blocks
    <svg
      key="grid"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="10"
        y="10"
        width="15"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="32"
        y="10"
        width="15"
        height="15"
        rx="2"
        fill="currentColor"
        opacity="0.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="54"
        y="10"
        width="15"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="10"
        y="32"
        width="15"
        height="15"
        rx="2"
        fill="currentColor"
        opacity="0.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="32"
        y="32"
        width="15"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="54"
        y="32"
        width="15"
        height="15"
        rx="2"
        fill="currentColor"
        opacity="0.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>,
    // Arrows/paths
    <svg
      key="arrows"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15 45 L15 15 L65 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M60 10 L65 15 L60 20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M20 40 Q35 20 50 30 Q65 40 70 25"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="20" cy="40" r="2.5" fill="currentColor" />
      <circle cx="70" cy="25" r="2.5" fill="currentColor" />
    </svg>,
    // Lightning bolt
    <svg
      key="bolt"
      viewBox="0 0 80 60"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M45 5 L25 28 L38 28 L33 55 L55 28 L42 28 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>,
  ];
  return BLOG_CARD_ICONS[index % BLOG_CARD_ICONS.length];
}

export interface BlogCardProps {
  title: string;
  date: string;
  category?: string;
  href: string;
  index?: number;
  className?: string;
}

export function BlogCard({
  title,
  date,
  category,
  href,
  index = 0,
  className,
}: BlogCardProps) {
  const colorClass = BLOG_CARD_BG_COLORS[index % BLOG_CARD_BG_COLORS.length];

  return (
    <a
      href={href}
      className={cn(
        "group bg-card ring-foreground/6.5 shadow-foreground/5 flex flex-col overflow-hidden rounded-2xl shadow-lg ring-1 transition-all duration-300 dark:shadow-black/10",
        "hover:ring-foreground/15 hover:-translate-y-0.5 hover:shadow-xl",
        className
      )}
    >
      {/* Illustration area */}
      <div
        className={cn(
          "relative flex aspect-4/3 items-center justify-center overflow-hidden",
          colorClass
        )}
      >
        <CardIllustration
          index={index}
          className="h-16 w-20 text-white/70 transition-transform duration-500 group-hover:scale-110"
        />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <time className="text-muted-foreground text-xs tracking-wide">
          {date}
        </time>
        <h3 className="text-foreground group-hover:text-primary text-sm leading-snug font-medium transition-colors">
          {title}
        </h3>
        {category && (
          <div className="mt-auto flex items-center gap-1.5 pt-1">
            <span className="bg-foreground/8 text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
              <svg
                viewBox="0 0 6 6"
                className="size-1.5 fill-current"
                aria-hidden
              >
                <circle cx="3" cy="3" r="3" />
              </svg>
              {category}
            </span>
          </div>
        )}
      </div>
    </a>
  );
}
