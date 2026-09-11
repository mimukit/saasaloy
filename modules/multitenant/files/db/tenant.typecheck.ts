import { project } from "./schema/projects";
import { asTenantId, forTenant } from "./tenant";
import type { Db } from "./client";

// The isolation proof, as a type test. It ships no runtime behaviour and nothing imports
// it; `tsc --noEmit` is the whole point, and `pnpm typecheck` in this package runs it.
//
// Why a type test and not a unit test: this project ships no test runner in
// `packages/db`, and the guarantees below are compile-time guarantees anyway. A test that
// asserted them at runtime would be asserting something the compiler already refused to
// emit.
//
// EVERY `@ts-expect-error` BELOW IS A LOAD-BEARING ASSERTION. `tsc` fails when one of
// them stops being an error, so deleting the guard in `./tenant.ts` turns each unused
// directive into a compile failure here. If you change the guard on purpose, change these
// lines in the same commit and say why. Do not silence one.
//
// Nothing here names a dialect. It reads the table type off `Db`, so this file compiles
// unchanged under `database-d1` and `database-postgres`.

declare const db: Db;

// A tenant id that came from `requireTenant`. Everything below is checked against it.
const tenantId = asTenantId("org_real");
const scoped = forTenant(db, tenantId);

// 1. A plain string is not a `TenantId`.
//
// This is the one that matters most in review: a route that reads `x-organization-id`
// itself, or takes an organization id out of a request body, hands `forTenant` a raw
// string. The brand refuses it, so that route does not compile.
// @ts-expect-error a raw string is not a TenantId — only requireTenant mints one
forTenant(db, "org_from_the_request_body");

// The same refusal for the header case, spelled out, because it is the attack.
declare const headerValue: string;
// @ts-expect-error a header value is a string, and a string is not a TenantId
forTenant(db, headerValue);

// 2. A table with no tenant column does not fit `TenantTable`.
//
// `notScoped` is any table of this project's dialect that skipped the convention, so it
// stands for every table a project adds without reading the skill.
declare const notScoped: Parameters<Db["insert"]>[0];

// @ts-expect-error the table declares no organizationId column
scoped.select(notScoped);

// @ts-expect-error the same table cannot be inserted into through the guard either
scoped.insert(notScoped, { id: "x" });

// 3. An insert may not name the tenant id, and may not omit a required column.
//
// `forTenant` forces `organizationId` itself. Passing one is rejected rather than
// ignored, so a request body spread into `values` cannot smuggle another organization's
// id past the guard.
// @ts-expect-error organizationId is supplied by forTenant, never by the caller
scoped.insert(project, { id: "p_1", name: "one", organizationId: "org_other" });

// @ts-expect-error name is not optional on project
scoped.insert(project, { id: "p_1" });

// 4. An update may not set the tenant id either, which is how a row would be moved
// between organizations.
// @ts-expect-error organizationId is not settable through the guard
scoped.update(project, { organizationId: "org_other" });

// The shapes that are supposed to compile. They are here so a change that broke the
// guard by making everything an error would fail this file too, rather than passing it.
scoped.select(project);
scoped.insert(project, { id: "p_1", name: "one" });
scoped.update(project, { name: "renamed" });
scoped.delete(project);
