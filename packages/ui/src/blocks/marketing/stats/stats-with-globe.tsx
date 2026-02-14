import { useFramework } from "@repo/ui/adapters";

export function Stats() {
  const { Image } = useFramework();
  return (
    <section className="bg-background @container pt-24">
      <div className="mx-auto max-w-2xl px-6">
        <div className="space-y-4">
          <h2 className="text-center font-serif text-4xl font-medium text-balance">
            Trusted by Teams Worldwide
          </h2>
          <p className="text-muted-foreground text-center text-balance">
            Our platform delivers measurable results that help businesses scale
            faster and work smarter.
          </p>
        </div>
        <div className="mt-12 grid gap-6 text-sm @xl:grid-cols-3">
          <div className="border-t py-6">
            <p className="text-muted-foreground text-xl">
              <span className="text-foreground font-medium">99.9%</span> Uptime
              guarantee.
            </p>
          </div>

          <div className="border-t py-6">
            <p className="text-muted-foreground text-xl">
              <span className="text-foreground font-medium">10M+</span> API
              requests processed daily.
            </p>
          </div>

          <div className="border-t py-6">
            <p className="text-muted-foreground text-xl">
              <span className="text-foreground font-medium">500+</span>{" "}
              Enterprise customers.
            </p>
          </div>
        </div>
      </div>
      <div className="pointer-events-none relative mx-auto max-w-4xl mask-radial-[50%_100%] mask-radial-from-65% mask-radial-at-bottom dark:opacity-50">
        <div className="bg-primary absolute inset-0 z-10 mix-blend-overlay" />
        <Image
          src="/images/globe-with-world-map.jpg"
          alt="globe with world map"
          className="dark:invert"
          width={2928}
          height={1464}
        />
      </div>
    </section>
  );
}
