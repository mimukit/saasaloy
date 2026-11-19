// Keeps the agent report issue form and the `saasaloy-report` base skill in step (plan 0113,
// issue #359). The skill tells an agent to write one `### <heading>` per form field when it
// posts with `gh issue create`, and to use each field id as a query key in a prefilled
// `issues/new?template=agent-report.yml` URL. A field id or a heading that differs between
// the two files gives a report whose fields GitHub does not fill.
//
// The rules:
//
//   - the field ids in `.github/ISSUE_TEMPLATE/agent-report.yml` and in the skill's
//     `## The report's fields` table are the same list, in the same order;
//   - each id has the same heading in both files: the form's `label`, the table's
//     second column;
//   - the form applies `via-agent`, and the label workflow adds it on the body marker
//     the skill writes, with `issues: write` and no other permission.
//
// It reads the YAML as text, line by line, so it needs no YAML parser. Run it with
// `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FORM = join(ROOT, ".github", "ISSUE_TEMPLATE", "agent-report.yml");
const WORKFLOW = join(ROOT, ".github", "workflows", "label-agent-reports.yml");
const SKILL = join(
  ROOT,
  "packages",
  "cli",
  "templates",
  "base",
  "_agents",
  "skills",
  "saasaloy-report",
  "SKILL.md"
);

export interface Field {
  id: string;
  heading: string;
}

/** The fields of an issue form: each body item's `id`, with the `label` that follows it. */
export function formFields(yaml: string): Field[] {
  const fields: Field[] = [];
  let id: string | undefined;
  for (const line of yaml.split("\n")) {
    if (/^ {2}- type:/.test(line)) {
      id = undefined;
      continue;
    }
    const idMatch = /^ {4}id:\s*(\S+)\s*$/.exec(line);
    if (idMatch) {
      id = idMatch[1];
      continue;
    }
    const labelMatch = /^ {6}label:\s*(.+?)\s*$/.exec(line);
    if (labelMatch && id !== undefined) {
      fields.push({ id, heading: labelMatch[1] ?? "" });
      id = undefined;
    }
  }
  return fields;
}

/** The body of the `## <title>` section, up to the next `##` heading. */
function section(markdown: string, title: string): string | undefined {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The rows of the skill's `## The report's fields` table: `| \`id\` | Heading | ... |`. */
export function skillFields(markdown: string): Field[] {
  const body = section(markdown, "The report's fields") ?? "";
  return [...body.matchAll(/^\| `([a-z0-9-]+)` \| ([^|]+?) \|/gm)].map(
    (match) => ({ id: match[1] ?? "", heading: match[2] ?? "" })
  );
}

describe("the field readers", () => {
  it("reads each id with its label, and skips a markdown item", () => {
    const yaml = [
      "body:",
      "  - type: markdown",
      "    attributes:",
      "      value: Hello",
      "  - type: textarea",
      "    id: what-happened",
      "    attributes:",
      "      label: What happened",
      "  - type: input",
      "    id: agent",
      "    attributes:",
      "      label: Agent",
    ].join("\n");
    assert.deepEqual(formFields(yaml), [
      { id: "what-happened", heading: "What happened" },
      { id: "agent", heading: "Agent" },
    ]);
  });

  it("reads the table rows of the fields section only", () => {
    const markdown = [
      "## The report's fields",
      "",
      "| Field id | Heading | What goes in it |",
      "| --- | --- | --- |",
      "| `command` | Failed command and exit code | The command. |",
      "",
      "## Other",
      "",
      "| `agent` | Agent | Not read. |",
    ].join("\n");
    assert.deepEqual(skillFields(markdown), [
      { id: "command", heading: "Failed command and exit code" },
    ]);
  });
});

describe("the agent report form and the saasaloy-report skill", () => {
  const form = readFileSync(FORM, "utf-8");
  const skill = readFileSync(SKILL, "utf-8");

  it("name the same field ids, in the same order", () => {
    const ids = formFields(form).map((field) => field.id);
    assert.deepEqual(ids, [
      "what-happened",
      "command",
      "diagnosis",
      "steps",
      "versions",
      "environment",
      "evidence",
      "related",
      "workaround",
      "agent",
    ]);
    assert.deepEqual(
      skillFields(skill).map((field) => field.id),
      ids
    );
  });

  it("give each field the same heading", () => {
    assert.deepEqual(skillFields(skill), formFields(form));
  });

  it("apply via-agent from the form, and the skill writes the body marker", () => {
    assert.match(form, /^labels: \[via-agent\]$/m);
    assert.match(skill, /^<!-- via-agent -->$/m);
    assert.match(skill, /issues\/new\?template=agent-report\.yml&/);
  });

  it("label a marked issue from a workflow with issues: write and nothing else", () => {
    const workflow = readFileSync(WORKFLOW, "utf-8");
    assert.match(workflow, /^ {4}types: \[opened\]$/m);
    assert.match(workflow, /^permissions:\n {2}issues: write\n\n/m);
    assert.match(
      workflow,
      /if: startsWith\(github\.event\.issue\.body, '<!-- via-agent -->'\)/
    );
    assert.match(workflow, /--add-label via-agent/);
    assert.doesNotMatch(workflow, /\$\{\{\s*github\.event\.issue\.body/);
  });
});
