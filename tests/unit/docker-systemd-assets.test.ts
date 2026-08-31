import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("systemd-артефакты production-образа", () => {
  it("включает файлы worker рекуррентных продлений в Docker build context", () => {
    const dockerignore = readProjectFile(".dockerignore");
    const dockerfile = readProjectFile("Dockerfile");

    for (const fileName of [
      "academy-subscription-renewals.service",
      "academy-subscription-renewals.timer",
    ]) {
      expect(dockerfile).toContain(`/app/deploy/systemd/${fileName}`);
      expect(dockerignore).toContain(`!deploy/systemd/${fileName}`);
    }
  });
});
