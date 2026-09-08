// Repo-only stand-in for the `aws4fetch` package, and NOT in the descriptor's
// `files[]`. A project installs the real package: the descriptor patches
// `aws4fetch@1.0.20` into packages/storage/package.json.
//
// This repo's root node_modules holds dev tooling and nothing else — the same reason
// modules/auth/files/src/server.test.ts gives — so `files/cloudflare.test.ts` maps the
// `aws4fetch` specifier onto this file with a `node:module` resolve hook. What the test
// proves is the provider's half of the contract: that it signs the right URL, with the
// right method, expiry and query, and only when all four R2 API values are set.
// Whether SigV4 itself is correct is aws4fetch's business, and check P3-6 (a real
// bucket) is where that gets confirmed.

export interface StubSignCall {
  method: string;
  signQuery: boolean | undefined;
  url: string;
}

/** Every `sign` this stub has been asked for, in order. Tests read and clear it. */
export const signCalls: StubSignCall[] = [];

export class AwsClient {
  readonly accessKeyId: string;
  readonly region: string | undefined;
  readonly service: string | undefined;

  constructor(init: {
    accessKeyId: string;
    region?: string;
    secretAccessKey: string;
    service?: string;
  }) {
    this.accessKeyId = init.accessKeyId;
    this.region = init.region;
    this.service = init.service;
  }

  sign(
    request: Request,
    options?: { aws?: { signQuery?: boolean } }
  ): Promise<Request> {
    signCalls.push({
      method: request.method,
      signQuery: options?.aws?.signQuery,
      url: request.url,
    });

    const url = new URL(request.url);
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set(
      "X-Amz-Credential",
      `${this.accessKeyId}/20260908/${this.region}/${this.service}/aws4_request`
    );
    url.searchParams.set("X-Amz-Signature", "stub-signature");
    return Promise.resolve(new Request(url, { method: request.method }));
  }
}
