import { describe, expect, it } from "vitest";
import { administrationCommandErrorMessage } from "@/modules/administration/domain/admin-command-feedback";
import { calculateManualAccessPreview } from "@/modules/administration/domain/manual-access-preview";

describe("предпросмотр ручного доступа", () => {
  it("использует административный часовой пояс для длительности и пересечений", () => {
    const preview = calculateManualAccessPreview({
      periodStart: "2026-08-31T15:00",
      periodEnd: "2026-08-31T16:00",
      displayTimeZone: "Europe/Moscow",
      existingGrants: [
        {
          status: "granted",
          periodStart: "2026-08-31T11:30:00.000Z",
          periodEnd: "2026-08-31T12:30:00.000Z",
        },
      ],
    });

    expect(preview).toEqual({
      periodStartUtc: "2026-08-31T12:00:00.000Z",
      periodEndUtc: "2026-08-31T13:00:00.000Z",
      durationMilliseconds: 3_600_000,
      overlapCount: 1,
    });
  });
});

describe("ошибка административной команды", () => {
  it("показывает requestId вместе с русским сообщением", () => {
    expect(
      administrationCommandErrorMessage({
        error: { message: "Операция отклонена." },
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(
      "Операция отклонена. Идентификатор запроса: 11111111-1111-4111-8111-111111111111.",
    );
  });
});
