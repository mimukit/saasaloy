// `pnpm db:prune`: on D1 there is nothing to prune, and this script says why.
//
// The Postgres driver's `db:prune` drops the branch databases a server keeps after their
// worktree is gone. D1 keeps each local database in `apps/api/.wrangler/state`, inside the
// worktree, so removing the worktree removes its database. The script exists so both drivers
// expose the same `db:*` commands, and the worktree setup and a person's habit work on
// either one. It drops nothing and touches nothing remote.

process.stdout.write(
  "D1 keeps each local database in apps/api/.wrangler/state inside its own worktree, so it goes when the worktree goes. Nothing to prune.\n"
);
