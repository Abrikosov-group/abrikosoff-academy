import type { AdminPermission } from "../domain/types";
import { AdministrationError } from "../domain/errors";
import type {
  AdminAccessCursor,
  AdminAccessSource,
  AdminAccessState,
} from "../domain/access-read-model";
import type { AdministrationAccessReadRepository } from "./administration-access-read-repository";

export class AdministrationAccessReadService {
  constructor(
    private readonly repository: AdministrationAccessReadRepository,
  ) {}

  listAccess(input: {
    query: string;
    source?: AdminAccessSource;
    state?: AdminAccessState;
    cursor?: AdminAccessCursor;
    permissions: ReadonlySet<AdminPermission>;
    at?: Date;
  }) {
    if (!input.permissions.has("access.read")) {
      throw new AdministrationError(
        "ADMIN_PERMISSION_DENIED",
        "Недостаточно прав для просмотра доступов.",
        403,
      );
    }
    return this.repository.listAccess({
      query: input.query.trim(),
      source: input.source,
      state: input.state,
      cursor: input.cursor,
      limit: 25,
      at: input.at ?? new Date(),
      canRevokeManualAccess: input.permissions.has(
        "access.manual.revoke",
      ),
      paymentContextVisible: input.permissions.has(
        "users.read_payment_context",
      ),
    });
  }
}
