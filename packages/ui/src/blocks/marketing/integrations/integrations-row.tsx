import { useFramework } from "@repo/ui/adapters";
import { Logo } from "@repo/ui/components/shared/logo";
import { Button } from "@repo/ui/components/ui/button";
import { ClerkIconDark as Clerk } from "@repo/ui/svgs/clerk";
import { Firebase } from "@repo/ui/svgs/firebase";
import { Linear } from "@repo/ui/svgs/linear";
import { Slack } from "@repo/ui/svgs/slack";
import { Supabase } from "@repo/ui/svgs/supabase";
import { Vercel } from "@repo/ui/svgs/vercel";
import { ChevronRight } from "lucide-react";

export function Integrations() {
  const { Link } = useFramework();
  return (
    <section className="bg-background @container py-24">
      <div className="mx-auto max-w-2xl px-6">
        <IntegrationsIllustration />
        <div className="mx-auto mt-12 max-w-md text-center text-balance">
          <h2 className="text-center font-serif text-4xl font-medium">
            Connect Your Favorite Tools
          </h2>
          <p className="text-muted-foreground mt-4 mb-6 text-center">
            Seamlessly integrate with the services you already use. Set up in
            minutes, not days.
          </p>
          <Button
            variant="secondary"
            size="sm"
            asChild
            className="gap-1 pr-1.5"
          >
            <Link href="#">
              Learn more
              <ChevronRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

const IntegrationsIllustration = () => {
  return (
    <div
      aria-hidden
      className="**:fill-foreground mx-auto flex h-44 max-w-lg flex-col justify-between"
    >
      <div className="relative flex h-10 items-center justify-between gap-12 @lg:px-6">
        <div className="bg-border absolute inset-0 my-auto h-px"></div>

        <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
          <Vercel className="size-3.5" />
        </div>
        <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
          <Slack className="size-3.5" />
        </div>
      </div>
      <div className="relative flex h-10 items-center justify-between px-12 @lg:px-24">
        <div className="bg-border absolute inset-0 my-auto h-px"></div>
        <div className="from-primary absolute inset-0 my-auto h-px w-1/2 bg-linear-to-r via-amber-500 to-pink-400 mask-r-from-75% mask-r-to-75% mask-l-from-15% mask-l-to-40%"></div>
        <div className="absolute inset-0 my-auto ml-auto h-px w-1/2 bg-linear-to-r from-indigo-500 via-emerald-500 to-blue-400 mask-r-from-15% mask-r-to-40% mask-l-from-75% mask-l-to-75%"></div>

        <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
          <Clerk className="size-3.5" />
        </div>
        <div className="border-foreground/15 rounded-full border border-dashed p-2">
          <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
            <Logo className="h-4" />
          </div>
        </div>
        <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
          <Linear className="size-3.5" />
        </div>
      </div>
      <div className="relative flex h-10 items-center justify-between gap-12 @lg:px-6">
        <div className="bg-border absolute inset-0 my-auto h-px"></div>

        <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
          <Supabase className="size-3.5" />
        </div>
        <div className="bg-card ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring shadow-black/6.5">
          <Firebase className="size-3.5" />
        </div>
      </div>
    </div>
  );
};
