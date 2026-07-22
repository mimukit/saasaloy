// Console reporter, now grafted onto @clack/prompts' `log.*` (connected-rail
// output) with picocolors for small accents. The call sites are unchanged from
// the original dependency-free shim — same `info/step/success/warn/error` shape.

import { log } from "@clack/prompts";
import pc from "picocolors";

export const logger = {
  info(message: string): void {
    log.info(message);
  },
  step(message: string): void {
    // clack's `log.step` prefixes a green rail marker; keep the copy dim so
    // these read as sub-lines under a heading, matching the old two-space indent.
    log.step(pc.dim(message));
  },
  success(message: string): void {
    log.success(message);
  },
  warn(message: string): void {
    log.warn(message);
  },
  error(message: string): void {
    log.error(message);
  },
};
