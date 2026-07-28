import "server-only";

export type AdministrationConfig = {
  enabled: boolean;
};

function isProductionDeployment() {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  const appBaseUrl = process.env.APP_BASE_URL?.trim();

  if (!appBaseUrl) {
    return true;
  }

  try {
    return (
      new URL(appBaseUrl).hostname.replace(/\.$/u, "") ===
      "academy.abrikosoff.com"
    );
  } catch {
    return true;
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

  if (enabled && isProductionDeployment()) {
    throw new TypeError(
      "Production-доступ к Administration откроется после приёмки этапа 2.",
    );
  }

  return { enabled };
}
