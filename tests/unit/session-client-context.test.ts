import { describe, expect, it } from "vitest";
import { collectSessionClientContext } from "@/modules/identity/server/session-client-context";

describe("технический контекст сессии", () => {
  it("собирает Cloudflare, браузер, ОС и устройство при доверенном прокси", () => {
    const headers = new Headers({
      "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
      "cf-connecting-ip": "203.0.113.42",
      "cf-ipcity": "Moscow",
      "cf-ipcountry": "ru",
      "cf-ray": "9abcdef012345678-DME",
      "cf-region": "Moscow",
      "cf-region-code": "MOW",
      "cf-timezone": "Europe/Moscow",
      "sec-ch-ua-arch": '"arm"',
      "sec-ch-ua-bitness": '"64"',
      "sec-ch-ua-full-version-list":
        '"Chromium";v="138.0.7204.169", "Google Chrome";v="138.0.7204.169"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-platform-version": '"15.5.0"',
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/138.0.0.0 Safari/537.36",
    });

    expect(
      collectSessionClientContext(headers, "cloudflare"),
    ).toEqual({
      ipAddress: "203.0.113.42",
      countryCode: "RU",
      region: "Moscow",
      regionCode: "MOW",
      city: "Moscow",
      timezone: "Europe/Moscow",
      cloudflareRayId: "9abcdef012345678-DME",
      userAgentFamily: "Google Chrome",
      browserVersion: "138.0.7204.169",
      operatingSystem: "macOS",
      operatingSystemVersion: "15.5.0",
      deviceType: "desktop",
      deviceVendor: "Apple",
      deviceModel: undefined,
      architecture: "arm",
      bitness: "64",
      preferredLanguage: "ru-RU",
      rawUserAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/138.0.0.0 Safari/537.36",
    });
  });

  it("не доверяет IP и географии без явного режима Cloudflare", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.42",
      "cf-ipcountry": "RU",
      "cf-region": "Spoofed region",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
    });
    const context = collectSessionClientContext(headers, "none");

    expect(context).toMatchObject({
      userAgentFamily: "Google Chrome",
      browserVersion: "138.0.0.0",
      operatingSystem: "Windows",
      operatingSystemVersion: "10/11",
      deviceType: "desktop",
    });
    expect(context).not.toHaveProperty("ipAddress");
    expect(context).not.toHaveProperty("countryCode");
    expect(context).not.toHaveProperty("region");
  });

  it("определяет Android-смартфон и модель", () => {
    const headers = new Headers({
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP2A) " +
        "AppleWebKit/537.36 Chrome/137.0.0.0 Mobile Safari/537.36",
    });

    expect(
      collectSessionClientContext(headers, "none"),
    ).toMatchObject({
      operatingSystem: "Android",
      operatingSystemVersion: "14",
      deviceType: "mobile",
      deviceVendor: "Google",
      deviceModel: "Pixel 8 Pro",
    });
  });

  it("отбрасывает некорректные IP и location-заголовки", () => {
    const headers = new Headers({
      "cf-connecting-ip": "not-an-ip",
      "cf-ipcountry": "RUS",
      "cf-region": "Moscow",
    });
    const context = collectSessionClientContext(
      headers,
      "cloudflare",
    );

    expect(context).not.toHaveProperty("ipAddress");
    expect(context).not.toHaveProperty("countryCode");
    expect(context).not.toHaveProperty("region");
  });
});
