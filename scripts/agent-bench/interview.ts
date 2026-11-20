// The scripted owner of the agent benchmark's interview mode (plan 0109 phase 8, issue
// #347): the fixed answers file, how a reply is matched to an answer, and how one agent
// call's output is read.
//
// How a turn runs. A headless agent CLI answers one message and exits; it cannot wait for
// a person. So the harness calls the agent once per turn, in the same session: `claude -p`
// with `--session-id <uuid>` on the first call and `--resume <uuid>` on each later one (see
// `agents/claude.ts`). Each call ends when the agent ends its turn, which in an interview
// is a question. The harness reads the reply, picks the answer, and calls again.
//
// How a reply is matched to an answer. `saasaloy-setup` numbers its questions 1 to 15 so
// the owner can answer by number, and asks them alone or in batches of two or three. The
// harness reads every question number at the start of a line of the reply (`**11. ...**`,
// `12) ...`, `Question 13:`, `Q14.`) that it has not answered yet, and answers each one by
// number in one message.
// A reply that asks something but names no new number is a follow-up: it gets the file's
// `follow-up` answer. Three of those in a row stop the interview. Before the first
// numbered question, the agent has not started `saasaloy-setup` yet, and the file has no
// answer to an unnumbered question such as "What is the product?". So that follow-up
// points the agent at the interview instead, and tells it nothing about the product.
//
// How the read-back and the end are found. The read-back ends with "Build it?". The
// harness answers it with the file's `read-back` answer (a) and then calls nothing more:
// the build runs inside that same call, and the interview ends when the call exits. A
// second "Build it?" stops the interview. A reply with no question and no read-back stops
// it too, because nobody is asking anything.
//
// Imports nothing. Node 24 strips the types, so there is no build step.

/** One brief's answers file, read. */
export interface Answers {
  /** Question number to the owner's answer. */
  byNumber: Map<number, string>;
  /** The answer to the read-back's "Build it?". */
  readBack: string;
  /** The answer to a follow-up that names no new question number. */
  followUp: string;
}

const DEFAULT_FOLLOW_UP =
  "Take your first sample answer as written, and go on to the next question.";

/** The follow-up before any numbered question: start the setup interview. */
export const PRE_INTERVIEW_FOLLOW_UP =
  "Scaffold the project first, then ask me the saasaloy-setup interview questions by their numbers. I will answer them there.";

/**
 * Reads an answers file: YAML-like frontmatter with `read-back:` and an optional
 * `follow-up:`, then one `## <n>. <label>` section per question, the answer under it.
 * Text outside a numbered section is a note for a person and is not sent.
 */
export function parseAnswers(markdown: string): Answers {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const meta = new Map<string, string>();
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end === -1) {
      throw new Error("the answers file's frontmatter has no closing ---");
    }
    for (const line of lines.slice(1, end)) {
      const match = /^([a-z-]+):\s*(.*)$/.exec(line.trim());
      if (match?.[1]) {
        meta.set(match[1], match[2]?.trim() ?? "");
      }
    }
    start = end + 1;
  }
  const readBack = meta.get("read-back");
  if (!readBack) {
    throw new Error("the answers file has no `read-back:` in its frontmatter");
  }

  const byNumber = new Map<number, string>();
  let current: { n: number; body: string[] } | undefined;
  const close = () => {
    if (!current) {
      return;
    }
    const text = current.body.join("\n").trim();
    if (text === "") {
      throw new Error(`question ${String(current.n)} has no answer under it`);
    }
    byNumber.set(current.n, text);
  };
  for (const line of lines.slice(start)) {
    const heading = /^##\s+(\d{1,2})\.\s/.exec(line);
    if (heading?.[1]) {
      close();
      current = { n: Number(heading[1]), body: [] };
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      close();
      current = undefined;
      continue;
    }
    current?.body.push(line);
  }
  close();
  const followUp = meta.get("follow-up") ?? "";
  return {
    byNumber,
    readBack,
    followUp: followUp === "" ? DEFAULT_FOLLOW_UP : followUp,
  };
}

// A numbered question at the start of a line, past any quote, list, heading or bold
// marker: `> **11. These are...**`, `12) Which...`, `### 13. Capabilities`, `Question 4:`,
// `Q5.`. A number inside a sentence ("after question 10 I write the brief") does not count,
// and neither does `1.5` or `12:30`.
const NUMBERED_LINE =
  /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:#{1,6}\s+)?(\*\*|__)?\s*(?:(?:question\s+|q)(\d{1,2})\b|(\d{1,2})[.)](?:\*\*|__)?\s+\S)/i;

/**
 * Every question number the reply names, in order, once each. When any numbered line is
 * bold, as `saasaloy-setup`'s questions are, only the bold ones count, so a plain numbered
 * list in the same reply ("1. the questions, 2. the read-back") is not read as questions.
 */
export function questionNumbers(reply: string): number[] {
  const bold: number[] = [];
  const plain: number[] = [];
  for (const line of reply.split("\n")) {
    const match = NUMBERED_LINE.exec(line);
    const n = Number(match?.[2] ?? match?.[3]);
    if (!match || !Number.isInteger(n) || n <= 0) {
      continue;
    }
    const list = match[1] ? bold : plain;
    if (!list.includes(n)) {
      list.push(n);
    }
  }
  return bold.length > 0 ? bold : plain;
}

/** True when the reply holds the read-back's last prompt, "Build it?". */
export function isReadBack(reply: string): boolean {
  return /\bbuild it\?/i.test(reply);
}

const SAMPLE_LINE = /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:\*\*)?\(?[a-c][.)]\s+\S/i;

// A line whose first sentence is a question, with more after it on the same line: "What's
// the idea? Give me one sentence." or "Is D1 okay? Reply yes to start." A question mark
// after an earlier sentence ("Is it perfect? No." after "The build is done.") does not
// count, and neither does one inside a word, such as a URL's query. Closing bold, quote or
// bracket marks may sit between the question mark and the space.
const LEADING_QUESTION = /^[^.!?]*\?[*_"'`)\]]*(?=\s|$)/;

/**
 * True when the reply asks the owner something: one of its last three lines ends with a
 * question mark or opens with a question, or it offers sample answers a, b and c.
 */
export function looksLikeQuestion(reply: string): boolean {
  const lines = reply
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (
    lines
      .slice(-3)
      .some((line) => /\?\W*$/.test(line) || LEADING_QUESTION.test(line))
  ) {
    return true;
  }
  return lines.filter((line) => SAMPLE_LINE.test(line)).length >= 2;
}

/** What the scripted owner has done so far in one interview. */
export interface InterviewState {
  answered: Set<number>;
  readBacks: number;
  followUpsInARow: number;
}

export function newInterview(): InterviewState {
  return { answered: new Set(), readBacks: 0, followUpsInARow: 0 };
}

export const MAX_FOLLOW_UPS_IN_A_ROW = 3;

export interface Step {
  kind: "answers" | "follow-up" | "read-back" | "stop";
  /** The message to send; absent on a stop. */
  message?: string;
  /** The question numbers this message answers. */
  numbers: number[];
  /** Why the interview stops. */
  reason?: string;
}

/** The scripted owner's next message, given the agent's last reply. */
export function nextMessage(
  state: InterviewState,
  reply: string,
  answers: Answers
): Step {
  if (isReadBack(reply)) {
    state.readBacks += 1;
    if (state.readBacks > 1) {
      return {
        kind: "stop",
        numbers: [],
        reason: "the agent showed a second read-back",
      };
    }
    state.followUpsInARow = 0;
    return { kind: "read-back", message: answers.readBack, numbers: [] };
  }
  const numbers = questionNumbers(reply).filter(
    (n) => answers.byNumber.has(n) && !state.answered.has(n)
  );
  if (numbers.length > 0) {
    state.followUpsInARow = 0;
    for (const n of numbers) {
      state.answered.add(n);
    }
    return {
      kind: "answers",
      message: numbers
        .map((n) => `${String(n)}. ${answers.byNumber.get(n) ?? ""}`)
        .join("\n\n"),
      numbers,
    };
  }
  if (!looksLikeQuestion(reply)) {
    return {
      kind: "stop",
      numbers: [],
      reason: "the agent ended its turn with no question and no read-back",
    };
  }
  if (state.followUpsInARow >= MAX_FOLLOW_UPS_IN_A_ROW) {
    return {
      kind: "stop",
      numbers: [],
      reason: `${String(MAX_FOLLOW_UPS_IN_A_ROW)} replies in a row named no question the answers file holds`,
    };
  }
  state.followUpsInARow += 1;
  return {
    kind: "follow-up",
    message:
      state.answered.size === 0 ? PRE_INTERVIEW_FOLLOW_UP : answers.followUp,
    numbers: [],
  };
}

/** What one agent call reported. A field the output does not hold stays absent. */
export interface TurnOutput {
  reply: string;
  numTurns?: number;
  costUsd?: number;
  subtype?: string;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  result?: unknown;
  num_turns?: unknown;
  total_cost_usd?: unknown;
  message?: { content?: { type?: string; text?: string }[] };
}

/**
 * Reads one agent call's stdout. Claude Code's `stream-json` ends with a `result` event
 * that holds the reply, the number of turns and the cost. With no result event, the
 * reply is the last assistant text; with no JSON at all, it is the whole output. The
 * turns and the cost are then absent: the harness records "unknown", never a guess.
 */
export function readTurnOutput(stdout: string): TurnOutput {
  let result: StreamEvent | undefined;
  let lastText: string | undefined;
  let json = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      // A partial line at the end of a killed call.
      continue;
    }
    json = true;
    if (event.type === "result") {
      result = event;
    } else if (event.type === "assistant") {
      const texts = (event.message?.content ?? [])
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text ?? "");
      if (texts.length > 0) {
        lastText = texts.join("\n");
      }
    }
  }
  if (result) {
    const output: TurnOutput = {
      reply: typeof result.result === "string" ? result.result.trim() : "",
    };
    if (typeof result.num_turns === "number") {
      output.numTurns = result.num_turns;
    }
    if (typeof result.total_cost_usd === "number") {
      output.costUsd = result.total_cost_usd;
    }
    if (result.subtype) {
      output.subtype = result.subtype;
    }
    return output;
  }
  return { reply: (json ? (lastText ?? "") : stdout).trim() };
}
