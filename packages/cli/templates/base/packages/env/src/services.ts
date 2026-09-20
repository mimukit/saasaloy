// The service table: which file each service's values land in, which environment fills
// it, and which keys never reach it.
//
// A *service* is a workspace that reads a `.env` at runtime or at build time. The name is
// the workspace directory, not the module that installed it. The base seeds the `web` row
// because the base template ships `apps/web`; `saasaloy add api`, `admin` and `infra` each
// append their own row with a `const-array` patch.

export type Environment = "dev" | "prod";

export interface Service {
  /** The service name, which is also the name a `# @services` line uses. */
  name: string;
  /** The `.env` this service reads, relative to the repository root. */
  file: string;
  /** The one environment this service's file is written from. */
  environment: Environment;
  /** Keys a value source holds that must never reach this file. */
  omit: string[];
}

/**
 * The repository's one checked-in key list, relative to the repository root.
 *
 * There is no per-workspace example and no `.dev.vars.example`. A key belongs to a service
 * because a `# @services` line in this file names it, which keeps one comment, one local
 * default and one place to edit for a key several services read.
 */
export const ENV_EXAMPLE = "packages/env/.env.example";

/** The gitignored file the built-in `local` value source reads. `saasaloy env` writes it. */
export const LOCAL_VALUES = "packages/env/.env";

/**
 * Keep this line in exactly this shape: `export const SERVICES = [...]` with a real array
 * literal. The codemod behind the `const-array` patch kind has nothing to push into
 * otherwise, and `saasaloy add api` fails silently.
 */
export const SERVICES: Service[] = [
  { name: "web", file: "apps/web/.env", environment: "dev", omit: [] },
];

export function serviceNames(): string[] {
  return SERVICES.map((service) => service.name);
}

export function findService(name: string): Service | undefined {
  return SERVICES.find((service) => service.name === name);
}

/**
 * Keys this checkout owns once a tool has written them. A pull keeps the value on disk
 * whoever wrote it, so `pnpm db:setup`'s branch `DATABASE_URL` survives `pnpm env:setup`.
 *
 * `packages/env` never learns what a database is; it only learns that some key is the
 * checkout's to set.
 */
export const CHECKOUT_OWNED_KEYS: string[] = ["DATABASE_URL"];

/**
 * The services `env:setup` writes for `environment`, or the one `only` names.
 *
 * `--env prod` refuses to act without `--only`. Two independent guards sit on the one
 * command that can put a live credential on disk: this one, and the refusal in `setup.ts`
 * to write production values into a workspace under `apps/`.
 */
export function selectServices(
  environment: Environment,
  only?: string
): Service[] {
  const forEnvironment = SERVICES.filter(
    (service) => service.environment === environment
  );
  if (only === undefined) {
    if (environment === "prod") {
      throw new Error(
        "--env prod writes one file only. Name it: pnpm env:setup --env prod --only infra."
      );
    }
    return forEnvironment;
  }
  const service = forEnvironment.find((candidate) => candidate.name === only);
  if (!service) {
    throw new Error(
      `--only ${only} is not a ${environment} service. Choose ${
        forEnvironment.map((candidate) => candidate.name).join(", ") || "none"
      }.`
    );
  }
  return [service];
}
