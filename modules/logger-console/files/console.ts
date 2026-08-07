import type { LoggerEnv, LogEvent, LogProvider } from "../provider";

// The production provider, not a stand-in for one. On Cloudflare Workers `console.*` *is*
// the log pipeline: Workers Logs ingests it and `wrangler tail` streams the same output.
// A structured write to `console` is therefore Workers-native, and costs zero runtime
// dependencies and zero bundle bytes.
//
// This is the exact opposite of `email-console`, which shares the naming pattern and
// nothing else: logging a message instead of sending it is a dev-only substitute, and
// deploying it leaks credentials. Ship this one.
//
// Two details do real work:
//
// 1. **The event goes to `console` as an object, never `JSON.stringify`d.** Workers Logs
//    extracts and indexes the fields of a logged object, so `{ level, message, fields }`
//    is queryable; a pre-stringified line arrives as one opaque `message` string that only
//    a full-text match can find. (Individual logs cap at 256 KB and are flagged
//    `truncated: true` past it, so keep `fields` small.)
// 2. **The console method matches the level**, so the platform's own severity
//    classification agrees with ours instead of filing every line as `log`.
//
// The factory is `consoleLogger`, not `console`, so the generated import in
// packages/logger/src/index.ts can't shadow the global `console`. The provider's *name* —
// the value LOGGER_PROVIDER takes — is still plain "console".

export function consoleLogger(): LogProvider {
  return {
    name: "console",

    write(_env: LoggerEnv, event: LogEvent): void {
      switch (event.level) {
        case "warn":
          console.warn(event);
          break;
        case "error":
        case "fatal":
          // `fatal` has no separate console method, and inventing one would only cost the
          // platform's severity mapping. The level stays on the event either way.
          console.error(event);
          break;
        default:
          console.log(event);
      }
    },
  };
}
