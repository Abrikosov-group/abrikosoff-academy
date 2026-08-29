import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const reviewedWorkflowSha = "5fb3bc99efb0703cb5e979295ba1c75f2f0cce1f";
const runnerBundleDirectory =
  "infra/github-runners/abrikosoff-academy-review";

function extractJob(source: string, jobId: string, nextJobId?: string): string {
  const start = source.indexOf(`\n  ${jobId}:`);
  const end = nextJobId
    ? source.indexOf(`\n  ${nextJobId}:`, start + 1)
    : source.length;

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readProjectFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("организационное двойное ИИ-ревью", () => {
  const workflow = readProjectFile(".github/workflows/review-all.yml");
  const developmentWorkflow = readProjectFile("docs/development-workflow.md");
  const pullRequestTemplate = readProjectFile(
    ".github/pull_request_template.md",
  );
  const runnerReadme = readProjectFile(`${runnerBundleDirectory}/README.md`);
  const runnerInstall = readProjectFile(`${runnerBundleDirectory}/install.sh`);
  const runnerPolicy = readProjectFile(
    `${runnerBundleDirectory}/verify-job.sh`,
  );
  const runnerCleanup = readProjectFile(
    `${runnerBundleDirectory}/cleanup-model-job.sh`,
  );
  const runnerOverrides = [
    readProjectFile(`${runnerBundleDirectory}/orchestration-runner-override.conf`),
    readProjectFile(`${runnerBundleDirectory}/codex-runner-override.conf`),
    readProjectFile(`${runnerBundleDirectory}/claude-runner-override.conf`),
  ];

  it("закрепляет оба вызова на проверенной версии организационного workflow", () => {
    const expectedReference =
      `Abrikosov-group/.github/.github/workflows/review-all.yml@${reviewedWorkflowSha}`;

    expect(workflow.split(expectedReference)).toHaveLength(3);
    expect(runnerReadme).toContain(expectedReference);
    expect(workflow).not.toContain(
      "Abrikosov-group/.github/.github/workflows/review-all.yml@main",
    );
  });

  it("передаёт полный контракт защищённых runner в оба вызова", () => {
    const requiredInputs = [
      "trusted_workflow_repository: Abrikosov-group/.github",
      `trusted_workflow_sha: ${reviewedWorkflowSha}`,
      "automatic_base_refs: main",
      'manual_base_refs: "*"',
      "review_runner_group: abrikosoff-academy-review",
      "orchestration_runner_label: abrikosoff-academy-review-orchestration",
      "codex_runner_label: abrikosoff-academy-review-codex",
      "claude_runner_label: abrikosoff-academy-review-claude",
      "expected_orchestration_runner_name: abrikosoff-academy-review-orchestration-01",
      "expected_codex_runner_name: abrikosoff-academy-review-codex-01",
      "expected_claude_runner_name: abrikosoff-academy-review-claude-01",
      "reuse_existing_reviews: true",
      "review_gate_context: Двойное ИИ-ревью",
    ];
    const manualJob = extractJob(
      workflow,
      "manual-review",
      "finalize-manual-ack",
    );
    const automaticJob = extractJob(workflow, "automatic-review");

    for (const job of [manualJob, automaticJob]) {
      for (const input of requiredInputs) {
        expect(job).toContain(`      ${input}`);
      }
    }
    expect(workflow).toMatch(/permissions:[\s\S]*?actions: read/u);
    expect(workflow).toMatch(/permissions:[\s\S]*?statuses: write/u);
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

  it("закрепляет отдельные identity и группу трёх Academy runner", () => {
    const exactRunnerContract = [
      "RUNNER_GROUP='abrikosoff-academy-review'",
      "ORCHESTRATION_NAME='abrikosoff-academy-review-orchestration-01'",
      "CODEX_NAME='abrikosoff-academy-review-codex-01'",
      "CLAUDE_NAME='abrikosoff-academy-review-claude-01'",
      "ORCHESTRATION_USER='academyrevieworchestration'",
      "CODEX_USER='academyreviewcodex'",
      "CLAUDE_USER='academyreviewclaude'",
    ];

    for (const contractPart of exactRunnerContract) {
      expect(runnerInstall).toContain(contractPart);
    }
    expect(runnerInstall).toContain("RUNNER_VERSION='2.336.0'");
    expect(runnerInstall).toContain(
      "RUNNER_SHA256='04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d'",
    );
    expect(runnerInstall).toContain("IFS= read -r orchestration_token");
    expect(runnerInstall).toContain("IFS= read -r codex_token");
    expect(runnerInstall).toContain("IFS= read -r claude_token");
    expect(runnerInstall).not.toContain("--replace");
  });

  it("ограничивает job-start hook exact репозиторием, main и runner identity", () => {
    expect(runnerPolicy).toContain(
      "ACADEMY_REPOSITORY='Abrikosov-group/abrikosoff-academy'",
    );
    expect(runnerPolicy).toContain("EXPECTED_REPOSITORY_PRIVATE='false'");
    expect(runnerPolicy).toContain("EXPECTED_BASE_REFS=('main')");
    expect(runnerPolicy).toContain(
      'EXPECTED_ENTRY_WORKFLOW_REF="${ACADEMY_REPOSITORY}/.github/workflows/review-all.yml@${EXPECTED_EVENT_REF}"',
    );
    expect(runnerPolicy).toContain("'root:academyreview:750'");
    expect(runnerPolicy).not.toContain("Abrikosov-group/sawabook");
    expect(runnerPolicy).not.toContain("Abrikosov-group/.github");
  });

  it("очищает только точные Academy model homes и workspace", () => {
    expect(runnerCleanup).toContain(
      "EXPECTED_MODEL_HOME='/var/lib/abrikosoff-academy-review-codex'",
    );
    expect(runnerCleanup).toContain(
      "EXPECTED_MODEL_HOME='/var/lib/abrikosoff-academy-review-claude'",
    );
    expect(runnerCleanup).toContain(
      "EXPECTED_REPOSITORY_DIRECTORY='abrikosoff-academy'",
    );
    expect(runnerCleanup).toContain(
      '[[ "${GITHUB_WORKSPACE:-}" == "${EXPECTED_WORKSPACE}" ]]',
    );
    expect(runnerCleanup).not.toContain("Abrikosov-group/sawabook");
  });

  it("применяет одинаковое systemd-усиление ко всем трём runner", () => {
    for (const override of runnerOverrides) {
      expect(override).toContain("NoNewPrivileges=true");
      expect(override).toContain("ProtectProc=invisible");
      expect(override).toContain("ProtectSystem=full");
      expect(override).toContain("ProtectHome=true");
      expect(override).toContain("CapabilityBoundingSet=");
      expect(override).toContain("KillMode=control-group");
    }
  });

  it("сохраняет исполняемые shell-файлы синтаксически корректными", () => {
    for (const script of ["install.sh", "verify-job.sh", "cleanup-model-job.sh"]) {
      const scriptUrl = new URL(
        `../../${runnerBundleDirectory}/${script}`,
        import.meta.url,
      );
      expect(statSync(scriptUrl).mode & 0o111).not.toBe(0);
      expect(() =>
        execFileSync("bash", ["-n", scriptUrl.pathname], { stdio: "pipe" }),
      ).not.toThrow();
    }
  });
});
