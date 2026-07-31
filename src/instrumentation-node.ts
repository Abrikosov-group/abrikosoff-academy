import "server-only";

import { validateEffectiveAccessConfiguration } from "@/modules/access/server/get-effective-access";

export async function registerNodeInstrumentation() {
  try {
    await validateEffectiveAccessConfiguration();
  } catch (error) {
    setImmediate(() => process.exit(1));
    throw error;
  }
}
