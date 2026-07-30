export type AdminDashboardStudentMetrics = {
  activeStudents: number;
  newStudentsLast7Days: number;
  newStudentsLast30Days: number;
};

export type AdminDashboardAccessMetrics = {
  activePaidAccessStudents: number;
};

export type AdminDashboardBillingMetrics = {
  stalePendingPayments: number;
  failedWebhookEvents: number;
};

export type AdminDashboardMetrics = {
  generatedAt: string;
  displayTimeZone: string;
  periods: {
    last7DaysFrom: string;
    last30DaysFrom: string;
    through: string;
  };
  students?: AdminDashboardStudentMetrics;
  access?: AdminDashboardAccessMetrics;
  billing?: AdminDashboardBillingMetrics;
};

export type AdminDashboardMetricScope = {
  students: boolean;
  paidAccess: boolean;
  billing: boolean;
};
