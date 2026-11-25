// The agent prompts the landing page and the docs offer beside a `saasaloy` command. Each
// prompt tells an agent to fetch one docs page as raw Markdown and follow one section of
// it, so the steps live on that page and the prompt cannot go stale.
//
// Relative imports with `.ts` and no Astro import: the docs remark plugin and a node:test
// file load this file outside Vite.

import { interpolate } from "../lib/interpolate.ts";
import { siteOrigin } from "../site.ts";

export interface AgentPrompt {
  /** The task sentence. Takes `{name}` when the task acts on one module. */
  task: string;
  /** The docs slug the prompt fetches as `/docs/<slug>.md`. Takes `{name}` too. */
  slug: string;
  /** The section of that page the agent follows. */
  section: string;
}

/** One prompt per task, keyed by the task key a `saasaloy-command` fence names. */
export const prompts = {
  init: {
    task: "Create a new Saasaloy project in a new empty directory.",
    slug: "getting-started",
    section: "For agents",
  },
  add: {
    task: "Add the {name} module to my Saasaloy project.",
    slug: "modules/{name}",
    section: "Install",
  },
  remove: {
    task: "Remove the {name} module from my Saasaloy project.",
    slug: "how-to/remove-a-module",
    section: "For agents",
  },
  update: {
    task: "Update my Saasaloy project to the latest release.",
    slug: "reference",
    section: "For agents",
  },
  deploy: {
    task: "Deploy my Saasaloy project to Cloudflare.",
    slug: "how-to/deploy-to-cloudflare",
    section: "For agents",
  },
  contribute: {
    task: "Contribute a new module to the Saasaloy registry.",
    slug: "how-to/contribute-a-module",
    section: "For agents",
  },
  "database-setup": {
    task: "Set up the Postgres database for my Saasaloy project.",
    slug: "modules/database-postgres",
    section: "For agents",
  },
  "migrate-off-infra": {
    task: "Move my Saasaloy project off the infra module.",
    slug: "runbooks/move-off-the-infra-module",
    section: "For agents",
  },
} as const satisfies Record<string, AgentPrompt>;

export type PromptTask = keyof typeof prompts;

const PATTERN =
  "{task} Fetch {origin}/docs/{slug}.md and follow its {section} section.";

/** True when `key` names a task in `prompts`. */
export function isPromptTask(key: string): key is PromptTask {
  return Object.hasOwn(prompts, key);
}

/**
 * The full prompt for a task. `name` fills `{name}`; `page` and `section` replace the docs
 * slug and the section the task names by default. Throws on an unknown task, or on a `{name}` left unfilled, so a
 * bad docs fence fails the build instead of shipping a prompt with a hole in it.
 *
 * ```ts
 * agentPrompt("add", { name: "waitlist" });
 * // → "Add the waitlist module to my Saasaloy project. Fetch https://saasaloy.com/docs/modules/waitlist.md and follow its Install section."
 * ```
 */
export function agentPrompt(
  task: string,
  options: { name?: string; page?: string; section?: string } = {}
): string {
  if (!isPromptTask(task)) {
    throw new Error(
      `Unknown agent prompt task "${task}". Use one of: ${Object.keys(prompts).join(", ")}.`
    );
  }
  const entry: AgentPrompt = prompts[task];
  const values: Record<string, string> =
    options.name === undefined ? {} : { name: options.name };
  const text = interpolate(PATTERN, {
    task: interpolate(entry.task, values),
    origin: siteOrigin,
    slug: options.page ?? interpolate(entry.slug, values),
    section: options.section ?? entry.section,
  });
  if (text.includes("{name}")) {
    throw new Error(`The agent prompt task "${task}" needs a module name.`);
  }
  return text;
}
