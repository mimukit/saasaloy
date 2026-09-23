// The default validator, re-exported so a capability preset has one import and the pin is
// declared once, in this package's `package.json`.
//
// `packages/env` itself never imports this file. Everything under `./define` and
// `./schema` types against Standard Schema, which is what makes the swap to valibot or
// arktype a change to the presets and nothing else.

export { z } from "zod";
