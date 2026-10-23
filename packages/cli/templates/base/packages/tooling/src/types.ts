// The shapes the project's own deploy files fill in. `deploy.config.ts` and `targets.ts`
// belong to the project after `saasaloy init`, and `saasaloy update` never writes them
// again. These types and the engine stay managed, so every key here is optional or has
// a default the engine supplies, and an older owned file keeps working.

/** The gates `pnpm deploy:production` applies. Every key falls back to a default. */
export interface DeployConfig {
  /**
   * Branches a deploy may start from. A trailing `*` matches any rest, so `hotfix-*`
   * takes `hotfix-prices`. Default: `["main", "hotfix-*"]`.
   */
  branches?: string[];
  /** The prefix of every deploy tag. Default: `deploy-`. */
  tagPrefix?: string;
  /**
   * The GitHub Actions workflow file that must pass on HEAD, such as `ci.yml`. Unset
   * turns the CI gate off, and the run says so.
   */
  ciWorkflow?: string | undefined;
  /**
   * A git pathspec for the migration files. A file it matches that changed since the
   * last deploy tag needs `--migrate`. Default: `packages/db/migrations/*.sql`.
   */
  migrations?: string;
}

/** One Worker the deploy uploads, and where it goes in the order. */
export interface DeployTarget {
  /** The workspace directory under `apps/`, which is also its `SERVICES` name. */
  service: string;
  /** Lower deploys first. The api goes before a frontend that calls it. */
  order: number;
}

/** One request to a live host after the deploy, and the answer it must get. */
export interface SmokeCheck {
  /** A stable name, so a module that adds the row twice adds it once. */
  id: string;
  /** The service whose custom domain answers the request. */
  service: string;
  /** The path to request, starting with `/`. */
  path: string;
  /** The status the answer must carry. */
  status: number;
  /** Text the body must contain, when the status alone proves too little. */
  body?: string;
}
