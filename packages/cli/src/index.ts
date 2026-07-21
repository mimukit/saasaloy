#!/usr/bin/env node
// saasaloy CLI entrypoint. The command surface is stubbed here; implementations
// land per the roadmap in docs/plans/saasaloy-build-spec.md:
//   - Phase 0: `init`, `sync`   (base scaffold + agent-view generation)
//   - Phase 1: `add`, `list`    (local applier over module descriptors)

const COMMANDS: Record<string, string> = {
  init: "scaffold a new Saasaloy project (base: Astro landing + ui + config)",
  add: "apply a module into the current project (resolves dependsOn)",
  list: "list available modules",
  sync: "regenerate agent views (AGENTS.md, CLAUDE.md, .claude/skills links)",
};

function printHelp(): void {
  console.log("saasaloy — composable SaaS accelerator for Cloudflare\n");
  console.log("Usage: saasaloy <command> [options]\n");
  console.log("Commands:");
  for (const [name, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(6)} ${desc}`);
  }
}

function main(argv: string[]): number {
  const [command] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (!(command in COMMANDS)) {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    return 1;
  }

  console.error(`\`saasaloy ${command}\` is not implemented yet.`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
