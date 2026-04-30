import { useMemo, useState } from "react";

import { BlogCard } from "@repo/ui/blocks/marketing/blog/blog-card";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { cn } from "@repo/ui/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";

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

const POSTS_PER_PAGE = 9;

export function BlogContent({ posts }: { posts: BlogPost[] }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_PAGE);
  const [expandedFilters, setExpandedFilters] = useState<
    Record<string, boolean>
  >({
    Category: true,
  });

  // Derive categories from posts
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of posts) {
      if (p.category) cats.add(p.category);
    }
    return Array.from(cats).sort();
  }, [posts]);

  // Filter posts
  const filteredPosts = useMemo(() => {
    let result = posts;

    if (activeCategory) {
      result = result.filter((p) => p.category === activeCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      );
    }

    return result;
  }, [posts, activeCategory, search]);

  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPosts.length;

  const toggleFilter = (key: string) => {
    setExpandedFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section className="bg-background py-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 lg:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="space-y-6">
          <h2 className="text-foreground text-sm font-semibold tracking-wide">
            Filter articles
          </h2>

          {/* All button */}
          <button
            type="button"
            onClick={() => {
              setActiveCategory(null);
              setVisibleCount(POSTS_PER_PAGE);
            }}
            className={cn(
              "block w-full text-left text-sm font-medium transition-colors",
              activeCategory === null
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All
            {activeCategory === null && (
              <span className="bg-primary ml-2 inline-block size-1.5 rounded-full" />
            )}
          </button>

          {/* Category filter accordion */}
          <div className="border-border border-t pt-4">
            <button
              type="button"
              onClick={() => toggleFilter("Category")}
              className="text-foreground flex w-full items-center justify-between text-sm font-medium"
            >
              Category
              {expandedFilters.Category ? (
                <ChevronDown className="text-muted-foreground size-4" />
              ) : (
                <ChevronRight className="text-muted-foreground size-4" />
              )}
            </button>
            {expandedFilters.Category && (
              <div className="mt-3 flex flex-col gap-2">
                {categories.map((cat) => (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => {
                      setActiveCategory(activeCategory === cat ? null : cat);
                      setVisibleCount(POSTS_PER_PAGE);
                    }}
                    className={cn(
                      "text-left text-sm transition-colors",
                      activeCategory === cat
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {cat}
                    {activeCategory === cat && (
                      <span className="bg-primary ml-2 inline-block size-1.5 rounded-full" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="space-y-6">
          {/* Search + view toggles */}
          <div className="flex items-center gap-3">
            <div className="relative max-w-xs flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="Search posts"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleCount(POSTS_PER_PAGE);
                }}
                className="pl-9"
              />
            </div>

            <div className="border-border ml-auto flex items-center gap-1 rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  viewMode === "grid"
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  viewMode === "list"
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-label="List view"
              >
                <List className="size-4" />
              </button>
            </div>
          </div>

          {/* Posts grid / list */}
          {visiblePosts.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted-foreground text-sm">
                No posts found matching your criteria.
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePosts.map((post, idx) => (
                <BlogCard
                  key={post.id}
                  title={post.title}
                  date={formatDate(post.publishedAt)}
                  category={post.category}
                  href={`/blog/${post.id}`}
                  index={idx}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visiblePosts.map((post, idx) => (
                <a
                  key={post.id}
                  href={`/blog/${post.id}`}
                  className="group bg-card ring-foreground/6.5 hover:ring-foreground/15 flex items-center gap-5 rounded-xl p-4 shadow-sm ring-1 transition-all hover:shadow-md"
                >
                  <div
                    className={cn(
                      "hidden size-14 shrink-0 items-center justify-center rounded-lg sm:flex",
                      [
                        "bg-[oklch(0.55_0.08_25)]",
                        "bg-[oklch(0.58_0.06_155)]",
                        "bg-[oklch(0.52_0.06_250)]",
                        "bg-[oklch(0.50_0.04_65)]",
                      ][idx % 4]
                    )}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-6 text-white/70"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M12 6v12M6 12h12" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground group-hover:text-primary truncate text-sm font-medium transition-colors">
                      {post.title}
                    </h3>
                    <p className="text-muted-foreground mt-2 line-clamp-1 text-xs">
                      {post.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-3">
                    <time className="text-muted-foreground text-xs">
                      {formatDate(post.publishedAt)}
                    </time>
                    {post.category && (
                      <span className="bg-foreground/8 text-muted-foreground rounded-full px-2 py-0.5 text-[11px]">
                        {post.category}
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* View more */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => setVisibleCount((prev) => prev + POSTS_PER_PAGE)}
              >
                View more
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
