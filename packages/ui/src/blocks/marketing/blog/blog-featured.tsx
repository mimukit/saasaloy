import { useEffect, useRef } from "react";

import { useFramework } from "@repo/ui/adapters";

export interface BlogPost {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  category?: string;
  tags?: string[];
  featured?: boolean;
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(dateStr));
}

const SCROLL_PX_PER_TICK = 1.5;
const TICK_MS = 32; // ~31fps

export function BlogFeatured({ posts }: { posts: BlogPost[] }) {
  const { Link } = useFramework();
  const featured = posts.filter((p) => p.featured).slice(0, 6);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (featured.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    let rafId: number;
    let lastTime = 0;

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (pausedRef.current) {
        lastTime = now;
        return;
      }
      const delta = lastTime ? now - lastTime : TICK_MS;
      lastTime = now;
      const half = el.scrollWidth / 2;
      el.scrollLeft += (SCROLL_PX_PER_TICK * delta) / TICK_MS;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [featured.length]);

  if (featured.length === 0) return null;

  const duplicated = [...featured, ...featured];

  return (
    <section className="bg-background border-border border-b">
      <div className="mx-auto max-w-6xl px-6">
        <div
          ref={scrollRef}
          className="scrollbar-hide flex gap-0 overflow-x-auto"
          style={{ scrollBehavior: "auto" }}
          onMouseEnter={() => (pausedRef.current = true)}
          onMouseLeave={() => (pausedRef.current = false)}
        >
          {duplicated.map((post, i) => (
            <Link
              key={`${post.id}-${i}`}
              href={`/blog/${post.id}`}
              className="group border-border hover:bg-muted/30 flex min-w-[200px] shrink-0 flex-col gap-1.5 border-r px-5 py-5 transition-colors first:pl-0 last:border-r-0"
            >
              <h3 className="text-foreground group-hover:text-primary line-clamp-2 text-sm leading-snug font-medium transition-colors">
                {post.title}
              </h3>
              <time className="text-muted-foreground text-xs">
                {formatDate(post.publishedAt)}
              </time>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
