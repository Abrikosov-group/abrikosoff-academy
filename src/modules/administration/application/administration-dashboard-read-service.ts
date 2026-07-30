import type { AdministrationDashboardReadRepository } from "./administration-dashboard-read-repository";
import { AdministrationError } from "../domain/errors";
import type { AdminPermission } from "../domain/types";

export class AdministrationDashboardReadService {
  constructor(
    private readonly repository: AdministrationDashboardReadRepository,
  ) {}

  getDashboardMetrics(input: {
    displayTimeZone: string;
    permissions: ReadonlySet<AdminPermission>;
    at?: Date;
  }) {
    if (!input.permissions.has("dashboard.read")) {
      throw new AdministrationError(
        "ADMIN_PERMISSION_DENIED",
        "Недостаточно прав для просмотра дашборда.",
        403,
      );
    }

    return this.repository.getDashboardMetrics({
      at: input.at ?? new Date(),
      displayTimeZone: input.displayTimeZone,
      scope: {
        students: input.permissions.has("users.read"),
        paidAccess: input.permissions.has("access.read"),
        billing: input.permissions.has("billing.read"),
      },
    });
  }
}
