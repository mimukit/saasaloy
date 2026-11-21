// The scripted owner of the agent benchmark's interview mode (plan 0109 phase 8, issue
// #347). Run with `pnpm test:scripts`, or `node --test scripts/agent-bench/interview.test.ts`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  isReadBack,
  looksLikeQuestion,
  newInterview,
  nextMessage,
  parseAnswers,
  PRE_INTERVIEW_FOLLOW_UP,
  questionNumbers,
  readTurnOutput,
} from "./interview.ts";

const ANSWERS = `---
read-back: a
follow-up: Take your first sample answer as written.
---

# Owner answers: Shelfnote

Draft line that is not an answer.

## 1. Name

Shelfnote

## 2. Language

English (\`en\`)

## 14. Preview deploy

a. No, keep it on my machine.
`;

describe("parseAnswers", () => {
  it("reads each numbered section as one answer", () => {
    const answers = parseAnswers(ANSWERS);
    assert.deepEqual(
      [...answers.byNumber.entries()],
      [
        [1, "Shelfnote"],
        [2, "English (`en`)"],
        [14, "a. No, keep it on my machine."],
      ]
    );
  });

  it("reads the read-back and follow-up answers from the frontmatter", () => {
    const answers = parseAnswers(ANSWERS);
    assert.equal(answers.readBack, "a");
    assert.equal(answers.followUp, "Take your first sample answer as written.");
  });

  it("refuses a file with no read-back answer", () => {
    assert.throws(() => parseAnswers("## 1. Name\n\nShelfnote\n"), /read-back/);
  });

  it("refuses a section with no answer under it", () => {
    assert.throws(
      () =>
        parseAnswers(
          "---\nread-back: a\n---\n## 1. Name\n\n## 2. Language\n\nen\n"
        ),
      /question 1/
    );
  });
});

describe("questionNumbers", () => {
  it("reads numbered questions in bold, in a quote and as plain lines", () => {
    const reply = [
      "Two more, then the product part.",
      "",
      "> **11. These are the entities I would build for Shelfnote.**",
      "**12.** Which entity first?",
      "",
      "a. Build these as written.",
    ].join("\n");
    assert.deepEqual(questionNumbers(reply), [11, 12]);
  });

  it("reads plain numbered questions when none is bold", () => {
    assert.deepEqual(
      questionNumbers("13) Which capabilities?\n### 14. Preview deploy?"),
      [13, 14]
    );
  });

  it("reads 'Question 4' and 'Q5' at the start of a line", () => {
    assert.deepEqual(
      questionNumbers("Question 4: who pays?\nQ5. The alternative?"),
      [4, 5]
    );
  });

  it("finds nothing in prose, a decimal or a time", () => {
    assert.deepEqual(
      questionNumbers(
        "I read 2 files and found 15 modules.\nAfter question 10 I write the brief.\n1.5 hours\n12:30 today"
      ),
      []
    );
  });

  it("counts only the bold numbers when some are bold", () => {
    const reply =
      "The plan:\n1. the questions\n2. the read-back\n\n**1. What is it called?**";
    assert.deepEqual(questionNumbers(reply), [1]);
  });
});

describe("isReadBack", () => {
  it("finds the read-back's last prompt", () => {
    assert.equal(isReadBack("...\n> **Build it?**\n> a. Yes"), true);
    assert.equal(isReadBack("Shall I build it? Yes or no."), true);
  });

  it("is false for a reply without it", () => {
    assert.equal(
      isReadBack("**14. Put the finished build on a preview address?**"),
      false
    );
  });
});

describe("looksLikeQuestion", () => {
  it("is true when the last lines ask something", () => {
    assert.equal(looksLikeQuestion("I have a doubt.\n\nWhich currency?"), true);
  });

  it("is true when a line opens with a question and goes on", () => {
    assert.equal(
      looksLikeQuestion(
        "What's the SaaS idea? Give me one or two sentences.\n\nOnce I have that, I'll ask the rest one at a time."
      ),
      true
    );
    assert.equal(
      looksLikeQuestion(
        '## Read-back\n\n- Name: Shelfnote\n\nDo you confirm this read-back? Reply "yes" to start the build.'
      ),
      true
    );
  });

  it("is true when the opening question is bold", () => {
    assert.equal(
      looksLikeQuestion(
        "I've read the README.\n\nFirst question: **what is the product?** Give me one or two sentences."
      ),
      true
    );
    assert.equal(
      looksLikeQuestion(
        "`saasaloy init .` failed.\n\n**What should the project be called?** Give me a name such as `my-app`. I'll scaffold it there."
      ),
      true
    );
  });

  it("is false for a question mark inside a URL", () => {
    assert.equal(
      looksLikeQuestion(
        "Done. The preview is at https://x.dev/?ref=build now."
      ),
      false
    );
  });

  it("is true for sample answers a, b and c", () => {
    assert.equal(
      looksLikeQuestion("Pick one:\na. Monthly\nb. Annual\nc. Both"),
      true
    );
  });

  it("is false for a report that ends the run", () => {
    assert.equal(
      looksLikeQuestion(
        "The build is done. Is it perfect? No.\n\nSee docs/build-log.md."
      ),
      false
    );
  });
});

describe("nextMessage", () => {
  const answers = parseAnswers(ANSWERS);

  it("answers each numbered question in the reply, by number", () => {
    const state = newInterview();
    const step = nextMessage(state, "**1. What is it called?**", answers);
    assert.equal(step.kind, "answers");
    assert.deepEqual(step.numbers, [1]);
    assert.equal(step.message, "1. Shelfnote");
  });

  it("answers a batch in one message", () => {
    const state = newInterview();
    const step = nextMessage(state, "1. Name?\n2. Language?", answers);
    assert.equal(step.message, "1. Shelfnote\n\n2. English (`en`)");
  });

  it("gives the follow-up answer to a question it already answered", () => {
    const state = newInterview();
    nextMessage(state, "1. Name?", answers);
    const step = nextMessage(
      state,
      "1. Can you be more specific about the name?",
      answers
    );
    assert.equal(step.kind, "follow-up");
    assert.equal(step.message, "Take your first sample answer as written.");
  });

  it("points the agent at the interview when it asks before any numbered question", () => {
    const step = nextMessage(
      newInterview(),
      "I've read the README.\n\nFirst question: **what is the product?** Give me one sentence.",
      answers
    );
    assert.equal(step.kind, "follow-up");
    assert.equal(step.message, PRE_INTERVIEW_FOLLOW_UP);
  });

  it("answers the read-back with the read-back answer, and only once", () => {
    const state = newInterview();
    const step = nextMessage(
      state,
      "Everything above.\n\n**Build it?**\na. Yes",
      answers
    );
    assert.equal(step.kind, "read-back");
    assert.equal(step.message, "a");
    assert.equal(state.readBacks, 1);
    const again = nextMessage(state, "**Build it?**", answers);
    assert.equal(again.kind, "stop");
    assert.match(again.reason ?? "", /second read-back/);
  });

  it("stops when the agent ends a turn with no question and no read-back", () => {
    const step = nextMessage(
      newInterview(),
      "Done. The build log is in docs/.",
      answers
    );
    assert.equal(step.kind, "stop");
    assert.match(step.reason ?? "", /no question/);
  });

  it("stops after three follow-ups in a row", () => {
    const state = newInterview();
    for (let n = 0; n < 3; n += 1) {
      assert.equal(nextMessage(state, "Which one?", answers).kind, "follow-up");
    }
    const step = nextMessage(state, "Which one?", answers);
    assert.equal(step.kind, "stop");
    assert.match(step.reason ?? "", /3 replies in a row/);
  });
});

describe("readTurnOutput", () => {
  it("takes the reply, the turns and the cost from a stream-json result event", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "draft" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "**1. Name?**",
        num_turns: 3,
        total_cost_usd: 0.25,
        session_id: "s1",
      }),
    ].join("\n");
    assert.deepEqual(readTurnOutput(stdout), {
      reply: "**1. Name?**",
      numTurns: 3,
      costUsd: 0.25,
      subtype: "success",
    });
  });

  it("falls back to the last assistant text when no result event came", () => {
    const stdout = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "first" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "**2. Language?**" }] },
      }),
      "{ partial",
    ].join("\n");
    assert.deepEqual(readTurnOutput(stdout), { reply: "**2. Language?**" });
  });

  it("reads plain text output as the reply, with no turns and no cost", () => {
    assert.deepEqual(readTurnOutput("  **1. Name?**\n"), {
      reply: "**1. Name?**",
    });
  });
});

describe("the brief folders", () => {
  const briefs = join(import.meta.dirname, "briefs");

  it("each hold a brief, an env file, an expect file and an answers file", () => {
    const names = readdirSync(briefs);
    assert.ok(names.length >= 3, `only ${String(names.length)} brief folders`);
    for (const name of names) {
      for (const file of ["brief.md", "env", "expect.json", "answers.md"]) {
        assert.doesNotThrow(
          () => readFileSync(join(briefs, name, file), "utf-8"),
          `${name}/${file}`
        );
      }
    }
  });

  it("answer questions 1 to 14 and the read-back with a", () => {
    for (const name of readdirSync(briefs)) {
      const answers = parseAnswers(
        readFileSync(join(briefs, name, "answers.md"), "utf-8")
      );
      assert.deepEqual(
        [...answers.byNumber.keys()],
        Array.from({ length: 14 }, (_, i) => i + 1),
        name
      );
      assert.equal(answers.readBack, "a", name);
    }
  });
});
