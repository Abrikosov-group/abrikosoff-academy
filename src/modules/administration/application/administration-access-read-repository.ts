import type {
  AdminAccessCursor,
  AdminAccessListPage,
  AdminAccessSource,
  AdminAccessState,
} from "../domain/access-read-model";

export interface AdministrationAccessReadRepository {
  listAccess(input: {
    query: string;
    source?: AdminAccessSource;
    state?: AdminAccessState;
    cursor?: AdminAccessCursor;
    limit: number;
    at: Date;
    canRevokeManualAccess: boolean;
    paymentContextVisible: boolean;
  }): Promise<AdminAccessListPage>;
}
