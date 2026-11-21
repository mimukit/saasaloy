/** The owner fields the key gate reads, as the `admin()` plugin stores them. */
export interface KeyOwner {
  banned?: boolean | null;
  banExpires?: Date | string | number | null;
}

/**
 * May this owner's keys still authenticate?
 *
 * A ban revokes the owner's sessions and refuses their sign-in, but a key is no session,
 * and `verifyApiKey` never reads the user row. So the gate asks here. A missing owner
 * refuses too, so deleting an account cannot restore access.
 *
 * A ban with a `banExpires` in the past no longer counts, the rule the `admin()` plugin
 * applies at sign-in.
 */
export function ownerMayUseKeys(
  owner: KeyOwner | null | undefined,
  now: number = Date.now()
): boolean {
  if (!owner) {
    return false;
  }
  if (!owner.banned) {
    return true;
  }
  if (owner.banExpires === null || owner.banExpires === undefined) {
    return false;
  }
  return new Date(owner.banExpires).getTime() < now;
}
