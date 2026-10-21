import { bangladeshMobile } from "@repo/validators/phone";

import { PaymentError } from "../provider";
import type {
  CallbackResult,
  CreateResult,
  Payment,
  PaymentEnv,
  PaymentInstructions,
  PaymentMethod,
  PaymentProvider,
  ProviderCreateInput,
  RefundResult,
  SubmitField,
  SubmitInput,
  SubmitResult,
} from "../provider";

// Manual payments: the shopper sends money by bKash, Nagad, Rocket or bank transfer outside
// the site, then types back the transaction id, the account they paid from and the amount.
// Staff check their own statement and confirm or reject on the admin Payments page.
//
// NOTHING HERE IS VERIFIED. No wallet or bank in this file has an API this provider calls:
// no IPN, no webhook, no query endpoint, no way to ask whether a transaction id is real. The
// file calls no network. It shows the account to pay, checks the shape of what the shopper
// typed, and normalizes the transaction id so the core's partial unique index can refuse a
// second live claim on it. A person reading a statement is the whole verification.
//
// The accounts are options in the registration call in `packages/payment/src/index.ts`, not
// env values: a receiving account number is public by design, it is printed to every
// shopper, and checking it in keeps it reviewed (ADR 0039). A method with no account set is
// reported as unavailable, so `create` with it answers `method_unavailable`.
//
// Ported from the provider half of PR #170 (`billing-bkash-personal`): the three submission
// fields, the bKash transaction id rule and the trim-and-upper-case normalization. The
// sender number goes through `bangladeshMobile` from `@repo/validators/phone` instead of
// #170's inline regex.

/** The value PAYMENT_PROVIDER lists to select this provider. */
const NAME = "manual";

/** A wallet a shopper sends money to. */
export interface ManualWalletAccount {
  /** The wallet number, in any form `bangladeshMobile` accepts, e.g. `01712345678`. */
  account: string;
  /** What kind of wallet it is. It decides the menu the shopper uses. */
  kind: "personal" | "merchant" | "agent";
  /** The account holder's name, shown so a shopper can match the name the app displays. */
  name?: string;
  /** One short line of guidance. Replaces the default for `kind`. */
  note?: string;
}

/** A bank account a shopper transfers money to. */
export interface ManualBankAccount {
  accountName: string;
  accountNumber: string;
  bankName: string;
  branch: string;
  /** The nine-digit routing number, for a transfer from another bank. */
  routingNumber?: string;
  /** ISO 4217. Defaults to `BDT`. */
  currency?: string;
  /** One short line of guidance, added after the branch line. */
  note?: string;
}

/** The registration options: one entry per method this shop takes. */
export interface ManualOptions {
  methods?: {
    bkash?: ManualWalletAccount;
    nagad?: ManualWalletAccount;
    rocket?: ManualWalletAccount;
    bank?: ManualBankAccount;
  };
}

type WalletId = "bkash" | "nagad" | "rocket";
type MethodId = WalletId | "bank";

const WALLETS: Record<
  WalletId,
  { brand: string; transaction: RegExp; hint: string; example: string }
> = {
  // bKash prints a ten-character id in its SMS, e.g. 8N7A5D2K1P (PR #170).
  bkash: {
    brand: "bKash",
    example: "8N7A5D2K1P",
    hint: "exactly 10 letters and digits",
    transaction: /^[\dA-Z]{10}$/,
  },
  // Nagad and Rocket ids vary in length across app versions and channels, so the rule is
  // the shape only: letters and digits, 6 to 20 of them. Staff read the real id on the
  // statement either way.
  nagad: {
    brand: "Nagad",
    example: "71A2B3C4",
    hint: "6 to 20 letters and digits",
    transaction: /^[\dA-Z]{6,20}$/,
  },
  rocket: {
    brand: "Rocket",
    example: "1234567890",
    hint: "6 to 20 letters and digits",
    transaction: /^[\dA-Z]{6,20}$/,
  },
};

/** A bank reference: letters, digits and `-`, `/`, `.`, 4 to 40 of them. */
const BANK_REFERENCE = /^[\dA-Z][\dA-Z./-]{3,39}$/;

/** A bank account number once spaces and hyphens are gone: 6 to 20 digits. */
const BANK_ACCOUNT = /^\d{6,20}$/;

/** Mobile wallets hold taka and nothing else. */
const WALLET_CURRENCY = "BDT";

const KIND_NOTE: Record<ManualWalletAccount["kind"], string> = {
  agent: "This is an agent number. Pay it at the agent's counter.",
  merchant: "Use Make Payment, not Send Money.",
  personal: "Use Send Money, not Cash Out.",
};

/**
 * The manual payment provider. Register it in `packages/payment/src/index.ts`:
 *
 * ```ts
 * manual({ methods: { bkash: { account: "01712345678", kind: "personal" } } })
 * ```
 *
 * Throws at construction when a configured account is malformed, so a wrong number fails
 * the deploy instead of reaching a shopper.
 */
export function manual(options: ManualOptions = {}): PaymentProvider {
  const accounts = checkOptions(options);

  return {
    name: NAME,

    methods(_env: PaymentEnv): PaymentMethod[] {
      return [
        {
          available: accounts.bkash !== undefined,
          id: "bkash",
          label: "bKash",
        },
        {
          available: accounts.nagad !== undefined,
          id: "nagad",
          label: "Nagad",
        },
        {
          available: accounts.rocket !== undefined,
          id: "rocket",
          label: "Rocket",
        },
        {
          available: accounts.bank !== undefined,
          id: "bank",
          label: "Bank transfer",
        },
        // Known so a page can say so; never taken. A card needs a gateway provider.
        { available: false, id: "card", label: "Card" },
      ];
    },

    create(
      _env: PaymentEnv,
      input: ProviderCreateInput
    ): Promise<CreateResult> {
      const { payment } = input;
      const method = methodOf(payment);
      const amount = formatAmount(payment.amount, payment.currency);

      if (method === "bank") {
        const { bank } = accounts;
        if (!bank) {
          throw unconfigured(method);
        }
        if (payment.currency !== bank.currency) {
          throw wrongCurrency(method, payment.currency, bank.currency);
        }
        return Promise.resolve({
          instructions: {
            account: {
              kind: "bank",
              label: bank.bankName,
              name: bank.accountName,
              number: bank.accountNumber,
            },
            fields: fields(method),
            note: [
              `Transfer exactly ${amount}.`,
              `Branch: ${bank.branch}.`,
              bank.routingNumber
                ? `Routing number: ${bank.routingNumber}.`
                : "",
              bank.note ?? "",
            ]
              .filter(Boolean)
              .join(" "),
          },
          kind: "instructions",
        });
      }

      const wallet = accounts[method];
      if (!wallet) {
        throw unconfigured(method);
      }
      if (payment.currency !== WALLET_CURRENCY) {
        throw wrongCurrency(method, payment.currency, WALLET_CURRENCY);
      }
      const instructions: PaymentInstructions = {
        account: {
          kind: wallet.kind,
          label: `${WALLETS[method].brand} ${wallet.kind}`,
          number: wallet.account,
          ...(wallet.name ? { name: wallet.name } : {}),
        },
        fields: fields(method),
        note: `Send exactly ${amount}. ${wallet.note ?? KIND_NOTE[wallet.kind]}`,
      };
      return Promise.resolve({ instructions, kind: "instructions" });
    },

    submit(
      _env: PaymentEnv,
      payment: Payment,
      input: SubmitInput
    ): Promise<SubmitResult> {
      const method = methodOf(payment);
      const transaction = normalizeTransactionId(method, input.transactionId);
      return Promise.resolve({
        claimedAmount: claimedAmount(input.amount),
        senderAccount: normalizeSender(method, input.senderAccount),
        transactionId: transaction.typed,
        transactionIdNormalized: transaction.normalized,
      });
    },

    // Staff sent the money back by hand. There is nothing to call; the core writes the
    // `payment_refunds` row, and a manual refund has no vendor id.
    refund(): Promise<RefundResult> {
      return Promise.resolve({ providerRefundId: null });
    },

    // No gateway calls back. Anything that reaches `/payment/callback/manual/*` is ignored.
    handleCallback(): Promise<CallbackResult> {
      return Promise.resolve({ kind: "ignored" });
    },
  };
}

/**
 * Trim and upper-case a transaction id, then check its shape for the method. The typed
 * value keeps what the shopper wrote (trimmed), so staff comparing it with a statement see
 * the same characters. The normalized value is what the partial unique index sits on, so
 * `8n7a5d2k1p` and `8N7A5D2K1P` are one claim, not two (PR #170).
 */
export function normalizeTransactionId(
  method: string,
  value: unknown
): { typed: string; normalized: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid("transactionId", '"transactionId" is required.');
  }
  const typed = value.trim();
  const normalized = typed.toUpperCase();

  if (method === "bank") {
    if (!BANK_REFERENCE.test(normalized)) {
      throw invalid(
        "transactionId",
        `"${typed}" is not a bank transfer reference. Use 4 to 40 letters, digits, "-", "/" or ".", as your bank shows it.`
      );
    }
    return { normalized, typed };
  }

  if (!isWallet(method)) {
    throw unknownMethod(method);
  }
  const wallet = WALLETS[method];
  if (!wallet.transaction.test(normalized)) {
    throw invalid(
      "transactionId",
      `"${typed}" is not a ${wallet.brand} transaction ID. It is ${wallet.hint}, printed in the ${wallet.brand} SMS, for example ${wallet.example}.`
    );
  }
  return { normalized, typed };
}

/**
 * The account the shopper paid from. A wallet sender is a Bangladeshi mobile number,
 * normalized to `+8801XXXXXXXXX` by `bangladeshMobile`. A bank sender is an account number,
 * kept as its digits.
 */
export function normalizeSender(method: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid("senderAccount", '"senderAccount" is required.');
  }
  if (method === "bank") {
    const digits = value.trim().replaceAll(/[\s-]/g, "");
    if (!BANK_ACCOUNT.test(digits)) {
      throw invalid(
        "senderAccount",
        `"${value.trim()}" is not a bank account number. Write the 6 to 20 digits of the account you transferred from.`
      );
    }
    return digits;
  }
  if (!isWallet(method)) {
    throw unknownMethod(method);
  }
  const parsed = bangladeshMobile.safeParse(value.trim());
  if (!parsed.success) {
    throw invalid(
      "senderAccount",
      `"${value.trim()}" is not a Bangladeshi mobile number. Write it as 01712345678 or +8801712345678.`
    );
  }
  return parsed.data;
}

/** What the shopper says they sent, in minor units. Evidence for staff, never a check. */
function claimedAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid(
      "amount",
      '"amount" is required: what you sent, as a positive whole number of minor units, e.g. 125000 for 1,250.00 taka.'
    );
  }
  return value;
}

/** The three inputs the shopper fills, labelled for the method. */
function fields(method: MethodId): SubmitField[] {
  if (method === "bank") {
    return [
      {
        id: "transactionId",
        label: "Transfer reference",
        placeholder: "FT24123ABC45",
      },
      {
        id: "senderAccount",
        label: "Account you paid from",
        placeholder: "1234567890123",
      },
      { id: "amount", label: "Amount you sent" },
    ];
  }
  const { brand, example } = WALLETS[method];
  return [
    {
      id: "transactionId",
      label: `${brand} transaction ID`,
      placeholder: example,
    },
    {
      id: "senderAccount",
      label: `Your ${brand} number`,
      placeholder: "01712345678",
    },
    { id: "amount", label: "Amount you sent" },
  ];
}

interface CheckedAccounts {
  bkash?: ManualWalletAccount;
  nagad?: ManualWalletAccount;
  rocket?: ManualWalletAccount;
  bank?: Required<Pick<ManualBankAccount, "currency">> & ManualBankAccount;
}

/** Check the registration options once, at construction. A bad account throws here. */
function checkOptions(options: ManualOptions): CheckedAccounts {
  const methods = options.methods ?? {};
  const checked: CheckedAccounts = {};

  for (const id of ["bkash", "nagad", "rocket"] as const) {
    const wallet = methods[id];
    if (!wallet) {
      continue;
    }
    const parsed = bangladeshMobile.safeParse(
      typeof wallet.account === "string" ? wallet.account : ""
    );
    if (!parsed.success) {
      throw new Error(
        `manual(): methods.${id}.account "${String(wallet.account)}" is not a Bangladeshi mobile number. Write it as 01712345678.`
      );
    }
    if (!Object.hasOwn(KIND_NOTE, wallet.kind)) {
      throw new Error(
        `manual(): methods.${id}.kind has to be "personal", "merchant" or "agent".`
      );
    }
    // Shown the way a shopper types it into the app: 01712345678.
    checked[id] = { ...wallet, account: `0${parsed.data.slice(4)}` };
  }

  const { bank } = methods;
  if (bank) {
    for (const key of [
      "accountName",
      "accountNumber",
      "bankName",
      "branch",
    ] as const) {
      if (typeof bank[key] !== "string" || bank[key].trim().length === 0) {
        throw new Error(`manual(): methods.bank.${key} is required.`);
      }
    }
    const currency = (bank.currency ?? WALLET_CURRENCY).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(
        `manual(): methods.bank.currency "${currency}" is not an ISO 4217 code.`
      );
    }
    checked.bank = { ...bank, currency };
  }

  return checked;
}

function methodOf(payment: Payment): MethodId {
  const { method } = payment;
  if (method === "bank" || isWallet(method)) {
    return method;
  }
  throw unknownMethod(method);
}

/** Own keys only, so `toString` or `constructor` is never taken for a wallet. */
function isWallet(method: string): method is WalletId {
  return Object.hasOwn(WALLETS, method);
}

function invalid(field: string, message: string): PaymentError {
  return new PaymentError("invalid_request", message, { providerCode: field });
}

function unknownMethod(method: string): PaymentError {
  return new PaymentError(
    "method_unavailable",
    `The manual provider takes bkash, nagad, rocket and bank, not "${method}".`,
    { providerCode: "unknown_method" }
  );
}

function unconfigured(method: MethodId): PaymentError {
  return new PaymentError(
    "method_unavailable",
    `The manual provider has no ${method} account. Add methods.${method} to manual({ ... }) in packages/payment/src/index.ts.`,
    { providerCode: "unconfigured" }
  );
}

function wrongCurrency(
  method: MethodId,
  asked: string,
  held: string
): PaymentError {
  return new PaymentError(
    "invalid_request",
    `The ${method} account takes ${held}, and this payment is in ${asked}. Price it in ${held}, or take it through another method.`,
    { providerCode: "unsupported_currency" }
  );
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
