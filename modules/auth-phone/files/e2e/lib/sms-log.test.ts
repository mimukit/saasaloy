import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { consoleSms } from "../../../../sms-console/files/console.ts";
import { verificationCode } from "../../../../sms/files/src/templates/verification-code.ts";
import { codeIn, latestCode, parseSms } from "./sms-log.ts";

// The sample log is what the real console provider prints, captured from its `send()`,
// so a change to the provider's frame turns this test red rather than the e2e run.

async function printed(to: string[], code: string): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...values: unknown[]) => {
    lines.push(values.join(" "));
  };
  try {
    await consoleSms().send(
      {},
      {
        to,
        from: "Playground",
        estimatedSegments: 1,
        ...verificationCode({
          code,
          appName: "Playground",
          expiresInMinutes: 5,
        }),
      }
    );
  } finally {
    console.log = log;
  }
  return `${lines.join("\n")}\n`;
}

describe("parseSms", () => {
  it("reads the recipient and the body of a console block", async () => {
    const log = `[vite] ready\n${await printed(["+12025550150"], "482913")}`;
    const [sms] = parseSms(log);
    assert.deepEqual(sms?.to, ["+12025550150"]);
    assert.match(
      sms?.body ?? "",
      /^482913 is your Playground verification code\./
    );
    assert.equal(sms?.offset, Buffer.byteLength("[vite] ready\n"));
  });

  it("reads every recipient of one message", async () => {
    const [sms] = parseSms(
      await printed(["+12025550150", "+12025550151"], "111111")
    );
    assert.deepEqual(sms?.to, ["+12025550150", "+12025550151"]);
  });

  it("reads a block whose lines carry colour codes", async () => {
    const log = (await printed(["+12025550150"], "482913"))
      .split("\n")
      .map((line) => `\u001B[2m${line}\u001B[22m`)
      .join("\n");
    const [sms] = parseSms(log);
    assert.deepEqual(sms?.to, ["+12025550150"]);
    assert.equal(codeIn(sms?.body ?? ""), "482913");
  });

  it("skips a block the log has not finished writing", async () => {
    const whole = await printed(["+12025550150"], "482913");
    assert.deepEqual(parseSms(whole.slice(0, -10)), []);
  });
});

describe("codeIn", () => {
  it("finds no code in a body that is not a verification code", () => {
    assert.equal(codeIn("Your order 123456 has shipped."), undefined);
  });
});

describe("latestCode", () => {
  it("returns the newest code to the number, after the mark only", async () => {
    const first = await printed(["+12025550150"], "111111");
    const other = await printed(["+12025550199"], "222222");
    const second = await printed(["+12025550150"], "333333");
    const log = `${first}${other}${second}`;
    assert.equal(latestCode(log, "+12025550150", 0), "333333");
    assert.equal(latestCode(log, "+12025550199", 0), "222222");

    const mark = Buffer.byteLength(`${first}${other}${second}`);
    const third = await printed(["+12025550150"], "444444");
    assert.equal(latestCode(`${log}${third}`, "+12025550150", mark), "444444");
    assert.equal(latestCode(log, "+12025550150", mark), undefined);
  });

  it("never matches a number that only starts the same", async () => {
    const log = await printed(["+120255501501"], "555555");
    assert.equal(latestCode(log, "+12025550150", 0), undefined);
  });
});
