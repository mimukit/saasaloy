import path from "node:path";
import { blankOnPurposeKeys, incompleteKeys } from "./check.ts";
import { planEnv } from "./dotenv.ts";
import {
  readEnvFile,
  readLegacyDevVars,
  removeLegacyDevVars,
  writeEnvFile,
} from "./env-file.ts";
import { readExample } from "./example.ts";
import { CHECKOUT_OWNED_KEYS } from "./services.ts";
import type { Environment, Service } from "./services.ts";
import { EnvError } from "./sources.ts";
import type { EnvSource } from "./sources.ts";

// `pnpm env:setup` end to end: load every service's values first, check them all, and only
// then write. A failed load or a failed check leaves every file exactly as it was.

export interface ServiceReport {
  service: string;
  file: string;
  created: boolean;
  /** Keys the source holds that the example does not list for this service. */
  extraKeys: string[];
  /** True when a leftover `.dev.vars` beside this file was carried across and deleted. */
  migrated: boolean;
}

export type SetupReport =
  | { kind: "written"; services: ServiceReport[] }
  | { kind: "kept"; files: string[]; reason: string };

/** The `.dev.vars` this capability replaced, beside a service's `.env`. */
export function legacyDevVarsPath(file: string): string {
  return path.join(path.dirname(file), ".dev.vars");
}

export async function setupServices(options: {
  root: string;
  environment: Environment;
  services: Service[];
  source: EnvSource;
  processEnv: Record<string, string | undefined>;
}): Promise<SetupReport> {
  const { root, environment, services, source, processEnv } = options;

  for (const service of services) {
    if (environment === "prod" && service.file.startsWith("apps/")) {
      throw new Error(
        `Refusing to write production values to ${service.file}. wrangler dev and vite dev both read that file.`
      );
    }
  }

  const planned: {
    service: Service;
    target: string;
    exists: boolean;
    legacy: string | undefined;
    plan: ReturnType<typeof planEnv>;
  }[] = [];

  try {
    for (const service of services) {
      const example = readExample(root, service.name);
      const target = path.join(root, service.file);
      const existing = readEnvFile(target);
      const legacyPath = legacyDevVarsPath(target);
      const legacy = readLegacyDevVars(legacyPath);

      // A checkout-owned key keeps whatever this checkout already set, whether that came
      // from `.env` or from the `.dev.vars` this run is about to retire.
      const keep = new Map<string, string>();
      for (const key of CHECKOUT_OWNED_KEYS) {
        const value = existing.values.get(key) ?? legacy.get(key);
        if (value !== undefined && value !== "") {
          keep.set(key, value);
        }
      }

      const values = new Map(
        await source.load({ root, service, environment, processEnv })
      );
      // A value already on disk answers a key the source does not hold, which is what
      // carries a developer's hand-typed `.dev.vars` across.
      for (const [key, value] of [...legacy, ...existing.values]) {
        const held = values.get(key);
        if (value !== "" && (held === undefined || held === "")) {
          values.set(key, value);
        }
      }

      planned.push({
        service,
        target,
        exists: existing.exists,
        legacy: legacy.size > 0 ? legacyPath : undefined,
        plan: planEnv({
          example,
          values,
          blankOnPurpose: blankOnPurposeKeys(example),
          keep,
          omit: service.omit,
        }),
      });
    }
  } catch (error) {
    if (!(error instanceof EnvError && error.code === "unreachable")) {
      throw error;
    }
    return keepComplete(root, services, error.message);
  }

  const missing = planned.flatMap(({ service, plan }) =>
    plan.missingKeys.length > 0
      ? [`${service.name} has no value for ${plan.missingKeys.join(", ")}`]
      : []
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join("; ")}. Set them at the value source, or mark them "# Blank on purpose" in packages/env/.env.example.`
    );
  }

  return {
    kind: "written",
    services: planned.map(({ service, target, exists, legacy, plan }) => {
      writeEnvFile(target, plan.lines);
      const migrated = legacy !== undefined && removeLegacyDevVars(legacy);
      return {
        service: service.name,
        file: service.file,
        created: !exists,
        extraKeys: plan.extraKeys,
        migrated,
      };
    }),
  };
}

/** The source did not answer: keep every file when all are complete, and fail otherwise. */
function keepComplete(
  root: string,
  services: Service[],
  reason: string
): SetupReport {
  const problems = services.flatMap((service) => {
    const file = readEnvFile(path.join(root, service.file));
    if (!file.exists) {
      return [`${service.file} does not exist`];
    }
    const example = readExample(root, service.name);
    const missing = incompleteKeys(example, file.values, service.omit);
    return missing.length > 0
      ? [`${service.file} has no value for ${missing.join(", ")}`]
      : [];
  });
  if (problems.length > 0) {
    throw new Error(
      `${reason} ${problems.join("; ")}, so there is nothing safe to keep.`
    );
  }
  return {
    kind: "kept",
    files: services.map((service) => service.file),
    reason,
  };
}
