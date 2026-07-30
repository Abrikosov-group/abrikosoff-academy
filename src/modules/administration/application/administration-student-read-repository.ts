import type {
  AdminStudentCursor,
  AdminStudentDetail,
  AdminStudentListFilters,
  AdminStudentListPage,
} from "../domain/student-read-model";

export interface AdministrationStudentReadRepository {
  listStudents(input: {
    filters: AdminStudentListFilters;
    cursor?: AdminStudentCursor;
    at: Date;
    displayTimeZone: string;
    scope: {
      paymentContext: boolean;
    };
  }): Promise<AdminStudentListPage>;

  findStudentDetail(input: {
    userId: string;
    at: Date;
    scope: {
      paymentContext: boolean;
      billingContext: boolean;
    };
  }): Promise<AdminStudentDetail | null>;
}
