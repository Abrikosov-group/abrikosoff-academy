import { describe, expect, it } from "vitest";
import { normalizeUserAgentFamily } from "@/lib/user-agent-family";

describe("normalizeUserAgentFamily", () => {
  it.each([
    [
      "Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36",
      "Google Chrome",
    ],
    [
      "Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36 Edg/126.0",
      "Microsoft Edge",
    ],
    ["Mozilla/5.0 Firefox/128.0", "Mozilla Firefox"],
    [
      "Mozilla/5.0 Version/17.5 Safari/605.1.15",
      "Safari",
    ],
  ])("нормализует браузер без сырого User-Agent", (value, expected) => {
    expect(normalizeUserAgentFamily(value)).toBe(expected);
  });

  it("не сохраняет неизвестную исходную строку", () => {
    expect(
      normalizeUserAgentFamily(
        "SecretBrowser/1.0 internal-device-identifier",
      ),
    ).toBe("Другой браузер");
    expect(normalizeUserAgentFamily(null)).toBeUndefined();
  });
});
