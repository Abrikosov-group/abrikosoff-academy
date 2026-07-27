import { BillingError } from "../domain/errors";

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

  console.error("Unexpected billing error", error);

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
