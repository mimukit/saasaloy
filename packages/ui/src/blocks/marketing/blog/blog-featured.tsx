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

export function BlogFeatured({ posts }: { posts: BlogPost[] }) {
  const { Link } = useFramework();
  const featured = posts.filter((p) => p.featured).slice(0, 6);

  if (featured.length === 0) return null;

  return (
    <section className="bg-background border-border border-b">
      <div className="mx-auto max-w-6xl px-6">
        <div className="scrollbar-hide flex gap-0 overflow-x-auto">
          {featured.map((post) => (
            <Link
              key={post.id}
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
