import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reviewedWorkflowSha = "ce8a887cbb97fd01afcc65384d34046431613dd9";

function readProjectFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("организационное двойное ИИ-ревью", () => {
  const workflow = readProjectFile(".github/workflows/review-all.yml");
  const developmentWorkflow = readProjectFile("docs/development-workflow.md");
  const pullRequestTemplate = readProjectFile(
    ".github/pull_request_template.md",
  );

  it("закрепляет оба вызова на проверенной версии организационного workflow", () => {
    const expectedReference =
      `Abrikosov-group/.github/.github/workflows/review-all.yml@${reviewedWorkflowSha}`;

    expect(workflow.split(expectedReference)).toHaveLength(3);
    expect(workflow).not.toContain(
      "Abrikosov-group/.github/.github/workflows/review-all.yml@main",
    );
  });

  it("запускает первоначальное ревью только для готового PR в main", () => {
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("ready_for_review");
    expect(workflow).toContain("github.event.pull_request.draft == false");
    expect(workflow).toContain("github.event.pull_request.base.ref == 'main'");
  });

  it("разрешает доверенный ручной повтор обоих ревьюеров", () => {
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain(
      "github.event.comment.body == '/review-all'",
    );
    expect(workflow).toContain("trigger: manual");
    expect(workflow).toContain("trigger: automatic");
    expect(workflow).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("не возвращает отключённые внешние контуры в workflow и шаблон PR", () => {
    expect(workflow).not.toMatch(/copilot|gemini/iu);
    expect(pullRequestTemplate).not.toMatch(/copilot|gemini/iu);
    expect(pullRequestTemplate).toContain("Org Codex");
    expect(pullRequestTemplate).toContain("Org Claude");
    expect(pullRequestTemplate).not.toMatch(/CODEX-NNN|CLAUDE-NNN/u);
  });

  it("согласует документацию с организационными Codex и Claude", () => {
    expect(developmentWorkflow).toMatch(
      /GitHub Copilot и Gemini в этом процессе не\s+используются/u,
    );
    expect(developmentWorkflow).toContain("Организационный Codex");
    expect(developmentWorkflow).toContain("Организационный Claude");
    expect(developmentWorkflow).toMatch(
      /Только владелец переводит PR из Draft\s+в Ready for review/u,
    );
  });
});
