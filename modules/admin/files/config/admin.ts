import { defineSection } from "@repo/config/define";

// `admin`'s config section, installed by `saasaloy add admin`. Change a value in
// `packages/config/src/project.ts`.

/** The `admin` section. Override it in `packages/config/src/project.ts`. */
export function adminConfig() {
  return defineSection("admin", {
    /**
     * The most users `GET /admin/users` returns in one page, and the page size it uses
     * when the request names none. A request that asks for more gets a 400.
     *
     * What a change costs: a larger page is one heavier query against the users table
     * and a larger response the admin screen renders at once, which a Worker on the
     * Free plan pays for in CPU time. A smaller one means more pages for an operator
     * looking for one user. A whole number above zero.
     */
    userListLimit: 100,
  });
}
