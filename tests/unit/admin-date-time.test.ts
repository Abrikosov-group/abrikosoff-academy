import { describe, expect, it } from "vitest";
import {
  dateTimeLocalToUtcIso,
  formatDateTimeLocal,
} from "@/modules/administration/domain/admin-date-time";

describe("дата административной формы", () => {
  it("показывает и отправляет время в настроенном часовом поясе", () => {
    const instant = new Date("2026-08-31T12:34:00.000Z");
    const local = formatDateTimeLocal(instant, "Europe/Moscow");

    expect(local).toBe("2026-08-31T15:34");
    expect(dateTimeLocalToUtcIso(local, "Europe/Moscow")).toBe(
      "2026-08-31T12:34:00.000Z",
    );
  });

  it("учитывает сезонный UTC-offset часового пояса", () => {
    expect(
      dateTimeLocalToUtcIso("2026-07-01T12:00", "Europe/Berlin"),
    ).toBe("2026-07-01T10:00:00.000Z");
    expect(
      dateTimeLocalToUtcIso("2026-01-01T12:00", "Europe/Berlin"),
    ).toBe("2026-01-01T11:00:00.000Z");
  });
});
