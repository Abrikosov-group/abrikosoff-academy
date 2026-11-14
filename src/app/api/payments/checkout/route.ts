import { isSubscriptionPlanId } from "@/modules/billing/domain/catalog";
import { BillingError } from "@/modules/billing/domain/errors";
import {
  academyLegalEntityId,
  offerDocumentVersion,
  resolvePublicBaseUrl,
} from "@/modules/billing/server/billing-config";
import { getPaymentRuntime } from "@/modules/billing/server/get-payment-service";
import { billingErrorResponse } from "@/modules/billing/server/http";
import { IdentityError } from "@/modules/identity/domain/errors";
import { identityErrorResponse } from "@/modules/identity/server/http";
import { requireCurrentUser } from "@/modules/identity/server/session";
import {
  readJsonBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const maxCheckoutBodyBytes = 8 * 1024;

type CheckoutRequestBody = {
  plan?: unknown;
  receiptEmail?: unknown;
  offerAccepted?: unknown;
};

function validateIdempotencyKey(value: string | null) {
  if (
    !value ||
    value.length < 8 ||
    value.length > 64 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new BillingError(
      "INVALID_REQUEST",
      "Не удалось подтвердить уникальность операции. Обновите страницу.",
      400,
    );
  }

  return value;
}

function validateReceiptEmail(value: unknown) {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new BillingError(
      "INVALID_REQUEST",
      "Укажите корректный адрес электронной почты для чека.",
      400,
    );
  }

  return value;
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const idempotencyKey = validateIdempotencyKey(
      request.headers.get("Idempotency-Key"),
    );
    let body: CheckoutRequestBody;

    try {
      body = await readJsonBodyWithLimit<CheckoutRequestBody>(
        request,
        maxCheckoutBodyBytes,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw new BillingError(
          "INVALID_REQUEST",
          "Размер данных оформления подписки превышает допустимый.",
          413,
        );
      }

      throw new BillingError(
        "INVALID_REQUEST",
        "Некорректные данные оформления подписки.",
        400,
        { cause: error },
      );
    }

    if (!isSubscriptionPlanId(body.plan)) {
      throw new BillingError(
        "INVALID_PLAN",
        "Выбранный тариф не найден.",
        400,
      );
    }

    if (body.offerAccepted !== true) {
      throw new BillingError(
        "INVALID_REQUEST",
        "Подтвердите условия подписки и автоматического продления.",
        400,
      );
    }

    const receiptEmail = validateReceiptEmail(body.receiptEmail);
    const { config, service } = getPaymentRuntime();

    const result = await service.createCheckout({
      customerId: user.id,
      planId: body.plan,
      countryCode: "RU",
      legalEntityId: academyLegalEntityId,
      receiptContact: {
        email: receiptEmail ?? user.receiptEmail,
      },
      offerAcceptance: {
        acceptedAt: new Date().toISOString(),
        offerVersion: offerDocumentVersion,
      },
      recurringConsent: {
        acceptedAt: new Date().toISOString(),
        offerVersion: offerDocumentVersion,
      },
      idempotencyKey,
      publicBaseUrl: resolvePublicBaseUrl(request.url, config),
    });

    return Response.json(result, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof IdentityError) {
      return identityErrorResponse(error);
    }

    return billingErrorResponse(error);
  }
}
