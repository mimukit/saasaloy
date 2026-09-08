import { defineJob } from "../define";
import type { Job } from "../provider";

// A worked example of the job contract. Copy this file to start a real one, then delete
// this one and its line from the `jobs` table in `src/index.ts`.
//
// A job is a factory returning `defineJob(...)`, not a bare constant, because the `jobs`
// table registers a *call* — `exampleJob()` — and that is the shape the `plugin-array`
// patch appends and removes. Keep it that way and `saasaloy remove` can take the line
// back out.
//
// Enqueue it from a route:
//
//   await createQueue(c.env).enqueue("example", { message: "hello" });

export interface ExamplePayload {
  message: string;
}

export const exampleJob = (): Job =>
  defineJob<ExamplePayload>({
    // A schema is optional. Pass any Standard Schema — a zod object, a valibot schema —
    // and the core validates the payload at `enqueue` and again on delivery. Without
    // one the payload reaches the handler exactly as it was sent, and the handler owns
    // the checking.
    //
    // Wrap each unit of work in `ctx.step`. On a provider that cannot checkpoint the
    // step just runs; on one that can, it runs once and replays on a later attempt.
    // Writing it this way now costs nothing and is what makes the handler portable.
    handler: (payload, ctx) =>
      ctx.step("log", () => {
        console.log(
          `[queue] example job, attempt ${ctx.attempt}: ${payload.message}`
        );
      }),
    name: "example",
  });
