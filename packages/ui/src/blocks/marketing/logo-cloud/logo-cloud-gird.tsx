import { Beacon } from "@repo/ui/svgs/beacon";
import { Bolt } from "@repo/ui/svgs/bolt";
import { Cisco } from "@repo/ui/svgs/cisco";
import { Hulu } from "@repo/ui/svgs/hulu";
import { Linear } from "@repo/ui/svgs/linear";
import { Spotify } from "@repo/ui/svgs/spotify";
import { Supabase } from "@repo/ui/svgs/supabase";
import { VercelFull } from "@repo/ui/svgs/vercel";

export function LogoCloud() {
  return (
    <section className="bg-background @container py-12">
      <div className="mx-auto max-w-xl px-6">
        <div className="**:fill-foreground grid grid-cols-3 gap-x-8 gap-y-12 *:flex *:items-center *:justify-center @xl:grid-cols-4">
          <div>
            <VercelFull className="h-3.5 w-full" />
          </div>
          <div>
            <Spotify className="h-4.5 w-full" />
          </div>

          <div>
            <Supabase className="size-5" />
          </div>
          <div>
            <Hulu className="h-3.5 w-full" />
          </div>
          <div>
            <Bolt className="h-4 w-full" />
          </div>
          <div>
            <Linear className="size-4" />
          </div>
          <div>
            <Cisco className="h-5 w-full" />
          </div>
          <div>
            <Beacon className="h-3.5 w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
