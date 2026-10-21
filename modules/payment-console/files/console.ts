import { PaymentError } from "../provider";
import type {
  CallbackContext,
  CallbackResult,
  CreateResult,
  Payment,
  PaymentEnv,
  PaymentMethod,
  PaymentOutcome,
  PaymentProvider,
  ProviderCreateInput,
  RefundInput,
  RefundResult,
} from "../provider";

// The development provider: a fake hosted checkout. `create` answers a redirect to a page
// this provider serves itself, at `/payment/callback/console/checkout/<id>`, with a Pay
// and a Cancel button. The form posts to `/payment/callback/console/complete`, and the
// core moves the payment to `successful` or `cancelled` before the browser goes back to
// the payment's return URL. No account, no network, no secret.
//
// It exercises the redirect path a manual provider never takes: the callback route, the
// conditional update out of `pending`, the event row and the listeners all run for real.
//
// Never list it in PAYMENT_PROVIDER in a deployed environment. Anyone who can reach the
// api can post "Pay" for any pending console payment, which is the whole point in
// development and a free order in production.
//
// The factory is `consolePayment`, not `console`, so the generated import in
// packages/payment/src/index.ts cannot shadow the global `console`. The provider's name,
// the value PAYMENT_PROVIDER lists, is plain "console".

const CHECKOUT = "checkout/";
const COMPLETE = "complete";

export function consolePayment(): PaymentProvider {
  return {
    name: "console",

    methods(_env: PaymentEnv): PaymentMethod[] {
      return [{ available: true, id: "card", label: "Card (console)" }];
    },

    create(
      _env: PaymentEnv,
      input: ProviderCreateInput
    ): Promise<CreateResult> {
      return Promise.resolve({
        kind: "redirect",
        url: input.callbackUrl(`${CHECKOUT}${input.payment.id}`),
      });
    },

    refund(
      _env: PaymentEnv,
      payment: Payment,
      input: RefundInput
    ): Promise<RefundResult> {
      const providerRefundId = `console-refund-${crypto.randomUUID()}`;
      console.log(
        `payment (console provider): refunded ${String(input.amount)} ${payment.currency} on ${payment.id} as ${providerRefundId}`
      );
      return Promise.resolve({ providerRefundId });
    },

    async handleCallback(
      _env: PaymentEnv,
      request: Request,
      path: string,
      ctx: CallbackContext
    ): Promise<CallbackResult> {
      if (request.method === "GET" && path.startsWith(CHECKOUT)) {
        const id = decodeURIComponent(path.slice(CHECKOUT.length));
        const payment = await ctx.payment(id);
        if (!payment || payment.provider !== "console") {
          throw new PaymentError(
            "not_found",
            `No console payment with id "${id}".`
          );
        }
        return { kind: "response", response: html(checkoutPage(payment)) };
      }

      if (request.method === "POST" && path === COMPLETE) {
        const form = await request.formData().catch(() => {
          throw new PaymentError(
            "callback_invalid",
            "The console checkout posts a form; this request carried none."
          );
        });
        const id = form.get("paymentId");
        const action = form.get("action");
        if (
          typeof id !== "string" ||
          (action !== "pay" && action !== "cancel")
        ) {
          throw new PaymentError(
            "callback_invalid",
            'The console checkout form needs "paymentId" and an "action" of pay or cancel.'
          );
        }
        const payment = await ctx.payment(id);
        if (!payment) {
          throw new PaymentError(
            "callback_invalid",
            `No payment with id "${id}".`
          );
        }

        const outcome: PaymentOutcome =
          action === "pay"
            ? {
                paymentId: id,
                settledAmount: payment.amount,
                status: "successful",
                transactionId: `console-${id}`,
              }
            : { paymentId: id, status: "cancelled" };

        if (payment.returnUrl) {
          return { kind: "redirect", outcome, url: payment.returnUrl };
        }
        return {
          kind: "response",
          outcome,
          response: html(
            page(
              action === "pay" ? "Payment successful" : "Payment cancelled",
              `<p>Payment <code>${escape(id)}</code> is now ${
                action === "pay" ? "successful" : "cancelled"
              }. It carried no return URL, so there is nowhere to send you back to.</p>`
            )
          ),
        };
      }

      return { kind: "ignored" };
    },
  };
}

function checkoutPage(payment: Payment): string {
  const amount = formatAmount(payment.amount, payment.currency);
  if (payment.status !== "pending") {
    return page(
      "Console checkout",
      `<p>This payment is already <strong>${escape(payment.status)}</strong>.</p>${
        payment.returnUrl
          ? `<p><a href="${escape(payment.returnUrl)}">Go back</a></p>`
          : ""
      }`
    );
  }
  return page(
    "Console checkout",
    `<p class="warn">Development provider. No money moves.</p>
<dl>
  <dt>Amount</dt><dd>${escape(amount)}</dd>
  <dt>For</dt><dd>${escape(payment.referenceType)} ${escape(payment.referenceId)}</dd>
  <dt>Payment</dt><dd><code>${escape(payment.id)}</code></dd>
</dl>
<form method="post" action="/payment/callback/console/${COMPLETE}">
  <input type="hidden" name="paymentId" value="${escape(payment.id)}">
  <button type="submit" name="action" value="pay">Pay ${escape(amount)}</button>
  <button type="submit" name="action" value="cancel">Cancel</button>
</form>`
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; }
  dt { color: #555; }
  button { font: inherit; padding: 0.5rem 1rem; margin-right: 0.5rem; }
  .warn { color: #8a5a00; }
</style>
</head>
<body>
<h1>${escape(title)}</h1>
${body}
</body>
</html>`;
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status: 200,
  });
}

/** `125000` BDT reads `BDT 1,250.00`: minor units over the currency's own exponent. */
function formatAmount(minor: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat("en", { currency, style: "currency" });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(minor / 10 ** digits);
  } catch {
    return `${String(minor)} ${currency} (minor units)`;
  }
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
