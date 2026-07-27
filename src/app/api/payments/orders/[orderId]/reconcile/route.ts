import { BillingError } from "@/modules/billing/domain/errors";
import { getPaymentRuntime } from "@/modules/billing/server/get-payment-service";
import { billingErrorResponse } from "@/modules/billing/server/http";
import { IdentityError } from "@/modules/identity/domain/errors";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { requireCurrentUser } from "@/modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReconcileRouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(
  _request: Request,
  context: ReconcileRouteContext,
) {
  try {
    const { orderId } = await context.params;

    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      throw new BillingError(
        "INVALID_REQUEST",
        "Некорректный идентификатор платежа.",
        400,
      );
    }

    const user = await requireCurrentUser();
    const { service } = getPaymentRuntime();
    const checkout = await service.reconcileCheckout(orderId, user.id);

    return Response.json(
      {
        orderId: checkout.orderId,
        status: checkout.status,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof IdentityError) {
      return identityErrorResponse(error);
    }

    return billingErrorResponse(error);
  }
}
