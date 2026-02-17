import { BookOpen } from "lucide-react";

export function BlogHero() {
  return (
    <section className="bg-background border-border border-b">
      <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-24">
        <BookOpen
          className="text-muted-foreground mx-auto mb-6 size-12 md:size-14"
          strokeWidth={1.25}
          aria-hidden
        />
        <h1 className="font-serif text-4xl font-medium tracking-tight md:text-5xl">
          Blog
        </h1>
        <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base text-balance md:text-lg">
          Product resources, best practices for teams building with SaasAloy.
        </p>
      </div>
    </section>
  );
}
