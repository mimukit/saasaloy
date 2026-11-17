# Research: OAuth sign-in and the MCP endpoint for a built product

Created on 2026-11-17, for phase 7 and phase 2 of [plan 0110](../plans/0110-plan-agent-usable-products-2026-11-17.md). Every source below was fetched on 2026-11-17.

Review: pending

Update, 2026-11-17: the grill of plan 0110 moved OAuth sign-in to a later plan. The endpoint pick below still feeds plan 0110 phase 2. The sign-in pick and the section "What this changes in plan 0110" now feed the later OAuth plan.

## The decision

Which packages give a built Saasaloy product an MCP endpoint and an OAuth sign-in that the main assistants accept?

The constraints that decide it:

| Constraint | Value |
| --- | --- |
| Runtime | Cloudflare Workers, Hono 4.13 |
| User store | Better Auth, pinned at 1.7.7, with two instances. Only the client instance may issue a token. |
| Database | Drizzle on D1 and on Postgres, twin schema files, plural snake_case tables |
| Vendor rule | No vendor account for the default build. Cloudflare is a provider, not the architecture. |
| Clients to serve | Claude, ChatGPT, Cursor, Claude Code, Codex |
| Budget and scale | Do not matter for this pick |

## Recommendation

**Provisional.** Use `@better-auth/mcp` with `@better-auth/cimd` and the `jwt` plugin for the sign-in, and `@modelcontextprotocol/server` (the 2.x line) with `@modelcontextprotocol/hono` for the endpoint. It is the only option that keeps one user store, runs on both databases, and needs no vendor account. Turn on Client ID Metadata Documents and Dynamic Client Registration together.

It is provisional because three claims have no source: that these packages run on `workerd`, that the Client ID Metadata fetch can meet its rules on Workers, and that the 2.x SDK serves a client on an older protocol revision. The prototype of plan 0110 phase 2 settles all three.

Choose `@cloudflare/workers-oauth-provider` instead if the prototype shows that the Better Auth packages cannot run on Workers. The cost is a second store in KV and a Cloudflare-only sign-in.

## Options compared

### The sign-in

| Option | One user store | D1 and Postgres | Workers | Registration methods | Vendor account | Fit |
| --- | --- | --- | --- | --- | --- | --- |
| `@better-auth/mcp` 1.7.25 | Yes, a Better Auth plugin | Through the Better Auth adapter, 7 tables | Unverified. Docs say Workers "must inject an equivalent transport" for the metadata fetch. | CIMD (recommended), DCR behind two flags, clients made by an admin | None | Best |
| `@better-auth/oauth-provider` 1.7.25 alone | Yes | Same tables | Unverified | Same engine | None | Same engine with no MCP profile. `mcp()` replaces it, and the docs forbid both together. |
| `@cloudflare/workers-oauth-provider` 1.2.4 | No. Tokens and clients live in KV, apart from Better Auth. | No. KV only. | Yes, built for it | Pre-registered, CIMD, DCR | None, but Cloudflare only | Fallback |

Left off the list:

- A hosted authorization server (WorkOS, Auth0, Stytch): it needs a vendor account, and the default build drops every module with a `needs` value.
- A hand-written OAuth server: the security cost has no return when two maintained options exist.
- The older `oidc-provider` plugin: the current docs do not name it for MCP.

### The endpoint

| Option | Spec revision | Status | Hono adapter | Workers | Fit |
| --- | --- | --- | --- | --- | --- |
| `@modelcontextprotocol/server` 2.4.0 | 2026-07-28 | "the stable release line" | `@modelcontextprotocol/hono` 2.0.2, peers `hono ^4.11.4` and `server ^2.3.0` | Unverified. The README names Node.js, Bun and Deno. | Best |
| `@modelcontextprotocol/sdk` 1.32.2 | Not stated in the README | Bug and security fixes "for at least six months after the v2 release (2026-07-27)" | `@hono/mcp` 0.3.5, peers `@modelcontextprotocol/sdk ^1.29.0` | Unverified | Has an end date. The Better Auth MCP docs name the 2.x package. |

`@hono/mcp` 0.3.5 does not fit the 2.x line: its peer range names the 1.x package.

### What each client accepts

| Client | Fixed key header | CIMD | DCR | Own client id |
| --- | --- | --- | --- | --- |
| Claude (custom connector) | Beta, "available to a limited set of organizations". Meant for one shared credential. | Yes, "the recommended option" | Yes | Yes |
| ChatGPT | No. It cannot "present custom API keys". | Yes, "prioritizes CIMD when it is available" | Yes | Listed, no detail |
| Cursor | Yes, `headers` in `mcp.json` | Not mentioned | Yes | Yes |
| Claude Code | Yes, `--header` | Yes, found automatically | Yes | Yes, `--client-id` |
| Codex | Yes, `bearer_token_env_var` or `http_headers` | Yes, first in `auto` mode | Yes, second in `auto` mode | Yes, `--oauth-client-id` |

So the conflict of the earlier sources is settled. A key works in the three coding agents. ChatGPT needs OAuth, and Claude needs it outside a beta. The product must offer CIMD for Claude, ChatGPT and Codex, and DCR for Cursor.

## Evidence (primary sources)

- The MCP authorization spec, revision 2026-07-28: servers "MUST implement OAuth 2.0 Protected Resource Metadata (RFC9728)". Authorization servers and clients "SHOULD support OAuth Client ID Metadata Documents". DCR is "deprecated and retained for backwards compatibility". → https://modelcontextprotocol.io/specification/latest/basic/authorization
- Client priority order: pre-registered, then CIMD when the server sets `client_id_metadata_document_supported`, then DCR, then a prompt to the user. → https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration.md
- The same revision is stateless. Each request carries its protocol version in `_meta`, and "Servers MUST implement" `server/discover`. → https://modelcontextprotocol.io/specification/2026-07-28/server/discover.md
- `@better-auth/mcp`: "`mcp()` is the OAuth provider. Do not also register a separate `oauthProvider()` plugin in the same app." It needs the `jwt` plugin and names `@modelcontextprotocol/server` as its companion. It serves `/.well-known/oauth-protected-resource`. `requireMcpAuth(auth, handler, { resource })` checks the signature, issuer, audience and expiry. It uses the OAuth provider's seven tables: `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion`, `oauthResource`, `oauthClientResource`. "Better Auth never enables DCR implicitly." → https://www.better-auth.com/docs/plugins/mcp (no version or date on the page)
- `@better-auth/oauth-provider`: OAuth 2.1 with PKCE (S256 only), rotating refresh tokens, revocation (RFC 7009), resource indicators (RFC 8707), and consents that a user can list and delete. "`mcp()` replaces `oauthProvider()`, so do not register both." → https://www.better-auth.com/docs/plugins/oauth-provider (no version or date on the page)
- `@better-auth/cimd`: `fetchClientMetadataResource` is required. The Node transport ships in `@better-auth/cimd/node`. "Bun, Deno, Workers, and other runtimes must provide the equivalent secure transport at their network boundary." "Do not perform a DNS check and then call `globalThis.fetch`." The `mcp-2026-07-28` metadata profile exists. → https://www.better-auth.com/docs/plugins/cimd
- Package facts from the npm registry: `@better-auth/mcp`, `@better-auth/oauth-provider` and `@better-auth/cimd` are at 1.7.25, changed 2026-11-15, and peer on `better-auth ^1.7.25`. `@modelcontextprotocol/server` is at 2.4.0, `@modelcontextprotocol/hono` at 2.0.2, `@modelcontextprotocol/sdk` at 1.32.2, `@hono/mcp` at 0.3.5.
- The MCP TypeScript SDK: `main` is "the stable release line, implementing the 2026-07-28 MCP spec". The 1.x line "continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)". It "runs on Node.js, Bun, and Deno". → https://github.com/modelcontextprotocol/typescript-sdk
- Claude custom connectors: the three sign-in choices, the three OAuth client choices, the request header beta, and the callback `https://claude.ai/api/mcp/auth_callback`. → https://claude.com/docs/connectors/custom/remote-mcp
- ChatGPT: OAuth 2.1 with PKCE, CIMD first, DCR second, no API key, and the redirect `https://chatgpt.com/connector_platform_oauth_redirect`. The server metadata must list S256 in `code_challenge_methods_supported`. → https://developers.openai.com/apps-sdk/build/auth (no date on the page)
- Cursor: `headers` for a key, OAuth with DCR or a static client, callbacks `https://www.cursor.com/agents/mcp/oauth/callback` and `http://localhost:8787/callback`. → https://cursor.com/docs/context/mcp
- Claude Code: `--header`, CIMD, DCR and `--client-id`. It reads `/.well-known/oauth-protected-resource` first. → https://code.claude.com/docs/en/mcp (the first 100,000 of 156,671 characters)
- Codex: `bearer_token_env_var`, `http_headers`, and `codex mcp login` with CIMD then DCR. → https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- Server Cards: SEP-2127 is Final on the Extensions Track. A card is optional. The reserved location is `<streamable-http-url>/server-card`, and a domain can list its cards in `/.well-known/ai-catalog.json`. The wire format lives in an experimental repository. A card holds no tool list. → https://modelcontextprotocol.io/seps/2127-mcp-server-cards.md
- `@cloudflare/workers-oauth-provider` 1.2.4: "needs a KV namespace bound as `OAUTH_KV`, and the `global_fetch_strictly_public` compatibility flag if it accepts Client ID Metadata Documents". It implements the 2026-07-28 authorization spec. → https://github.com/cloudflare/workers-oauth-provider

## What this changes in plan 0110

- **Phase 7 has two requirements the plan does not name.** The sign-in must offer CIMD and DCR, and the api must serve `/.well-known/oauth-protected-resource` and the authorization server metadata at the root of its origin.
- **Better Auth moves from 1.7.7 to 1.7.25 or later** in every module that pins it. The three new packages peer on that version.
- **Seven new tables**, not three. Each needs a plural snake_case name and a twin schema file.
- **Phase 2 picks the 2.x SDK line** and drops `@hono/mcp` from the candidates.
- **The "Agents" page shows two paths.** A key for Cursor, Claude Code and Codex. A plain address for Claude and ChatGPT, which then start the sign-in.
- **A Server Card is a small optional addition** to phase 5. No client in these sources reads one yet.

## Open questions

Each one needs a measurement. The prototype of plan 0110 phase 2 can take them.

- Do `@better-auth/mcp`, `@better-auth/cimd` and `@modelcontextprotocol/server` run on `workerd`? A pass is a Worker that completes one sign-in and one `tools/list` call.
- Can the metadata fetch for CIMD meet its rules on Workers? A Worker cannot resolve a hostname itself. Cloudflare's own library uses the `global_fetch_strictly_public` flag for the same job, so that flag with redirects refused is the candidate. A pass is a refused fetch to a private address and to a redirect.
- Does the sign-in work with the Drizzle adapter on D1, with `usePlural` and seven renamed tables? A pass is the same journey green on both drivers.
- Does `mcp()` work on one of two Better Auth instances, with the admin instance issuing nothing? What is the issuer when the base path is not the default?
- Does the 2.x SDK answer a client that still speaks an older revision with the `initialize` handshake? A pass is a session with one client on each revision.
- DCR with no authentication lets anyone register a client. The consent screen still guards each user. Is that risk acceptable as a default, or is DCR a config flag that ships off?
- DPoP replay records go to the database by default. What does that cost on D1 for each request?
