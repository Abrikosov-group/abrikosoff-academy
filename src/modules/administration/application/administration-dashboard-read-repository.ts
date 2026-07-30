import type {
  AdminDashboardMetrics,
  AdminDashboardMetricScope,
} from "../domain/dashboard-read-model";

export interface AdministrationDashboardReadRepository {
  getDashboardMetrics(input: {
    at: Date;
    displayTimeZone: string;
    scope: AdminDashboardMetricScope;
  }): Promise<AdminDashboardMetrics>;
}
