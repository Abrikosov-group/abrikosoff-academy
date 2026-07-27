import { NextResponse } from "next/server";
import { isSubscriptionPlanId } from "@/modules/billing/domain/catalog";
import { IdentityError } from "@/modules/identity/domain/errors";
import {
  getIdentityConfig,
  privacyDocumentVersion,
} from "@/modules/identity/server/identity-config";
import { identityErrorResponse } from "@/modules/identity/server/http";
import {
  createTelegramLoginState,
  setTelegramLoginStateCookie,
} from "@/modules/identity/server/telegram-login-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicBaseUrl(requestUrl: string) {
  const configured = process.env.APP_BASE_URL?.trim();

  if (!configured && process.env.NODE_ENV === "production") {
    throw new IdentityError(
      "AUTH_NOT_CONFIGURED",
      "Публичный адрес Академии ещё не настроен.",
      503,
    );
  }

  try {
    return new URL(configured || requestUrl).origin;
  } catch (error) {
    throw new IdentityError(
      "AUTH_NOT_CONFIGURED",
      "Публичный адрес Академии задан некорректно.",
      503,
      { cause: error },
    );
  }
}

export async function POST(request: Request) {
  try {
    const config = getIdentityConfig();

    if (!config.telegram) {
      throw new IdentityError(
        "AUTH_NOT_CONFIGURED",
        "Вход через Telegram ещё не настроен.",
        503,
      );
    }

    let body: {
      plan?: unknown;
      privacyAccepted?: unknown;
    };

    try {
      body = (await request.json()) as typeof body;
    } catch (error) {
      throw new IdentityError(
        "INVALID_REQUEST",
        "Некорректные данные для входа через Telegram.",
        400,
        { cause: error },
      );
    }

    if (
      !isSubscriptionPlanId(body.plan) ||
      body.privacyAccepted !== true
    ) {
      throw new IdentityError(
        "INVALID_REQUEST",
        "Подтвердите согласие на обработку персональных данных.",
        400,
      );
    }

    const state = createTelegramLoginState(
      body.plan,
      privacyDocumentVersion,
      config.telegram.botToken,
    );
    const authUrl = new URL(
      "/api/auth/telegram/callback",
      publicBaseUrl(request.url),
    );
    authUrl.searchParams.set("state", state.state);
    const response = NextResponse.json(
      { authUrl: authUrl.toString() },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );

    setTelegramLoginStateCookie(response, state);
    return response;
  } catch (error) {
    return identityErrorResponse(error);
  }
}
