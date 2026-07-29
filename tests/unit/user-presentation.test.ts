import { describe, expect, it } from "vitest";
import {
  getAvatarUrlFromMetadata,
  getUserInitials,
  normalizeUserAvatarUrl,
} from "@/modules/identity/domain/user-presentation";

describe("представление профиля пользователя", () => {
  it("принимает только корректный HTTPS-адрес аватара", () => {
    expect(
      normalizeUserAvatarUrl(
        "https://cdn4.telesco.pe/file/avatar.jpg",
      ),
    ).toBe("https://cdn4.telesco.pe/file/avatar.jpg");
    expect(
      getAvatarUrlFromMetadata({
        photoUrl: "https://t.me/i/userpic/avatar.jpg",
      }),
    ).toBe("https://t.me/i/userpic/avatar.jpg");
    expect(
      normalizeUserAvatarUrl("http://example.test/avatar.jpg"),
    ).toBeUndefined();
    expect(normalizeUserAvatarUrl("не адрес")).toBeUndefined();
  });

  it("строит инициалы без повреждения имени с эмодзи", () => {
    expect(getUserInitials("Анна Каренина")).toBe("АК");
    expect(getUserInitials("🅰️brikosov German")).toBe("BG");
    expect(getUserInitials("@german_abrikosov")).toBe("G");
    expect(getUserInitials("🧑‍🎓 Герман Абрикосов")).toBe("ГА");
    expect(getUserInitials("🧑‍🎓")).toBe("А");
  });
});
