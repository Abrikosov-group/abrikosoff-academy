import { paymentProviderIds } from "@/modules/billing/domain/types";
import type { PaymentProviderId } from "@/modules/billing/domain/types";
import { BillingError } from "@/modules/billing/domain/errors";
import { getPaymentRuntime } from "@/modules/billing/server/get-payment-service";
import { billingErrorResponse } from "@/modules/billing/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WebhookRouteContext = {
  params: Promise<{ provider: string }>;
};

function isPaymentProviderId(value: string): value is PaymentProviderId {
  return paymentProviderIds.some((provider) => provider === value);
}

export async function POST(
  request: Request,
  context: WebhookRouteContext,
) {
  try {
    const { provider } = await context.params;

    if (!isPaymentProviderId(provider)) {
      throw new BillingError(
        "UNSUPPORTED_PROVIDER",
        "Платёжный провайдер не поддерживается.",
        404,
      );
    }

    const rawBody = await request.text();
    const { service } = getPaymentRuntime();
    const result = await service.handleWebhook(
      provider,
      rawBody,
      request.headers,
    );

    return Response.json(
      {
        accepted: true,
        outcome: result.outcome,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return billingErrorResponse(error);
  }
}
