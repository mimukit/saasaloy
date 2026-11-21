import { ownerMayUseKeys } from "./api-key-owner";
import type { KeyOwner } from "./api-key-owner";
import { field } from "./plugins/api-key-options";

export const CREATOR_ID = "saasaloyCreatorId";

export function creatorIdOf(metadata: unknown): string | undefined {
  const creatorId = field(metadata, CREATOR_ID);
  return typeof creatorId === "string" ? creatorId : undefined;
}

export async function creatorMayUseKey(
  metadata: unknown,
  findCreator: (id: string) => Promise<KeyOwner | null>
): Promise<boolean> {
  const creatorId = creatorIdOf(metadata);
  return (
    creatorId === undefined || ownerMayUseKeys(await findCreator(creatorId))
  );
}
