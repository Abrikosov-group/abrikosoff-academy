import "server-only";

import { isIP } from "node:net";
import type {
  SessionClientContext,
  SessionDeviceType,
} from "../domain/types";
import { normalizeUserAgentFamily } from "@/lib/user-agent-family";

type TrustedProxy = "none" | "cloudflare";

type ParsedDevice = {
  type: SessionDeviceType;
  vendor?: string;
  model?: string;
};

function safeHeader(
  value: string | null | undefined,
  maximumLength: number,
) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();

  return normalized &&
    normalized.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : undefined;
}

function unquoteClientHint(
  value: string | null | undefined,
  maximumLength: number,
) {
  const safeValue = safeHeader(value, maximumLength + 2);

  if (!safeValue) {
    return undefined;
  }

  const unquoted =
    safeValue.startsWith('"') && safeValue.endsWith('"')
      ? safeValue.slice(1, -1)
      : safeValue;

  return safeHeader(unquoted, maximumLength);
}

function matchVersion(
  userAgent: string,
  expression: RegExp,
) {
  return safeHeader(
    userAgent.match(expression)?.[1]?.replaceAll("_", "."),
    80,
  );
}

function parseBrowserVersion(
  userAgent: string,
  family: string | undefined,
  fullVersionList?: string,
) {
  const expectedBrands: Record<string, readonly string[]> = {
    "Microsoft Edge": ["Microsoft Edge"],
    Opera: ["Opera", "Opera GX"],
    "Google Chrome": ["Google Chrome"],
    "Mozilla Firefox": ["Firefox"],
    Safari: ["Safari"],
  };
  const fullVersion = fullVersionList
    ? Array.from(
        fullVersionList.matchAll(
          /"([^"]{1,80})"\s*;\s*v="([\d.]{1,80})"/gu,
        ),
      ).find((match) =>
        expectedBrands[family ?? ""]?.includes(match[1]),
      )?.[2]
    : undefined;

  if (fullVersion) {
    return fullVersion;
  }

  switch (family) {
    case "Microsoft Edge":
      return matchVersion(userAgent, /\bEdgA?\/([\d.]+)/u);
    case "Opera":
      return matchVersion(userAgent, /\bOPR\/([\d.]+)/u);
    case "Google Chrome":
      return matchVersion(
        userAgent,
        /\b(?:Chrome|CriOS)\/([\d.]+)/u,
      );
    case "Mozilla Firefox":
      return matchVersion(
        userAgent,
        /\b(?:Firefox|FxiOS)\/([\d.]+)/u,
      );
    case "Safari":
      return matchVersion(userAgent, /\bVersion\/([\d.]+)/u);
    default:
      return undefined;
  }
}

function parseOperatingSystem(
  userAgent: string,
  platformHint?: string,
  platformVersionHint?: string,
) {
  const windowsVersion = matchVersion(
    userAgent,
    /\bWindows NT ([\d.]+)/u,
  );

  if (windowsVersion || platformHint === "Windows") {
    const versions: Record<string, string> = {
      "10.0": "10/11",
      "6.3": "8.1",
      "6.2": "8",
      "6.1": "7",
    };

    return {
      name: "Windows",
      version:
        platformVersionHint &&
        !/^0(?:\.0)*$/u.test(platformVersionHint)
          ? Number(platformVersionHint.split(".", 1)[0]) >= 13
            ? "11"
            : "10"
          : windowsVersion
            ? (versions[windowsVersion] ?? windowsVersion)
            : undefined,
    };
  }

  const androidVersion = matchVersion(
    userAgent,
    /\bAndroid ([\d.]+)/u,
  );

  if (androidVersion || platformHint === "Android") {
    return {
      name: "Android",
      version:
        platformVersionHint &&
        !/^0(?:\.0)*$/u.test(platformVersionHint)
          ? platformVersionHint
          : androidVersion,
    };
  }

  const iosVersion = matchVersion(
    userAgent,
    /\b(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/u,
  );

  if (
    iosVersion ||
    ["iOS", "iPhone", "iPad"].includes(platformHint ?? "")
  ) {
    return {
      name: "iOS",
      version:
        platformVersionHint &&
        !/^0(?:\.0)*$/u.test(platformVersionHint)
          ? platformVersionHint
          : iosVersion,
    };
  }

  const macOsVersion = matchVersion(
    userAgent,
    /\bMac OS X ([\d_]+)/u,
  );

  if (macOsVersion || platformHint === "macOS") {
    return {
      name: "macOS",
      version:
        platformVersionHint &&
        !/^0(?:\.0)*$/u.test(platformVersionHint)
          ? platformVersionHint
          : macOsVersion,
    };
  }

  const chromeOsVersion = matchVersion(
    userAgent,
    /\bCrOS [^ ]+ ([\d.]+)/u,
  );

  if (chromeOsVersion || platformHint === "Chrome OS") {
    return {
      name: "Chrome OS",
      version:
        platformVersionHint &&
        !/^0(?:\.0)*$/u.test(platformVersionHint)
          ? platformVersionHint
          : chromeOsVersion,
    };
  }

  if (/\bLinux\b/u.test(userAgent) || platformHint === "Linux") {
    return { name: "Linux", version: undefined };
  }

  return {
    name: safeHeader(platformHint, 80),
    version: undefined,
  };
}

function androidDeviceModel(userAgent: string) {
  const model = userAgent.match(
    /\bAndroid[^;)]*;\s*(?:[a-z]{2}[-_][A-Z]{2};\s*)?([^;)]+?)(?:\s+Build\/|;|\))/u,
  )?.[1];

  return safeHeader(model?.replace(/\s+wv$/u, ""), 120);
}

function vendorFromModel(model?: string) {
  if (!model) return undefined;
  if (/^(?:SM-|GT-|SAMSUNG)/iu.test(model)) return "Samsung";
  if (/^Pixel\b/iu.test(model)) return "Google";
  if (/^(?:HUAWEI|HONOR)\b/iu.test(model)) return "Huawei";
  if (/^(?:Redmi|Mi |MIX |POCO)\b/iu.test(model)) return "Xiaomi";

  return undefined;
}

function parseDevice(
  userAgent: string,
  mobileHint: string | null,
  modelHint?: string,
): ParsedDevice {
  if (/\b(?:bot|crawler|spider|TelegramBot)\b/iu.test(userAgent)) {
    return { type: "bot" };
  }

  if (/\biPad\b/u.test(userAgent)) {
    return {
      type: "tablet",
      vendor: "Apple",
      model: modelHint ?? "iPad",
    };
  }

  if (/\b(?:iPhone|iPod)\b/u.test(userAgent)) {
    return {
      type: "mobile",
      vendor: "Apple",
      model:
        modelHint ??
        (/\biPod\b/u.test(userAgent) ? "iPod" : "iPhone"),
    };
  }

  if (/\bAndroid\b/u.test(userAgent)) {
    const model = modelHint ?? androidDeviceModel(userAgent);
    const tablet =
      !/\bMobile\b/u.test(userAgent) ||
      /\bTablet\b/iu.test(userAgent);

    return {
      type: tablet ? "tablet" : "mobile",
      vendor: vendorFromModel(model),
      model,
    };
  }

  if (mobileHint === "?1" || /\bMobile\b/u.test(userAgent)) {
    return { type: "mobile", model: modelHint };
  }

  if (
    /\b(?:Windows NT|Macintosh|X11|CrOS|Linux)\b/u.test(
      userAgent,
    )
  ) {
    return {
      type: "desktop",
      vendor: /\bMacintosh\b/u.test(userAgent)
        ? "Apple"
        : undefined,
      model: modelHint,
    };
  }

  return { type: "other", model: modelHint };
}

function preferredLanguage(value: string | null) {
  const language = value?.split(",", 1)[0]?.split(";", 1)[0]?.trim();

  return language &&
    language.length <= 35 &&
    /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language)
    ? language
    : undefined;
}

function cloudflareLocation(
  headers: Headers,
  trustedProxy: TrustedProxy,
) {
  if (trustedProxy !== "cloudflare") {
    return {};
  }

  const ipAddress = safeHeader(
    headers.get("cf-connecting-ip"),
    45,
  );

  if (!ipAddress || isIP(ipAddress) === 0) {
    return {};
  }

  const countryCode = safeHeader(headers.get("cf-ipcountry"), 2);
  const rayId = safeHeader(headers.get("cf-ray"), 80);

  return {
    ipAddress,
    countryCode:
      countryCode && /^[A-Za-z]{2}$/u.test(countryCode)
        ? countryCode.toUpperCase()
        : undefined,
    region: safeHeader(headers.get("cf-region"), 160),
    regionCode: safeHeader(headers.get("cf-region-code"), 16),
    city: safeHeader(headers.get("cf-ipcity"), 160),
    timezone: safeHeader(headers.get("cf-timezone"), 64),
    cloudflareRayId:
      rayId && /^[A-Za-z0-9-]+$/u.test(rayId)
        ? rayId
        : undefined,
  };
}

export function collectSessionClientContext(
  headers: Headers,
  trustedProxy: TrustedProxy,
): SessionClientContext {
  const rawUserAgent = safeHeader(
    headers.get("user-agent"),
    1_024,
  );
  const platformHint = unquoteClientHint(
    headers.get("sec-ch-ua-platform"),
    80,
  );
  const modelHint = unquoteClientHint(
    headers.get("sec-ch-ua-model"),
    120,
  );
  const platformVersionHint = unquoteClientHint(
    headers.get("sec-ch-ua-platform-version"),
    80,
  );
  const fullVersionList = safeHeader(
    headers.get("sec-ch-ua-full-version-list"),
    1_024,
  );
  const architecture = unquoteClientHint(
    headers.get("sec-ch-ua-arch"),
    32,
  );
  const bitness = unquoteClientHint(
    headers.get("sec-ch-ua-bitness"),
    3,
  );
  const userAgentFamily = normalizeUserAgentFamily(rawUserAgent);
  const operatingSystem = parseOperatingSystem(
    rawUserAgent ?? "",
    platformHint,
    platformVersionHint,
  );
  const device = parseDevice(
    rawUserAgent ?? "",
    headers.get("sec-ch-ua-mobile"),
    modelHint,
  );

  return {
    ...cloudflareLocation(headers, trustedProxy),
    userAgentFamily,
    browserVersion: rawUserAgent
      ? parseBrowserVersion(
          rawUserAgent,
          userAgentFamily,
          fullVersionList,
        )
      : undefined,
    operatingSystem: operatingSystem.name,
    operatingSystemVersion: operatingSystem.version,
    deviceType: device.type,
    deviceVendor: device.vendor,
    deviceModel: device.model,
    architecture:
      architecture &&
      /^[A-Za-z0-9._-]+$/u.test(architecture)
        ? architecture
        : undefined,
    bitness:
      bitness && /^[0-9]{1,3}$/u.test(bitness)
        ? bitness
        : undefined,
    preferredLanguage: preferredLanguage(
      headers.get("accept-language"),
    ),
    rawUserAgent,
  };
}
