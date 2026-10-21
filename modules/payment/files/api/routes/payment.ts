import { createPayment, PaymentError } from "@repo/payment";
import type { PaymentEnv } from "@repo/payment";
import type { AuthDbBindings } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import { Hono } from "hono";
import type { Context } from "hono";

import { createPaymentStore, withPaymentStore } from "../payment-store";

// The public half of the payment capability, mounted at `/payment` by this module's
// `chained-route` patch: the provider callback surface `/payment/callback/:provider/*`.
//
// No session guard here, on purpose. A gateway's notification carries no session and
// arrives while nobody is signed in, and a hosted checkout returns a browser that may not
// be. That is safe because nothing on the request is evidence: the provider verifies every
// fact against its vendor before it reports an outcome, and the core checks that the
// provider owns the payment it reports on.
//
// The core ships no shopper routes. Every app authorizes "may this user pay for this
// order" differently, so an app writes its own route and calls `createPayment(c.env)`.
// The `saasaloy-payment` skill shows the pattern.
//
// Route module contract: ONE chained expression under a NAMED export matching the file.

/** The bindings a payment route needs: the driver's and auth's, plus the payment vars. */
export interface PaymentBindings extends AuthDbBindings {
  [key: string]: unknown;
  PAYMENT_PROVIDER?: string;
  PAYMENT_APP_URL?: string;
  BETTER_AUTH_URL?: string;
}

type PaymentContext = Context<{ Bindings: PaymentBindings }>;

export const paymentRoute = new Hono<{ Bindings: PaymentBindings }>()
  // Both methods: a gateway posts its server-to-server notification, and a browser
  // returns with a GET or a form POST. The core reads two things off the URL, the
  // `:provider` segment and the path after it, and hands the whole `Request` on. It never
  // parses the body: that is the vendor's wire format.
  .get("/callback/:provider/*", (c) => callback(c))
  .post("/callback/:provider/*", (c) => callback(c));

/**
 * One provider callback, whichever method it arrived on. `ignored` and `event` answer 204,
 * a `redirect` answers 303 so a browser that arrived on a POST continues with a GET, and a
 * `response` is served as the provider built it.
 */
function callback(c: PaymentContext) {
  const name = c.req.param("provider") ?? "";
  const marker = `/callback/${name}/`;
  const at = c.req.path.indexOf(marker);
  const path = at === -1 ? "" : c.req.path.slice(at + marker.length);

  return withDb(c, (db) =>
    withPaymentStore(createPaymentStore(db), async () => {
      try {
        const reply = await createPayment(c.env as PaymentEnv).handleCallback(
          name,
          c.req.raw,
          path
        );
        switch (reply.kind) {
          case "redirect": {
            return c.redirect(reply.url, 303);
          }
          case "response": {
            return reply.response;
          }
          default: {
            return c.body(null, 204);
          }
        }
      } catch (error) {
        if (error instanceof PaymentError) {
          return c.json(
            { error: { code: error.code, message: error.message } },
            paymentErrorStatus(error)
          );
        }
        throw error;
      }
    })
  );
}

/**
 * One normalized code, one status. A literal union rather than `number`, because `hc`
 * keys a response type by status code and a widened status would hide the success body.
 * `routes/admin-payment.ts` imports it, so the map lives in one place.
 */
export function paymentErrorStatus(
  error: PaymentError
): 400 | 404 | 409 | 429 | 502 {
  switch (error.code) {
    case "not_found": {
      return 404;
    }
    case "conflict":
    case "duplicate_transaction": {
      return 409;
    }
    case "rate_limited": {
      return 429;
    }
    case "declined":
    case "provider_error": {
      return 502;
    }
    default: {
      // invalid_request, method_unavailable, callback_invalid.
      return 400;
    }
  }
}
