import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beyondRetention,
  buildQueryBody,
  defaultWorker,
  extractEvents,
  formatLine,
  logsEnvPath,
  maskText,
  parseLogsArgs,
  parseTime,
  projectSlug,
  readCredentials,
  runLogs,
} from "./logs-prod.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const TOKEN = "t0k-secret-value";

describe(parseTime, () => {
  it("reads an ISO time", () => {
    expect(parseTime("2026-10-31T10:00Z", NOW)).toBe(
      Date.parse("2026-10-31T10:00:00Z")
    );
  });

  it("reads a span in minutes, hours or days back from now", () => {
    expect(parseTime("30m", NOW)).toBe(NOW - 30 * 60_000);
    expect(parseTime("2h", NOW)).toBe(NOW - 2 * 3_600_000);
    expect(parseTime("3d", NOW)).toBe(NOW - 3 * DAY);
  });

  it("refuses anything else", () => {
    expect(() => parseTime("yesterday", NOW)).toThrow(/not a time/);
    expect(() => parseTime("2w", NOW)).toThrow(/not a time/);
  });
});

describe(parseLogsArgs, () => {
  it("defaults the end and the limit, and leaves the Worker unset", () => {
    expect(
      parseLogsArgs(["--", "--since", "2h", "--search", "reset"], NOW)
    ).toStrictEqual({
      from: NOW - 7_200_000,
      to: NOW,
      search: "reset",
      limit: 200,
    });
  });

  it("reads --until, --limit and --worker", () => {
    expect(
      parseLogsArgs(
        ["--since", "3d", "--until", "1d", "--limit", "50", "--worker", "w"],
        NOW
      )
    ).toStrictEqual({
      from: NOW - 3 * DAY,
      to: NOW - DAY,
      limit: 50,
      worker: "w",
    });
  });

  it("needs --since, and refuses a reversed window, a bad limit and an unknown flag", () => {
    expect(() => parseLogsArgs([], NOW)).toThrow(/--since is required/);
    expect(() =>
      parseLogsArgs(["--since", "1h", "--until", "2h"], NOW)
    ).toThrow(/earlier/);
    expect(() =>
      parseLogsArgs(["--since", "1h", "--limit", "5000"], NOW)
    ).toThrow(/1 to 2000/);
    expect(() => parseLogsArgs(["--since", "1h", "--all"], NOW)).toThrow(
      /Unknown argument/
    );
    expect(() => parseLogsArgs(["--since"], NOW)).toThrow(/needs a value/);
  });
});

describe(beyondRetention, () => {
  it("is true only when the window starts more than 7 days back", () => {
    expect(beyondRetention(NOW - 7 * DAY, NOW)).toBeFalsy();
    expect(beyondRetention(NOW - 7 * DAY - 1, NOW)).toBeTruthy();
  });
});

describe(buildQueryBody, () => {
  it("asks for the Worker's events in the window, without saving the query", () => {
    const body = buildQueryBody({
      from: 1,
      to: 2,
      search: "reset",
      limit: 50,
      worker: "acme-api",
    });
    expect(body).toMatchObject({
      view: "events",
      dry: true,
      limit: 50,
      timeframe: { from: 1, to: 2 },
      parameters: {
        filters: [
          {
            key: "$workers.scriptName",
            operation: "eq",
            type: "string",
            value: "acme-api",
          },
        ],
        needle: { value: "reset", isRegex: false, matchCase: false },
      },
    });
  });

  it("sends no needle without --search", () => {
    const body = buildQueryBody({ from: 1, to: 2, limit: 50, worker: "w" });
    expect(body.parameters).not.toHaveProperty("needle");
  });
});

describe(maskText, () => {
  it("masks the local part of every email address", () => {
    expect(
      maskText("code for m.x+tag@example.com and ana@mail.example.co.uk")
    ).toBe("code for ***@example.com and ***@mail.example.co.uk");
  });

  it("leaves a request id, a timestamp and a phone number alone", () => {
    const line = "req 8f2c01a9 at 1730368800000 to +15551234567";
    expect(maskText(line)).toBe(line);
  });
});

describe(extractEvents, () => {
  it("reads result.events.events oldest first, from a string or a structured source", () => {
    const lines = extractEvents({
      result: {
        events: {
          events: [
            {
              timestamp: 20,
              source: { msg: "email sent", to: "ana@example.com" },
              $metadata: { level: "info", requestId: "r2" },
            },
            {
              timestamp: 10,
              source: "reset requested",
              $metadata: { level: "warn" },
            },
            { timestamp: 30, $metadata: { message: "fallback message" } },
          ],
        },
      },
    });
    expect(lines.map((line) => line.message)).toStrictEqual([
      "reset requested",
      '{"msg":"email sent","to":"ana@example.com"}',
      "fallback message",
    ]);
    expect(
      formatLine(
        lines[1] ?? { timestamp: 0, level: "", requestId: "", message: "" }
      )
    ).toBe(
      '1970-01-01T00:00:00.020Z info r2 {"msg":"email sent","to":"***@example.com"}'
    );
  });

  it("answers an empty list for a response with no events", () => {
    expect(extractEvents({ result: {} })).toStrictEqual([]);
  });
});

describe("projectSlug and logsEnvPath", () => {
  it("slugs the root package name the way the database prefix does, without _dev", () => {
    expect(projectSlug("@acme/shop")).toBe("acme_shop");
    expect(projectSlug("My App")).toBe("my_app");
    expect(projectSlug("---")).toBe("app");
    expect(projectSlug("2fast")).toBe("app");
    expect(logsEnvPath("/home/u", "@acme/shop")).toBe(
      "/home/u/.config/acme_shop/cloudflare-logs.env"
    );
  });
});

describe("files on disk", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "logs-prod-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCredentials(file: string, mode: number): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `# logs only\nCLOUDFLARE_ACCOUNT_ID="acc123"\nCLOUDFLARE_LOGS_API_TOKEN=${TOKEN}\n`
    );
    chmodSync(file, mode);
  }

  describe(readCredentials, () => {
    it("reads both keys from a mode-0600 file", () => {
      const file = path.join(dir, "cloudflare-logs.env");
      writeCredentials(file, 0o600);
      expect(readCredentials(file)).toStrictEqual({
        token: TOKEN,
        account: "acc123",
      });
    });

    it("refuses a missing file, naming the path and the token setup", () => {
      const file = path.join(dir, "absent.env");
      expect(() => readCredentials(file)).toThrow(file);
      expect(() => readCredentials(file)).toThrow(
        /Workers Observability: Read/
      );
    });

    it("refuses a mode-0644 file, naming the path and the chmod", () => {
      const file = path.join(dir, "cloudflare-logs.env");
      writeCredentials(file, 0o644);
      expect(() => readCredentials(file)).toThrow(
        `${file} is mode 644. It holds an API token: run chmod 600 ${file}.`
      );
    });

    it("refuses a file without the token", () => {
      const file = path.join(dir, "cloudflare-logs.env");
      writeFileSync(file, "CLOUDFLARE_ACCOUNT_ID=acc123\n");
      chmodSync(file, 0o600);
      expect(() => readCredentials(file)).toThrow(/needs both/);
    });
  });

  describe(defaultWorker, () => {
    it("reads the name in apps/api/wrangler.jsonc, comments and all", () => {
      mkdirSync(path.join(dir, "apps/api"), { recursive: true });
      writeFileSync(
        path.join(dir, "apps/api/wrangler.jsonc"),
        '{\n  // the api\n  "name": "acme-api",\n  "main": "src/worker.ts",\n}\n'
      );
      expect(defaultWorker(dir)).toBe("acme-api");
    });

    it("is undefined without an api workspace", () => {
      expect(defaultWorker(dir)).toBeUndefined();
    });
  });

  describe(runLogs, () => {
    interface Call {
      url: string;
      init: RequestInit;
    }

    function setUpProject(): string {
      const root = path.join(dir, "repo");
      mkdirSync(path.join(root, "apps/api"), { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "@acme/shop" })
      );
      writeFileSync(
        path.join(root, "apps/api/wrangler.jsonc"),
        '{ "name": "acme-shop-api" }'
      );
      writeCredentials(
        logsEnvPath(path.join(dir, "home"), "@acme/shop"),
        0o600
      );
      return root;
    }

    async function run(
      argv: string[],
      answer: unknown,
      status = 200
    ): Promise<{ calls: Call[]; out: string[] }> {
      const calls: Call[] = [];
      const out: string[] = [];
      await runLogs(argv, {
        root: setUpProject(),
        home: path.join(dir, "home"),
        now: () => NOW,
        fetch: async (url, init) => {
          calls.push({ url, init });
          return await Promise.resolve(Response.json(answer, { status }));
        },
        say: (line) => {
          out.push(line);
        },
      });
      return { calls, out };
    }

    const EVENTS = {
      success: true,
      result: {
        events: {
          events: [
            {
              timestamp: NOW - 60_000,
              source: "code sent to ana@example.com",
              $metadata: { level: "info", requestId: "r1" },
            },
            {
              timestamp: NOW - 120_000,
              source: "reset requested",
              $metadata: { level: "info", requestId: "r0" },
            },
          ],
        },
      },
    };

    it("posts one dry query for the default Worker with the token", async () => {
      const { calls } = await run(
        ["--since", "2h", "--search", "ana@example.com", "--limit", "20"],
        EVENTS
      );
      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call?.url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acc123/workers/observability/telemetry/query"
      );
      expect(call?.init.method).toBe("POST");
      expect(call?.init.headers).toMatchObject({
        authorization: `Bearer ${TOKEN}`,
      });
      expect(JSON.parse(String(call?.init.body))).toMatchObject({
        dry: true,
        limit: 20,
        timeframe: { from: NOW - 7_200_000, to: NOW },
        parameters: {
          filters: [{ value: "acme-shop-api" }],
          needle: { value: "ana@example.com" },
        },
      });
    });

    it("prints masked lines and the oldest time, and never the token", async () => {
      const { out } = await run(
        ["--since", "2h", "--search", "ana@example.com", "--limit", "20"],
        EVENTS
      );
      expect(out.join("\n")).not.toContain(TOKEN);
      expect(out.join("\n")).not.toContain("ana@example.com");
      expect(out).toContain(
        `${new Date(NOW - 60_000).toISOString()} info r1 code sent to ***@example.com`
      );
      expect(out.at(-1)).toBe(
        `2 line(s); the oldest is from ${new Date(NOW - 120_000).toISOString()}.`
      );
      expect(out.join("\n")).not.toMatch(/Warning/);
    });

    it("uses --worker over the wrangler name", async () => {
      const { calls } = await run(
        ["--since", "1h", "--worker", "other"],
        EVENTS
      );
      expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
        parameters: { filters: [{ value: "other" }] },
      });
    });

    it("warns when the window starts beyond 7 days, and says when nothing matched", async () => {
      const { out } = await run(["--since", "8d"], {
        success: true,
        result: { events: { events: [] } },
      });
      expect(out[1]).toMatch(/more than 7 days ago/);
      expect(out.at(-1)).toBe("No lines matched in this window.");
    });

    it("names the needed permission on a 403, and never the token", async () => {
      const failure = run(
        ["--since", "1h"],
        {
          success: false,
          errors: [{ message: "Authentication error" }],
        },
        403
      );
      await expect(failure).rejects.toThrow(
        /answered 403: Authentication error\. The token needs "Workers Observability: Read"/
      );
      await expect(failure).rejects.not.toThrow(TOKEN);
    });
  });
});
