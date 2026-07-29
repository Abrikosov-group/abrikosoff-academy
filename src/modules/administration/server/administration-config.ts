import "server-only";

export type AdministrationConfig = {
  enabled: boolean;
};

const localAcceptanceOrigin = "https://academy-dev.abrikosoff.com";

function canEnableAdministration() {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (!appBaseUrl) {
    return false;
  }

  try {
    const parsedAppBaseUrl = new URL(appBaseUrl);

    return (
      parsedAppBaseUrl.origin === localAcceptanceOrigin &&
      parsedAppBaseUrl.pathname === "/" &&
      !parsedAppBaseUrl.username &&
      !parsedAppBaseUrl.password &&
      !parsedAppBaseUrl.search &&
      !parsedAppBaseUrl.hash
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

  const enabled = rawEnabled === "true";

  if (enabled && !canEnableAdministration()) {
    throw new TypeError(
      "Production-доступ к Administration откроется после приёмки этапа 2.",
    );
  }

  return { enabled };
}
