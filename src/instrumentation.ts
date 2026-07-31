export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { validateEffectiveAccessConfiguration } = await import(
    "@/modules/access/server/get-effective-access"
  );

  await validateEffectiveAccessConfiguration();
}
