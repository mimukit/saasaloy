import { StatusPill } from "@repo/ui/components/shell/status-pill";

import { STATUS_LABEL, STATUS_TONE } from "@admin/lib/cms-format";
import type { CmsStatus } from "@admin/lib/cms-format";

/** An entry's status. Draft is the open blue, published the settled green, archived neutral. */
export function CmsStatusPill({ status }: { status: CmsStatus }) {
  return <StatusPill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
}
