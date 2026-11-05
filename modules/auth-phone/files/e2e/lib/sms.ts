import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { API_LOG, ROOT } from "./project.ts";
import { latestCode } from "./sms-log.ts";

// `auth-phone`'s e2e helpers: a phone number no other run used, and the one-time codes
// the console SMS provider prints. There is no test-only provider. The api that
// `playwright.config.ts` starts writes its output to `API_LOG` as well, and this file
// reads that log. A reused api must write the same file: see "The api log" in the
// `saasaloy-e2e` skill.
//
// A spec takes a mark before the action that sends the text, then waits for a code sent
// after it:
//
//   const mark = smsMark();
//   await page.getByRole("button", { name: "Send code by SMS" }).click();
//   const code = await smsCode(phone, mark);

/**
 * A number no other run used, `+1 202 555` and four digits from the clock, in seconds.
 * Two runs collide only when they start a multiple of 9,800 seconds apart on a kept
 * database; `pnpm db:drop` clears the numbers past runs made. `0100` to `0199`, the
 * fictional block where the seed numbers live (`+12025550101`, `+12025550102`), are left
 * out. The rest of the exchange is not reserved, which is one more reason `smsMark()`
 * refuses any provider but `console`: no text ever leaves the machine.
 */
export function uniquePhone(): string {
  const stamp = Math.floor(Date.now() / 1000) % 9800;
  const line = stamp < 100 ? stamp : stamp + 100;
  return `+1202555${String(line).padStart(4, "0")}`;
}

/**
 * Refuse to run unless `apps/api/.env` sets `SMS_PROVIDER=console`. Under any other
 * provider the codes never reach the log, and the spec would text a real handset.
 */
function assertConsoleSms(): void {
  const file = path.resolve(ROOT, "apps/api/.env");
  const env = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const provider = /^SMS_PROVIDER=["']?([^"'\s]*)/m.exec(env)?.[1];
  if (provider !== "console") {
    throw new Error(
      `${file} sets SMS_PROVIDER=${provider ?? "(nothing)"}. The phone flows read their codes from the console provider: set SMS_PROVIDER=console, then run pnpm env:setup.`
    );
  }
}

/** The log's size now. Pass it to `smsCode` so an older code never matches. */
export function smsMark(): number {
  assertConsoleSms();
  return existsSync(API_LOG) ? statSync(API_LOG).size : 0;
}

/**
 * Wait for the newest code sent to `phone` (E.164) after `mark`, and return it. Throws
 * after `timeoutMs`, naming the log, so a red run says where to look.
 */
export async function smsCode(
  phone: string,
  mark: number,
  timeoutMs = 15_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(API_LOG)) {
      const code = latestCode(readFileSync(API_LOG, "utf-8"), phone, mark);
      if (code !== undefined) {
        return code;
      }
    }
    await sleep(250);
  }
  throw new Error(
    `No code for ${phone} reached ${API_LOG} within ${String(timeoutMs)} ms. Is SMS_PROVIDER=console in apps/api/.env, and did this run start the api (a reused api writes no log)?`
  );
}
