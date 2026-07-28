import { BillingError } from "../domain/errors";
import { logUnexpectedServerError } from "@/lib/safe-server-log";

export function billingErrorResponse(error: unknown) {
  if (error instanceof BillingError) {
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

  logUnexpectedServerError("billing.request_failed", error);

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Не удалось обработать платёж. Повторите попытку.",
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
