import "server-only";

import type { AdministrationMode } from "../domain/types";

const localAcceptanceOrigin = "https://academy-dev.abrikosoff.com";
const productionOrigin = "https://academy.abrikosoff.com";

export type AdministrationConfig =
  | {
      enabled: false;
      mode: "disabled";
    }
  | {
      enabled: true;
      mode: Exclude<AdministrationMode, "disabled">;
    };

function canEnableAdministration(
  mode: Exclude<AdministrationMode, "disabled">,
) {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (!appBaseUrl) {
    return false;
  }

  try {
    const parsedAppBaseUrl = new URL(appBaseUrl);

    const hasExactOriginShape =
      parsedAppBaseUrl.pathname === "/" &&
      !parsedAppBaseUrl.username &&
      !parsedAppBaseUrl.password &&
      !parsedAppBaseUrl.search &&
      !parsedAppBaseUrl.hash;

    if (!hasExactOriginShape) {
      return false;
    }

    if (parsedAppBaseUrl.origin === localAcceptanceOrigin) {
      return true;
    }

    return (
      parsedAppBaseUrl.origin === productionOrigin &&
      mode === "owner_preview"
    );
  } catch {
    return false;
  }
}

export function getAdministrationConfig(): AdministrationConfig {
  const rawEnabled =
    process.env.ADMINISTRATION_ENABLED?.trim().toLowerCase() ||
    "false";

  if (!["true", "false"].includes(rawEnabled)) {
    throw new TypeError(
      "ADMINISTRATION_ENABLED должен быть true или false.",
    );
  }

  const rawMode =
    process.env.ADMINISTRATION_MODE?.trim().toLowerCase() ||
    "operational";

  if (!["owner_preview", "operational"].includes(rawMode)) {
    throw new TypeError(
      "ADMINISTRATION_MODE должен быть owner_preview или operational.",
    );
  }

  const enabled = rawEnabled === "true";

  if (!enabled) {
    return { enabled: false, mode: "disabled" };
  }

  const mode = rawMode as Exclude<
    AdministrationMode,
    "disabled"
  >;

  if (!canEnableAdministration(mode)) {
    throw new TypeError(
      "Режим Administration запрещён для заданного production-origin.",
    );
  }

  return { enabled: true, mode };
}
