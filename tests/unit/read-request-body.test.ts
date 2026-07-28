import { describe, expect, it } from "vitest";
import {
  readJsonBodyWithLimit,
  readTextBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/read-request-body";

describe("readTextBodyWithLimit", () => {
  it("читает тело в пределах лимита", async () => {
    const request = new Request("https://academy.example.test/webhook", {
      method: "POST",
      body: "уведомление",
    });

    await expect(
      readTextBodyWithLimit(request, 64),
    ).resolves.toBe("уведомление");
  });

  it("считает байты, а не символы", async () => {
    const request = new Request("https://academy.example.test/webhook", {
      method: "POST",
      body: "аб",
    });

    await expect(
      readTextBodyWithLimit(request, 3),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("отклоняет завышенный Content-Length до чтения", async () => {
    const request = new Request("https://academy.example.test/webhook", {
      method: "POST",
      headers: {
        "Content-Length": "1024",
      },
      body: "{}",
    });

    await expect(
      readTextBodyWithLimit(request, 256),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});

describe("readJsonBodyWithLimit", () => {
  it("разбирает JSON после проверки размера", async () => {
    const request = new Request("https://academy.example.test/api", {
      method: "POST",
      body: JSON.stringify({ redirectPath: "/dashboard" }),
    });

    await expect(
      readJsonBodyWithLimit<{ redirectPath: string }>(request, 256),
    ).resolves.toEqual({ redirectPath: "/dashboard" });
  });
});
