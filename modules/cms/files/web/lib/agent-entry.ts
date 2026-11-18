import { config } from "@repo/config";
import type { AgentEntry } from "../agent-entries";
import type { AgentSection } from "../llms";
import { joinUrl } from "../llms";

// `cms`'s entry in the web app's agent files, installed by `saasaloy add cms` at
// `apps/web/src/lib/agent-entries/cms.ts` and registered in `../agent-entries.ts`.
//
// The site's `/llms.txt` is built at build time, and a post is published at run time, so
// the entry names the places that list every published post rather than each post: the
// blog index, its sitemap and its RSS feed, all on demand. The paths follow
// `config.cms.basePath`.

/** The `## Blog` section of `/llms.txt`, on `PUBLIC_SITE_URL`. */
export function cmsAgentEntry(): AgentEntry {
  return ({ site }): AgentSection => {
    const { basePath, rssDescription, rssTitle } = config.cms;
    const url = (path: string) => joinUrl(site.origin, path);
    return {
      title: rssTitle,
      summary: rssDescription,
      links: [
        {
          title: "Blog index",
          url: url(basePath),
          note: "the newest published posts, with links to older pages.",
        },
        {
          title: "Blog sitemap",
          url: url(`${basePath}/sitemap.xml`),
          note: "the address of every published post.",
        },
        {
          title: "RSS feed",
          url: url(`${basePath}/rss.xml`),
          note: "the newest posts with their excerpts.",
        },
      ],
    };
  };
}
