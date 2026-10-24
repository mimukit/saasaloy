// The key vocabulary: every resource-and-action pair this project lets an API key carry.
//
// This file is the project's to edit. `add api-keys-user` ships it empty, and an empty
// vocabulary refuses every scoped create: `apiKeyScopeGuard()` in `./plugins/api-key.ts`
// answers 403 `permission required: <resource>:<action>` for the first pair it does not
// find here, before the row is written. A key created with no scope still issues, and it
// holds nothing, so `requireScope` refuses it every demand.
//
// Declare the pairs your routes demand. A flashcard app, for example:
//
//   export const API_KEY_SCOPES: Readonly<Record<string, readonly string[]>> = {
//     cards: ["read", "write"],
//     reviews: ["read", "write"],
//   };
//
// Then a route asks `requireScope(caller, { cards: ["read"] })`, and a key issued with
// `metadata: { scope: { cards: ["read"] } }` passes it.
//
// Removing a pair later stops new keys from carrying it. It does not shrink a key that
// already holds it: a key's scope is a snapshot taken at issue time (ADR 0036). Revoke
// and reissue those keys.

export const API_KEY_SCOPES: Readonly<Record<string, readonly string[]>> = {};
