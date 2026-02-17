import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useFramework } from "@repo/ui/adapters";
import { Button } from "@repo/ui/components/ui/button";
import { cn } from "@repo/ui/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronRight,
  Clock,
  Copy,
  Facebook,
  Linkedin,
  Tag,
  Twitter,
} from "lucide-react";

// ── Earthy palette (same as blog-card.tsx) ────────────────────────────
const HERO_BG_COLORS = [
  "bg-[oklch(0.55_0.08_25)]", // terracotta
  "bg-[oklch(0.58_0.06_155)]", // sage green
  "bg-[oklch(0.52_0.06_250)]", // dusty blue
  "bg-[oklch(0.50_0.04_65)]", // warm brown
  "bg-[oklch(0.55_0.07_30)]", // clay
  "bg-[oklch(0.53_0.05_200)]", // steel blue
  "bg-[oklch(0.56_0.06_140)]", // moss
  "bg-[oklch(0.48_0.05_280)]", // slate purple
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(dateStr));
}

function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

// ── Types ─────────────────────────────────────────────────────────────

interface TocItem {
  id: string;
  text: string;
  level: number;
}

export interface RelatedPost {
  id: string;
  title: string;
  publishedAt: string;
  category?: string;
}

export interface PostNavigation {
  prev?: { id: string; title: string };
  next?: { id: string; title: string };
}

export interface BlogPostDetailProps {
  title: string;
  description: string;
  publishedAt: string;
  updatedDate?: string;
  category?: string;
  tags?: string[];
  heroImageSrc?: string;
  relatedPosts?: RelatedPost[];
  navigation?: PostNavigation;
  children: React.ReactNode;
}

// ── Table of contents (reads headings from the rendered content) ──────

function TableOfContents({
  contentRef,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const headings = el.querySelectorAll("h2, h3");
    const tocItems: TocItem[] = [];

    headings.forEach((heading) => {
      const text = heading.textContent ?? "";
      let id = heading.id;
      if (!id) {
        id = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        heading.id = id;
      }
      tocItems.push({
        id,
        text,
        level: heading.tagName === "H2" ? 2 : 3,
      });
    });

    setItems(tocItems);
  }, [contentRef]);

  // Intersection observer for active heading
  useEffect(() => {
    const el = contentRef.current;
    if (!el || items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );

    for (const item of items) {
      const heading = document.getElementById(item.id);
      if (heading) observer.observe(heading);
    }

    return () => observer.disconnect();
  }, [items, contentRef]);

  if (items.length === 0) return null;

  return (
    <nav aria-label="Table of contents">
      <h4 className="text-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
        On this page
      </h4>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "block border-l-2 py-1 text-[13px] leading-snug transition-colors",
                item.level === 3 ? "pl-5" : "pl-3",
                activeId === item.id
                  ? "border-primary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:border-foreground/20 border-transparent"
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Share buttons ─────────────────────────────────────────────────────

function ShareButtons({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const encodedTitle = encodeURIComponent(title);
  const encodedUrl = encodeURIComponent(pageUrl);

  return (
    <div>
      <h4 className="text-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
        Share
      </h4>
      <div className="flex items-center gap-2">
        <a
          href={`https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors"
          aria-label="Share on Twitter"
        >
          <Twitter className="size-3.5" />
        </a>
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors"
          aria-label="Share on LinkedIn"
        >
          <Linkedin className="size-3.5" />
        </a>
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors"
          aria-label="Share on Facebook"
        >
          <Facebook className="size-3.5" />
        </a>
        <button
          type="button"
          onClick={copyLink}
          className={cn(
            "bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            copied && "text-primary"
          )}
          aria-label="Copy link"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Related posts sidebar ─────────────────────────────────────────────

function RelatedPostsList({ posts }: { posts: RelatedPost[] }) {
  const { Link } = useFramework();

  if (posts.length === 0) return null;

  return (
    <div>
      <h4 className="text-foreground mb-3 text-xs font-semibold tracking-widest uppercase">
        Related posts
      </h4>
      <div className="space-y-3">
        {posts.slice(0, 3).map((post) => (
          <Link key={post.id} href={`/blog/${post.id}`} className="group block">
            <h5 className="text-foreground group-hover:text-primary line-clamp-2 text-sm leading-snug font-medium transition-colors">
              {post.title}
            </h5>
            <time className="text-muted-foreground mt-1 block text-xs">
              {formatDate(post.publishedAt)}
            </time>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function BlogPostDetail({
  title,
  description,
  publishedAt,
  updatedDate,
  category,
  tags,
  heroImageSrc,
  relatedPosts = [],
  navigation,
  children,
}: BlogPostDetailProps) {
  const { Link, Image } = useFramework();
  const contentRef = useRef<HTMLDivElement>(null);
  const [readingTime, setReadingTime] = useState(0);

  // Estimate reading time from rendered content
  useEffect(() => {
    if (contentRef.current) {
      const text = contentRef.current.textContent ?? "";
      setReadingTime(estimateReadingTime(text));
    }
  }, []);

  const heroColor = HERO_BG_COLORS[hashString(title) % HERO_BG_COLORS.length];

  return (
    <article className="bg-background pt-24">
      {/* ── Breadcrumbs ─────────────────────────────────────────── */}
      <div className="border-border border-b">
        <nav
          aria-label="Breadcrumb"
          className="mx-auto flex max-w-5xl items-center gap-1.5 px-6 py-3"
        >
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Home
          </Link>
          <ChevronRight className="text-muted-foreground size-3.5" />
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Blog
          </Link>
          <ChevronRight className="text-muted-foreground size-3.5" />
          <span className="text-foreground truncate text-sm font-medium">
            {title}
          </span>
        </nav>
      </div>

      {/* ── Hero area ───────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-6 pt-10 pb-8 text-center md:pt-14 md:pb-10">
        {/* Category + Meta */}
        <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
          {category && (
            <span className="bg-foreground/8 text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
              <svg
                viewBox="0 0 6 6"
                className="size-1.5 fill-current"
                aria-hidden
              >
                <circle cx="3" cy="3" r="3" />
              </svg>
              {category}
            </span>
          )}
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              <time dateTime={new Date(publishedAt).toISOString()}>
                {formatDate(publishedAt)}
              </time>
            </span>
            {readingTime > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {readingTime} min read
              </span>
            )}
          </div>
        </div>

        {/* Title */}
        <h1 className="font-serif text-3xl font-medium tracking-tight md:text-4xl lg:text-5xl">
          {title}
        </h1>

        {/* Description */}
        <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-lg">
          {description}
        </p>

        {/* Updated date */}
        {updatedDate && (
          <p className="text-muted-foreground mt-3 text-xs italic">
            Updated on {formatDate(updatedDate)}
          </p>
        )}

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Tag className="text-muted-foreground size-3.5" />
            {tags.map((tag) => (
              <span
                key={tag}
                className="bg-secondary text-secondary-foreground rounded-md px-2 py-0.5 text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Hero image ──────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-6 pb-10">
        {heroImageSrc ? (
          <div className="overflow-hidden rounded-2xl">
            <Image
              src={heroImageSrc}
              alt={title}
              className="aspect-video w-full object-cover"
              width={1200}
              height={675}
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex aspect-[21/9] items-center justify-center overflow-hidden rounded-2xl",
              heroColor
            )}
          >
            <svg
              viewBox="0 0 80 60"
              fill="none"
              className="size-24 text-white/70 md:size-32"
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
            </svg>
          </div>
        )}
      </div>

      {/* ── Content + Sidebar ───────────────────────────────────── */}
      <div className="border-border border-t">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-10 lg:grid-cols-[1fr_220px] lg:py-14">
          {/* Main content (prose) */}
          <div
            ref={contentRef}
            className={cn(
              "max-w-none min-w-0 space-y-5",
              // Headings
              "[&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight md:[&_h2]:text-3xl",
              "[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold",
              "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold",
              // Paragraphs
              "[&_p]:text-[15px] [&_p]:leading-7",
              // Links
              "[&_a]:text-primary hover:[&_a]:text-primary/80 [&_a]:underline [&_a]:underline-offset-2 [&_a]:transition-colors",
              // Lists
              "[&_ul]:ml-6 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul_li]:text-[15px] [&_ul_li]:leading-7",
              "[&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol_li]:text-[15px] [&_ol_li]:leading-7",
              // Code
              "[&_code]:bg-foreground/5 [&_code]:border-foreground/10 [&_code]:rounded-md [&_code]:border [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
              "[&_pre]:bg-foreground/5 [&_pre]:border-foreground/10 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:p-4 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
              // Blockquotes
              "[&_blockquote]:border-primary/40 [&_blockquote]:bg-primary/5 [&_blockquote_p]:text-muted-foreground [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:py-3 [&_blockquote]:pr-4 [&_blockquote]:pl-5 [&_blockquote]:italic",
              // Tables
              "[&_th]:border-border [&_th]:bg-foreground/5 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold",
              "[&_td]:border-border [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm",
              // Horizontal rule
              "[&_hr]:border-border [&_hr]:my-10",
              // Images in content
              "[&_img]:my-6 [&_img]:rounded-xl"
            )}
          >
            {children}
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-8">
              <TableOfContents contentRef={contentRef} />
              <ShareButtons title={title} />
              {relatedPosts.length > 0 && (
                <RelatedPostsList posts={relatedPosts} />
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* ── Post navigation ─────────────────────────────────────── */}
      {navigation && (navigation.prev || navigation.next) && (
        <div className="border-border border-t">
          <div className="mx-auto grid max-w-5xl gap-4 px-6 py-8 sm:grid-cols-2">
            {navigation.prev ? (
              <Link
                href={`/blog/${navigation.prev.id}`}
                className="group bg-card ring-foreground/6.5 hover:ring-foreground/15 flex items-center gap-3 rounded-xl p-4 ring-1 transition-all hover:shadow-md"
              >
                <ArrowLeft className="text-muted-foreground group-hover:text-primary size-4 shrink-0 transition-colors" />
                <div className="min-w-0">
                  <span className="text-muted-foreground block text-xs">
                    Previous
                  </span>
                  <span className="text-foreground group-hover:text-primary mt-0.5 line-clamp-1 text-sm font-medium transition-colors">
                    {navigation.prev.title}
                  </span>
                </div>
              </Link>
            ) : (
              <div />
            )}
            {navigation.next ? (
              <Link
                href={`/blog/${navigation.next.id}`}
                className="group bg-card ring-foreground/6.5 hover:ring-foreground/15 flex items-center justify-end gap-3 rounded-xl p-4 text-right ring-1 transition-all hover:shadow-md"
              >
                <div className="min-w-0">
                  <span className="text-muted-foreground block text-xs">
                    Next
                  </span>
                  <span className="text-foreground group-hover:text-primary mt-0.5 line-clamp-1 text-sm font-medium transition-colors">
                    {navigation.next.title}
                  </span>
                </div>
                <ArrowRight className="text-muted-foreground group-hover:text-primary size-4 shrink-0 transition-colors" />
              </Link>
            ) : (
              <div />
            )}
          </div>
        </div>
      )}

      {/* ── Back to blog CTA ────────────────────────────────────── */}
      <div className="border-border border-t">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-6 py-10">
          <Button variant="outline" asChild>
            <Link href="/blog">
              <ArrowLeft className="mr-2 size-4" />
              Back to all posts
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
