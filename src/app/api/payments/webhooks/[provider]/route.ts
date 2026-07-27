import { paymentProviderIds } from "@/modules/billing/domain/types";
import type { PaymentProviderId } from "@/modules/billing/domain/types";
import { BillingError } from "@/modules/billing/domain/errors";
import { getPaymentRuntime } from "@/modules/billing/server/get-payment-service";
import { billingErrorResponse } from "@/modules/billing/server/http";
import {
  readTextBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const maxWebhookBodyBytes = 256 * 1024;

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

    let rawBody: string;

    try {
      rawBody = await readTextBodyWithLimit(
        request,
        maxWebhookBodyBytes,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw new BillingError(
          "WEBHOOK_REJECTED",
          "Размер платёжного уведомления превышает допустимый.",
          413,
        );
      }

      throw error;
    }

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
