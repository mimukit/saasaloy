import { API_URL, loginHref } from "./auth";

// The one way this app talks to the api Worker. Call it as `api<Invoice[]>("/billing/
// invoices")` — a leading-slash path, never a full URL. Three things it owns that a
// raw `fetch` gets wrong:
//
//   - the origin. VITE_API_URL is a build-time constant; hardcoding an origin in a
//     page ships a dev URL to production.
//   - `credentials: "include"`. The session cookie is httpOnly and cross-origin, so
//     one forgotten flag is a silently signed-out request, not an error.
//   - the 401. A page that renders an error box for an expired session leaves the
//     user staring at it; this sends them to /login instead.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${status} from the api`);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // `RequestInit["headers"]` is a union: a plain object, a `[name, value][]`, or a
  // `Headers` instance. Spreading it only works for the first — a `Headers` has no own
  // enumerable entries, so `{...headers}` is `{}` and the caller's headers vanish with
  // no error, and an array spreads into numeric keys. The `Headers` constructor takes
  // all three, so build from it and let the caller override the default content type.
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (response.status === 401) {
    // A hard navigation, not a router one: the whole point is to throw away the app's
    // cached session along with the rest of its state. `assign` does not stop this
    // function, so throw as well — otherwise a caller renders against a logged-out
    // response in the frames before the browser tears the document down.
    const from = window.location.pathname + window.location.search;
    window.location.assign(loginHref(from));
    throw new ApiError(401, undefined);
  }

  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) throw new ApiError(response.status, body);

  return body as T;
}
