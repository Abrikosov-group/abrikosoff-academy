import type { AdministrationStudentReadRepository } from "./administration-student-read-repository";
import { AdministrationError } from "../domain/errors";
import type {
  AdminPermission,
} from "../domain/types";
import type {
  AdminStudentCursor,
  AdminStudentListFilters,
} from "../domain/student-read-model";

export class AdministrationStudentReadService {
  constructor(
    private readonly repository: AdministrationStudentReadRepository,
  ) {}

  listStudents(input: {
    filters: AdminStudentListFilters;
    cursor?: AdminStudentCursor;
    displayTimeZone: string;
    permissions: ReadonlySet<AdminPermission>;
    at?: Date;
  }) {
    if (
      !input.permissions.has("users.read") ||
      !input.permissions.has("access.read")
    ) {
      throw new AdministrationError(
        "ADMIN_PERMISSION_DENIED",
        "Недостаточно прав для просмотра списка учеников.",
        403,
      );
    }

    return this.repository.listStudents({
      filters: input.filters,
      cursor: input.cursor,
      displayTimeZone: input.displayTimeZone,
      at: input.at ?? new Date(),
      scope: {
        paymentContext: input.permissions.has(
          "users.read_payment_context",
        ),
      },
    });
  }

  async findStudentDetail(input: {
    userId: string;
    permissions: ReadonlySet<AdminPermission>;
    at?: Date;
  }) {
    if (
      !input.permissions.has("users.read") ||
      !input.permissions.has("access.read")
    ) {
      throw new AdministrationError(
        "ADMIN_PERMISSION_DENIED",
        "Недостаточно прав для просмотра карточки ученика.",
        403,
      );
    }

    return this.repository.findStudentDetail({
      userId: input.userId,
      at: input.at ?? new Date(),
      scope: {
        paymentContext: input.permissions.has(
          "users.read_payment_context",
        ),
        billingContext:
          input.permissions.has("billing.read_related") ||
          input.permissions.has("billing.read"),
        canRevokeManualAccess: input.permissions.has(
          "access.manual.revoke",
        ),
      },
    });
  }
}
