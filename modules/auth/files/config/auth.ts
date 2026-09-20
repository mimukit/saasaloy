import { defineSection } from "@repo/config/define";

// `auth`'s config section, installed by `saasaloy add auth` (#154).
//
// It lands in `packages/config/src/sections/` rather than inside `packages/auth`, because
// `@repo/config` is the leaf of the dependency graph: it imports nothing, so everything
// may import it. That is what lets both sides read one copy of these two strings —
// `packages/auth/src/authorize.ts` on the api, and `apps/admin/src/lib/auth.ts` in the
// browser, which cannot import from `@repo/auth/server` at all.
//
// It imports `@repo/config/define` rather than `../define`: a module-shipped section file
// reaches the helper by package subpath, so the file says where it belongs rather than
// where it happens to sit, and it can be read outside a scaffolded project.
//
// These are `config` values and not `env` values: two deployments of the same project
// agree on what its admin role is called, so the string is checked into the repo.

/** The `auth` section. Rename either role in `packages/config/src/project.ts`. */
export function authConfig() {
  return defineSection("auth", {
    /**
     * The site-admin role. better-auth's `admin()` plugin writes this string into
     * `user.role`, and `apps/admin` admits it.
     */
    adminRole: "admin",
    /**
     * The role above `admin`. The first account to sign up wins it, and only it may act
     * inside an organization it does not belong to.
     */
    superadminRole: "superadmin",
  });
}
