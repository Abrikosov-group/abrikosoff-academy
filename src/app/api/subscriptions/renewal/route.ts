import { getDatabasePool } from "@/lib/database";
import { BillingError } from "@/modules/billing/domain/errors";
import { setSubscriptionRenewal } from "@/modules/billing/infrastructure/postgres-payment-repository";
import { billingErrorResponse } from "@/modules/billing/server/http";
import { requireBillingRequestOrigin } from "@/modules/billing/server/request-origin";
import { IdentityError } from "@/modules/identity/domain/errors";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { requireCurrentUser } from "@/modules/identity/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireBillingRequestOrigin(request);
    const user = await requireCurrentUser();
    const body = (await request.json()) as { enabled?: unknown };

    if (typeof body.enabled !== "boolean") {
      throw new BillingError(
        "INVALID_REQUEST",
        "Выберите состояние автоматического продления.",
        400,
      );
    }

    const subscription = await setSubscriptionRenewal(
      getDatabasePool(),
      user.id,
      body.enabled,
    );

    return Response.json({ subscription }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof IdentityError) {
      return identityErrorResponse(error);
    }

    return billingErrorResponse(error);
  }
}
