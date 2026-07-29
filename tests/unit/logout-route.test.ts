import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  clearSessionCookieMock,
  revokeCurrentSessionMock,
} = vi.hoisted(() => ({
  clearSessionCookieMock: vi.fn(),
  revokeCurrentSessionMock: vi.fn(),
}));

vi.mock("@/modules/identity/server/session", () => ({
  clearSessionCookie: clearSessionCookieMock,
  revokeCurrentSession: revokeCurrentSessionMock,
}));

import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "APP_BASE_URL",
      "https://academy-dev.abrikosoff.com",
    );
    revokeCurrentSessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("выходит на канонический публичный адрес за reverse proxy", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3100/api/auth/logout", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://academy-dev.abrikosoff.com/",
    );
    expect(revokeCurrentSessionMock).toHaveBeenCalledOnce();
    expect(clearSessionCookieMock).toHaveBeenCalledWith(response);
  });

  it("не отзывает сессию, если безопасный редирект не настроен", async () => {
    vi.stubEnv("APP_BASE_URL", "");

    await expect(
      POST(
        new Request("http://127.0.0.1:3100/api/auth/logout", {
          method: "POST",
        }),
      ),
    ).rejects.toMatchObject({
      code: "AUTH_NOT_CONFIGURED",
      httpStatus: 503,
    });
    expect(revokeCurrentSessionMock).not.toHaveBeenCalled();
    expect(clearSessionCookieMock).not.toHaveBeenCalled();
  });
});
