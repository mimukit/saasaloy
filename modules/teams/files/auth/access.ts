import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// The permission vocabulary for every organization in this project, and the three base
// roles built from it. One file, read by four callers: the server plugin
// (`./plugins/organization.ts`), the client plugin (`./plugins/organization-client.ts`),
// `requireTenant` when it resolves a member's statements, and the admin screens when they
// hide a control.
//
// Imports are limited to `better-auth/plugins/access` and
// `better-auth/plugins/organization/access` on purpose. Both are pure data and pure
// functions, so this file is safe in the browser bundle; pulling anything from
// `better-auth` proper would drag the server into `apps/admin`.
//
// ADDING A RESOURCE is an edit to `statements` below, and nothing else. No module patches
// this file, so a project owns it outright. Add the resource, add its actions, then decide
// which base roles hold it; a custom role picks from whatever is here at runtime.

/**
 * Every resource and its actions. `defaultStatements` is the organization plugin's own
 * set (`organization`, `member`, `invitation`, `team`, `ac`) and must stay spread in
 * first: the plugin's endpoints authorize against those names, so dropping one turns off
 * a built-in endpoint rather than a feature of this project.
 *
 * `project` is the worked example the `multitenant` module ships. `apiKey` is what
 * `@better-auth/api-key` checks before it issues a key. Both are declared here rather
 * than by their own modules, because a role stored in an organization can only pick from
 * statements that exist before it is created.
 */
export const statements = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
} as const;

/** The access controller the plugin, the client and `can()` all resolve roles through. */
export const ac = createAccessControl(statements);

/** Everything, including `ac`, so an owner can define and assign custom roles. */
export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
});

/** Everything an owner holds. The two differ only in what the plugin itself refuses. */
export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete"],
  apiKey: ["create", "read", "update", "delete"],
});

/**
 * Read-only on the project resource, and `ac: ["read"]` so a member can see which roles
 * exist without editing one. A project that wants more gives it to a custom role instead
 * of widening this, because widening it changes every existing member at once.
 */
export const member = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
  ac: ["read"],
});

/**
 * The three roles the plugin falls back on when an organization has stored none of its
 * own. Every one of them has to stay in this map: `updateMemberRole` refuses a role name
 * that exists in neither this map nor the `organizationRole` table, so removing one
 * strands its holders.
 */
export const roles = { owner, admin, member };

/**
 * The base role names, locked. `rbac`'s `roleLockGuard()` refuses `createRole`,
 * `updateRole` and `deleteRole` for any name in this tuple, so nothing can store a row
 * named `admin` and quietly extend the static `admin` above. Only custom roles are
 * created, edited and deleted.
 */
export const BASE_ROLES = ["owner", "admin", "member"] as const;

/** One of the three locked names. */
export type BaseRole = (typeof BASE_ROLES)[number];

/**
 * A permission demand: a resource from `statements` mapped to some of its actions. This
 * is the type `requireCan(c, permissions)` and `can(principal, permissions)` take, so an
 * undeclared resource or a misspelled action is a compile error rather than a check that
 * silently passes.
 */
export type Statements = typeof statements;

export type Permissions = Partial<{
  [Resource in keyof Statements]: Statements[Resource][number][];
}>;
