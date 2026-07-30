import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("заголовки Client Hints", () => {
  it("запрашивает расширенные подсказки только на входе и авторизации", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers?.map((rule) => rule.source)).toEqual([
      "/login",
      "/api/auth/:path*",
    ]);
    expect(
      headers?.every((rule) =>
        rule.headers.some(
          (header) =>
            header.key === "Accept-CH" &&
            header.value.includes("Sec-CH-UA-Model"),
        ),
      ),
    ).toBe(true);
  });
});
