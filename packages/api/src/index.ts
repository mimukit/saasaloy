import { Hono } from "hono";

const api = new Hono();

api.get("/", (c) => {
  return c.text("Hello Hono!");
});

api.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export { api };
