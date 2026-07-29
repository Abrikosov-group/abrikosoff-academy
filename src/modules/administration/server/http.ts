import { AdministrationError } from "../domain/errors";

export function administrationErrorResponse(error: unknown) {
  if (error instanceof AdministrationError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.publicMessage,
        },
      },
      {
        status: error.httpStatus,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  throw error;
}
