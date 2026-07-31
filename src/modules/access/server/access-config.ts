import "server-only";

import {
  effectiveAccessModes,
  type EffectiveAccessMode,
} from "../domain/effective-access";

export type AccessConfig = {
  effectiveAccessMode: EffectiveAccessMode;
  manualAccessGrantingEnabled: boolean;
};

function parseBooleanFlag(name: string, defaultValue: boolean) {
  const rawValue =
    process.env[name]?.trim().toLowerCase() ||
    String(defaultValue);

  if (rawValue !== "true" && rawValue !== "false") {
    throw new TypeError(`${name} должен быть true или false.`);
  }

  return rawValue === "true";
}

export function getAccessConfig(): AccessConfig {
  const rawMode =
    process.env.EFFECTIVE_ACCESS_MODE?.trim().toLowerCase() ||
    "shadow";

  if (
    !effectiveAccessModes.includes(
      rawMode as EffectiveAccessMode,
    )
  ) {
    throw new TypeError(
      "EFFECTIVE_ACCESS_MODE должен быть legacy, shadow, v2 или legacy_paid_plus_manual.",
    );
  }

  return {
    effectiveAccessMode: rawMode as EffectiveAccessMode,
    manualAccessGrantingEnabled: parseBooleanFlag(
      "MANUAL_ACCESS_GRANTING_ENABLED",
      false,
    ),
  };
}
