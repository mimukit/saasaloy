import { auth } from "./auth";

export { auth };

// The protected-route recipe: read the session off any inbound Request's headers
// (the httpOnly cookie rides along automatically), return null when there isn't one.
// A route does `const session = await getSession(c.req.raw); if (!session) return c.json({}, 401);`
// — no route ever imports `better-auth` directly (ADR 0020).
export async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}
