import { config } from "@repo/config";
import { verifications } from "@repo/db/schema/auth";
import { testDatabase } from "@repo/db/testing";
import type { EmailMessage } from "@repo/email";
import { describe, expect, it, vi } from "vitest";
import app from "../index";

// The password reset mail that `@repo/auth/plugins/reset-password-mail.ts` sends. `auth`
// ships this test only when `email` is installed and testing is on, the same condition
// as the plugin.
//
// `createEmail` is replaced with a sender that keeps each message, so the test reads the
// rendered mail without an `EMAIL_PROVIDER` and whatever provider the project installed.
// Everything else in `@repo/email`, the template and its `safeUrl` check included, is the
// real code.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const sent = vi.hoisted((): EmailMessage[] => []);

vi.mock(import("@repo/email"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createEmail: () => ({
      provider: "test",
      send: async (message: EmailMessage) => {
        sent.push(message);
        return { messageId: `test-${sent.length}` };
      },
    }),
  };
});

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

function requestReset(env: object, email: string) {
  return app.request(
    "/auth/request-password-reset",
    {
      body: JSON.stringify({
        email,
        redirectTo: "http://localhost:3000/reset-password",
      }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env
  );
}

describe("POST /auth/request-password-reset", () => {
  it("mails a reset link to a known address", async () => {
    sent.length = 0;
    const res = await requestReset(database.env, "member@example.test");

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail?.to).toBe("member@example.test");
    expect(mail?.subject).toBe(`Reset your ${config.app.name} password`);
    expect(mail?.html).toContain("/auth/reset-password/");
  });

  it("escapes the name and stores one reset token", async () => {
    sent.length = 0;
    await requestReset(database.env, "member@example.test");

    expect(sent[0]?.html).toContain("Grace&#32;Member");
    const rows = await database.db.select().from(verifications);
    expect(
      rows.filter((row) => row.identifier.startsWith("reset-password:"))
    ).toHaveLength(1);
  });

  it("answers the same for an unknown address and sends nothing", async () => {
    sent.length = 0;
    const res = await requestReset(database.env, "nobody@example.test");

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });
});
