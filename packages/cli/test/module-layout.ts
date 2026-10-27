// The project layout of every module file, for `pnpm test:modules` (issue #243).
//
// A module unit test ships into a project and imports its neighbours by their project
// paths: `./authorize` beside `packages/auth/src/tenant-rules.ts`, `../index` from
// `packages/kv/src/providers/memory.ts`, `@repo/ui/lib/shell/commands`. In this repo those
// files sit in different modules' `files/` folders, so the same import would miss on disk.
//
// `moduleLayout()` reads every descriptor and the base template and maps each project path
// to the repo file `saasaloy add` copies there. The Vite plugin then resolves an import from
// a module file the way the project would: it turns the importer into its project path,
// resolves the specifier against that path (or through the workspace's `exports` map for a
// `@repo/*` name), and answers with the repo file that lands at the result. An import the
// layout does not know falls through to Vite, so a vendor package or a sibling on disk
// behaves exactly as before.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { Plugin } from "vitest/config";

interface Entry {
  path: string;
  target: string;
}

interface Descriptor {
  files?: Entry[];
  scaffolds?: {
    workspace?: string;
    aliases?: Record<string, string>;
    files?: Entry[];
  }[];
}

interface Workspace {
  dir: string;
  exports: Record<string, string>;
}

export interface ModuleLayout {
  /** Project path (repo-root relative, posix) → every repo file that lands there. */
  files: Map<string, string[]>;
  /** Repo file → the project path it lands at. */
  projectPath: Map<string, string>;
  /** `@repo/<name>` → the workspace directory and its `exports` map. */
  workspaces: Map<string, Workspace>;
}

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

/** Every file under a directory, as paths relative to it. */
function walk(root: string, dir = ""): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.name === "node_modules") {
        return [];
      }
      return entry.isDirectory() ? walk(root, rel) : [rel];
    }
  );
}

/** Reads every descriptor under `<repo>/modules` and the base template under `base`. */
export function moduleLayout(repo: string, base: string): ModuleLayout {
  const layout: ModuleLayout = {
    files: new Map(),
    projectPath: new Map(),
    workspaces: new Map(),
  };
  const add = (project: string, source: string): void => {
    const list = layout.files.get(project) ?? [];
    list.push(source);
    layout.files.set(project, list);
    layout.projectPath.set(source, project);
  };
  const addWorkspace = (dir: string, manifest: string): void => {
    const pkg = readJson<{
      name?: string;
      exports?: Record<string, string> | string;
    }>(manifest);
    if (pkg.name !== undefined) {
      const exports =
        typeof pkg.exports === "string"
          ? { ".": pkg.exports }
          : (pkg.exports ?? {});
      layout.workspaces.set(pkg.name, { dir, exports });
    }
  };

  for (const file of walk(base)) {
    add(file, join(base, file));
    if (file.endsWith("/package.json") && file.split("/").length === 3) {
      addWorkspace(dirname(file), join(base, file));
    }
  }

  const modules = join(repo, "modules");
  const descriptors = readdirSync(modules)
    .filter((name) => existsSync(join(modules, name, "registry-item.json")))
    .map((name) => ({
      dir: join(modules, name),
      descriptor: readJson<Descriptor>(
        join(modules, name, "registry-item.json")
      ),
    }));

  const aliases = new Map(
    Object.entries(
      readJson<{ aliases: Record<string, string> }>(join(base, "saasaloy.json"))
        .aliases
    )
  );
  for (const { descriptor } of descriptors) {
    for (const scaffold of descriptor.scaffolds ?? []) {
      for (const [alias, target] of Object.entries(scaffold.aliases ?? {})) {
        aliases.set(alias, target);
      }
    }
  }
  const unalias = (target: string): string => {
    const [head, ...rest] = target.split("/");
    const root = head === undefined ? undefined : aliases.get(head);
    return root === undefined ? target : posix.join(root, ...rest);
  };

  for (const { dir, descriptor } of descriptors) {
    for (const entry of descriptor.files ?? []) {
      add(unalias(entry.target), join(dir, entry.path));
    }
    for (const scaffold of descriptor.scaffolds ?? []) {
      const workspace = scaffold.workspace ?? ".";
      for (const entry of scaffold.files ?? []) {
        const project = posix.join(workspace, entry.target);
        add(project, join(dir, entry.path));
        if (entry.target === "package.json") {
          addWorkspace(workspace, join(dir, entry.path));
        }
      }
    }
  }
  return layout;
}

/** The project path a `@repo/<name>/<sub>` specifier points at, through the `exports` map. */
function exportTarget(
  layout: ModuleLayout,
  specifier: string
): string | undefined {
  const parts = specifier.split("/");
  const name = parts.slice(0, 2).join("/");
  const workspace = layout.workspaces.get(name);
  if (workspace === undefined) {
    return undefined;
  }
  const subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  for (const [key, value] of Object.entries(workspace.exports)) {
    if (key === subpath) {
      return posix.join(workspace.dir, value);
    }
    const star = key.indexOf("*");
    if (
      star !== -1 &&
      subpath.startsWith(key.slice(0, star)) &&
      subpath.endsWith(key.slice(star + 1))
    ) {
      const match = subpath.slice(
        star,
        subpath.length - (key.length - star - 1)
      );
      return posix.join(workspace.dir, value.replace("*", match));
    }
  }
  return undefined;
}

/**
 * Resolves imports from module files by their project paths. When two modules write the
 * same path (a driver pair, two app shells), the importer's own module wins, then the
 * first module in name order.
 */
export function moduleLayoutPlugin(repo: string, base: string): Plugin {
  const layout = moduleLayout(repo, base);
  const modules = join(repo, "modules");
  const pick = (project: string, importer: string): string | undefined => {
    for (const extension of EXTENSIONS) {
      const sources = layout.files.get(`${project}${extension}`);
      if (sources !== undefined) {
        const own = importer.slice(0, importer.indexOf("/files/") + 1);
        return sources.find((source) => source.startsWith(own)) ?? sources[0];
      }
    }
    return undefined;
  };
  return {
    name: "saasaloy-module-layout",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer === undefined || !importer.startsWith(modules)) {
        return null;
      }
      if (source.startsWith("@repo/")) {
        const target = exportTarget(layout, source);
        return target === undefined ? undefined : pick(target, importer);
      }
      if (!source.startsWith("./") && !source.startsWith("../")) {
        return null;
      }
      // A repo-only test has no entry of its own, so it sits where the file it tests lands.
      const from =
        layout.projectPath.get(importer) ??
        layout.projectPath.get(importer.replace(/\.vitest\.ts$/, ".ts"));
      if (from === undefined) {
        return null;
      }
      return pick(posix.join(posix.dirname(from), source), importer);
    },
  };
}
