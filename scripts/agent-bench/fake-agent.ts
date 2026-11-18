// A fake agent command for the harness test (issue #347). It plays the agent's side of
// the agent command contract in `agents/claude.ts` with no model: it asks questions 1 to
// 15 in batches, shows the read-back, and on the answer `a` writes a tiny project and
// ends its turn. Each call prints a Claude Code style `result` event, except the read-back
// call when FAKE_AGENT_PLAIN is set, which prints plain text so the harness must record
// the turns and the cost as unknown.
//
// It records what it saw in `$AGENT_BENCH_STATE/fake-agent.jsonl`, so the test can check
// the turn numbers, the session, the stdin and the environment the harness passed.
//
// It also plays the second agent of the agent-use line (issue #348): a message that asks
// for a `READ BACK:` line gets one Bash call that sends an MCP `tools/call`, and the reply
// `READ BACK: fake_1`. It contacts nothing. FAKE_AGENT_EXIT makes that call exit with
// the given code.

import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
}
const message = Buffer.concat(chunks).toString("utf-8");
const turn = Number(process.env.AGENT_BENCH_TURN);
const state = process.env.AGENT_BENCH_STATE ?? ".";

appendFileSync(
  join(state, "fake-agent.jsonl"),
  `${JSON.stringify({
    turn,
    session: process.env.AGENT_BENCH_SESSION,
    message,
    cwd: process.cwd(),
    empty: readdirSync(process.cwd()).length === 0,
    block: process.env.DEV_PORTS_BLOCK,
    registry: process.env.SAASALOY_REGISTRY_DIR,
    path: process.env.PATH,
    githubToken: process.env.GITHUB_TOKEN ?? null,
  })}\n`
);

const QUESTIONS: Record<number, string> = {
  1: "**1. What is the product called?**",
  2: "**2. Which language?**\n\n**3. Who pays?**",
  3: "**4. What goes wrong?**\n**5. What do they use now?**\n**6. What is different?**",
  4: "**7. Proof?**\n**8. Tone?**",
  5: "Can you be more specific about the tone?",
  6: "**9. Pricing?**\n**10. Where does sign up go?**",
  7: "**11. These are the entities I would build.**",
  8: "**12. Which order?**\n**13. Which capabilities?**\n**14. Which driver?**",
  9: "**15. Put the finished build on a preview address?**",
  10: "Here is everything.\n\n**Build it?**\na. Yes\nb. Ask me\nc. Change",
};

function result(reply: string): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    result: reply,
    num_turns: 2,
    total_cost_usd: 0.01,
  });
}

if (message.includes("READ BACK")) {
  console.log(
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: {
              command: `curl -s -X POST <api>/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/call"}'`,
            },
          },
        ],
      },
    })
  );
  console.log(
    result("I created one item and read it back.\n\nREAD BACK: fake_1")
  );
  process.exit(Number(process.env.FAKE_AGENT_EXIT ?? "0"));
} else if (turn <= 10) {
  console.log(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "thinking" }] },
    })
  );
  console.log(result(QUESTIONS[turn] ?? ""));
} else {
  const project = join(process.cwd(), "fake");
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(join(project, "saasaloy.json"), "{}\n");
  writeFileSync(
    join(project, "docs/product-brief.md"),
    "---\nautonomy: afk\ndeploy: none\n---\n# Product brief\n"
  );
  const reply =
    "Starting the build now.\n\nThe build is done. See docs/build-log.md.";
  console.log(process.env.FAKE_AGENT_PLAIN ? reply : result(reply));
}
