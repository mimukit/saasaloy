import { useFramework } from "@repo/ui/adapters";
import { Button } from "@repo/ui/components/ui/button";
import { ChevronRight } from "lucide-react";

const CATEGORY_LINKS = [
  { label: "Engineering", href: "/blog?category=Engineering" },
  { label: "Product", href: "/blog?category=Product" },
  { label: "Company", href: "/blog?category=Company" },
  { label: "Tutorials", href: "/blog?category=Tutorial" },
];

export function BlogHero() {
  const { Link } = useFramework();

  return (
    <section className="bg-background border-border border-b">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
        {/* Left side */}
        <div>
          <h1 className="font-serif text-4xl font-medium tracking-tight">
            Blog
          </h1>
          <p className="text-muted-foreground mt-3 max-w-sm text-balance">
            Product resources, best practices for teams building with SaasAloy.
          </p>
          <Button asChild className="mt-6 pr-1.5" size="lg">
            <Link href="/#pricing">
              <span>Try SaasAloy</span>
              <ChevronRight className="opacity-50" />
            </Link>
          </Button>
        </div>

        {/* Right side — category nav */}
        <nav className="flex flex-col gap-2">
          {CATEGORY_LINKS.map((cat) => (
            <Link
              key={cat.label}
              href={cat.href}
              className="group hover:text-primary inline-flex items-center gap-2 font-serif text-2xl font-medium transition-colors sm:text-3xl md:text-4xl"
            >
              {cat.label}
              <ChevronRight className="size-5 opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-80 sm:size-6" />
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
