import { fetch, ProxyAgent } from "undici";

const discoveryUrl =
  "https://oauth.telegram.org/.well-known/openid-configuration";
const expectedIssuer = "https://oauth.telegram.org";

function readProxyUrl() {
  const configuredProxyUrl =
    process.env.TELEGRAM_HTTPS_PROXY_URL?.trim();

  if (!configuredProxyUrl) {
    throw new Error("TELEGRAM_HTTPS_PROXY_URL не задан.");
  }

  const proxyUrl = new URL(configuredProxyUrl);

  if (
    !["http:", "https:"].includes(proxyUrl.protocol) ||
    proxyUrl.username ||
    proxyUrl.password ||
    proxyUrl.pathname !== "/" ||
    proxyUrl.search ||
    proxyUrl.hash
  ) {
    throw new Error("TELEGRAM_HTTPS_PROXY_URL имеет недопустимый формат.");
  }

  return proxyUrl.toString();
}

async function main() {
  const proxyUrl = readProxyUrl();
  const dispatcher = new ProxyAgent(proxyUrl);

  try {
    const response = await fetch(discoveryUrl, {
      dispatcher,
      headers: {
        Accept: "application/json",
        "User-Agent": "Abrikosoff-Academy-Egress-Check/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Telegram вернул HTTP ${response.status}.`);
    }

    const metadata = await response.json();

    if (
      metadata?.issuer !== expectedIssuer ||
      metadata?.token_endpoint !== `${expectedIssuer}/token` ||
      metadata?.jwks_uri !== `${expectedIssuer}/.well-known/jwks.json`
    ) {
      throw new Error("Telegram вернул неожиданные OIDC-метаданные.");
    }

    process.stdout.write(
      `${JSON.stringify({
        status: "ok",
        target: "telegram-oidc",
        transport: "configured-proxy",
      })}\n`,
    );
  } finally {
    await dispatcher.close();
  }
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      target: "telegram-oidc",
      transport: "configured-proxy",
    })}\n`,
  );
  process.exitCode = 1;
});
