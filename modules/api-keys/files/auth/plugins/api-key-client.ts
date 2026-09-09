import { apiKeyClient } from "@better-auth/api-key/client";

// The client half of `./api-key.ts`, and the reason it exists is the shape of the patch.
//
// The descriptor's `plugin-array` patch appends a zero-argument call to
// `authClientPlugins` in `packages/auth/src/client.ts`, and the patch engine records and
// reverses that exact shape. Wrapping the plugin here keeps that true even though
// `apiKeyClient()` happens to take no options today, and it gives the client half one
// file to grow into if it ever does — the same arrangement `organizationClientPlugin`
// uses in `./organization-client.ts`.
//
// It is what types `auth.apiKey.create`, `list`, `update` and `delete` on the client the
// `/api-keys` screen calls. The server authorizes every one of those endpoints itself, so
// shipping this plugin to a browser grants nothing.
//
// `verifyApiKey` is deliberately absent from the client. It is server-only in the plugin,
// and the only caller in this project is the bearer resolver in `../resolvers/api-key.ts`.
export function apiKeyClientPlugin() {
  return apiKeyClient();
}
