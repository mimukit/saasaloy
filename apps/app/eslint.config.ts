import { tanstackConfig } from "@repo/eslint-config/tanstack";
import type { Linter } from "eslint";

const config: Array<Linter.Config> = [...tanstackConfig];

export default config;
