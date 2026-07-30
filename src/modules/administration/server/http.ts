import { NextResponse } from "next/server";
import { AdministrationError } from "../domain/errors";

export function administrationErrorResponse(
  error: unknown,
  requestId?: string,
) {
  if (error instanceof AdministrationError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.publicMessage,
        },
        ...(requestId ? { requestId } : {}),
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
