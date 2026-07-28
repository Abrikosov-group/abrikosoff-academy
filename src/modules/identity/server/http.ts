import { IdentityError } from "../domain/errors";
import { logUnexpectedServerError } from "@/lib/safe-server-log";

export function identityErrorResponse(error: unknown) {
  if (error instanceof IdentityError) {
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

  logUnexpectedServerError("identity.request_failed", error);

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Не удалось выполнить вход. Повторите попытку.",
      },
    },
    {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
