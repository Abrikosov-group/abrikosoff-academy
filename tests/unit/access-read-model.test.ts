import { describe, expect, it } from "vitest";
import {
  decodeAdminAccessCursor,
  encodeAdminAccessCursor,
} from "@/modules/administration/domain/access-read-model";

describe("курсор списка доступов", () => {
  it("декодирует корректный курсор", () => {
    const cursor = {
      sortAt: "2026-08-31T12:00:00.000Z",
      source: "manual" as const,
      id: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeAdminAccessCursor(encodeAdminAccessCursor(cursor))).toEqual(
      cursor,
    );
  });

  it("отклоняет курсор с невалидным UUID до SQL", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        sortAt: "2026-08-31T12:00:00.000Z",
        source: "manual",
        id: "not-a-uuid",
      }),
    ).toString("base64url");
    expect(decodeAdminAccessCursor(encoded)).toBeUndefined();
  });
});
