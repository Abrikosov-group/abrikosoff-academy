# frozen_string_literal: true

require "base64"
require "json"
require "open3"
require "pathname"
require "tmpdir"
require "yaml"

require_relative "claude_action_args"

review_root = Pathname.new(__dir__).parent
workflow_path = review_root.parent.join("workflows/review-all.yml")
workflow = YAML.safe_load(workflow_path.read, permitted_classes: [], aliases: false)
claude_job = workflow.fetch("jobs").fetch("claude-review")
publisher_job = workflow.fetch("jobs").fetch("publish-claude-review")
context_step = claude_job.fetch("steps").find { |step| step["id"] == "context" }
extract_step = claude_job.fetch("steps").find { |step| step["id"] == "extract" }
publish_step = publisher_job.fetch("steps").find { |step| step["id"] == "publish" }
claude_step = claude_job.fetch("steps").find { |step| step["id"] == "claude" }
raise "Шаг context не найден" unless context_step
raise "Шаг extract не найден" unless extract_step
raise "Шаг publish не найден" unless publish_step
raise "Шаг claude не найден" unless claude_step

claude_args = claude_step.fetch("with").fetch("claude_args")
cli_argv = ClaudeActionArgs.sdk_argv(ClaudeActionArgs.extra_args(claude_args))
isolation_argv = [
  "--tools=",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--disable-slash-commands",
  "--no-session-persistence",
  "--no-chrome"
]
tools_index = cli_argv.index("--tools=")
raise "Action/SDK не сохраняет пустое значение --tools" unless tools_index
unless cli_argv.slice(tools_index, isolation_argv.length) == isolation_argv
  raise "Параметры изоляции поглощены или изменены на границе Action/SDK"
end
raise "В argv остался опасный одиночный --tools" if cli_argv.include?("--tools")

unsafe_args = claude_args.sub("--tools=", '--tools ""')
unsafe_argv = ClaudeActionArgs.sdk_argv(ClaudeActionArgs.extra_args(unsafe_args))
unless unsafe_argv.include?("--tools") && !unsafe_argv.include?("--tools=")
  raise "Тест не воспроизвёл исходную потерю пустого значения --tools"
end

def run_git!(*arguments)
  stdout, stderr, status = Open3.capture3("git", *arguments)
  return stdout.strip if status.success?

  raise "Команда git #{arguments.join(' ')} завершилась ошибкой:\n#{stdout}#{stderr}"
end

def read_outputs(path)
  File.readlines(path, chomp: true).to_h { |line| line.split("=", 2) }
end

gh_context_stub = <<~'BASH'
  gh() {
    if [[ "$1" == "api" ]]; then
      printf '{"base":{"ref":"%s","sha":"%s"},"head":{"sha":"%s"}}\n' \
        "${MOCK_CURRENT_BASE_REF}" \
        "${MOCK_CURRENT_BASE_SHA}" \
        "${MOCK_CURRENT_HEAD_SHA}"
    else
      printf 'Неожиданный вызов gh: %s\n' "$*" >&2
      return 1
    fi
  }
BASH

gh_publish_stub = <<~'BASH'
  gh() {
    if [[ "$1" == "api" && "$*" == *"/comments?per_page=100"* ]]; then
      return 0
    fi
    if [[ "$1" == "api" && "$*" == *"/pulls/"* ]]; then
      printf '{"base":{"ref":"%s","sha":"%s"},"head":{"sha":"%s"}}\n' \
        "${MOCK_CURRENT_BASE_REF}" \
        "${MOCK_CURRENT_BASE_SHA}" \
        "${MOCK_CURRENT_HEAD_SHA}"
      return 0
    fi
    if [[ "$1" == "pr" && "$2" == "comment" ]]; then
      shift 2
      body_file=""
      while (( $# > 0 )); do
        if [[ "$1" == "--body-file" ]]; then
          body_file="$2"
          break
        fi
        shift
      done
      if [[ -z "${body_file}" ]]; then
        echo "Не передан body-file" >&2
        return 1
      fi
      cp "${body_file}" "${MOCK_PUBLISHED_BODY}"
      return 0
    fi
    printf 'Неожиданный вызов gh: %s\n' "$*" >&2
    return 1
  }
BASH

Dir.mktmpdir("review-all-tests-") do |suite_dir|
  source_repo = File.join(suite_dir, "source")
  run_git!("init", source_repo)
  run_git!("-C", source_repo, "config", "user.name", "Review Test")
  run_git!("-C", source_repo, "config", "user.email", "review-test@example.com")

  File.write(File.join(source_repo, "app.ts"), "const answer = 0;\n")
  run_git!("-C", source_repo, "add", "app.ts")
  run_git!("-C", source_repo, "commit", "-m", "root")
  merge_base_sha = run_git!("-C", source_repo, "rev-parse", "HEAD")
  run_git!("-C", source_repo, "branch", "-M", "main")
  base_ref = "codex/admin-operational-mvp"
  run_git!("-C", source_repo, "branch", base_ref, merge_base_sha)
  run_git!("-C", source_repo, "branch", "pr-head", merge_base_sha)

  File.write(File.join(source_repo, "trusted-policy.txt"), "Доверенная политика из main\n")
  run_git!("-C", source_repo, "add", "trusted-policy.txt")
  run_git!("-C", source_repo, "commit", "-m", "advance trusted policy")
  trusted_policy_sha = run_git!("-C", source_repo, "rev-parse", "HEAD")

  run_git!("-C", source_repo, "switch", base_ref)
  File.write(File.join(source_repo, "base-only.txt"), "Изменение только в base\n")
  run_git!("-C", source_repo, "add", "base-only.txt")
  run_git!("-C", source_repo, "commit", "-m", "advance base")
  base_sha = run_git!("-C", source_repo, "rev-parse", "HEAD")

  run_git!("-C", source_repo, "switch", "pr-head")
  File.write(File.join(source_repo, "app.ts"), "const answer = 42;\n")
  run_git!("-C", source_repo, "add", "app.ts")
  run_git!("-C", source_repo, "commit", "-m", "change head")
  head_sha = run_git!("-C", source_repo, "rev-parse", "HEAD")
  run_git!("-C", source_repo, "update-ref", "refs/pull/123/head", head_sha)

  run_context = lambda do |name:, current_base_ref:, current_base_sha:, current_head_sha:|
    case_dir = File.join(suite_dir, name)
    snapshot_repo = File.join(case_dir, "snapshot")
    runner_temp = File.join(case_dir, "runner-temp")
    Dir.mkdir(case_dir)
    Dir.mkdir(runner_temp)
    run_git!("clone", "--no-hardlinks", source_repo, snapshot_repo)
    run_git!("-C", snapshot_repo, "checkout", "--detach", trusted_policy_sha)

    metadata_path = File.join(runner_temp, "claude-pr-metadata.json")
    File.write(
      metadata_path,
      JSON.generate(
        title: "Тестовый PR",
        body: "Тестовый снимок",
        author: { login: "review-test" },
        baseRefName: base_ref,
        headRefName: "pr-head",
        headRefOid: head_sha,
        url: "https://example.invalid/pull/123"
      )
    )
    output_path = File.join(case_dir, "github-output")
    env = {
      "GH_TOKEN" => "test-token-not-a-secret",
      "REPOSITORY" => "Abrikosov-group/example",
      "PR_NUMBER" => "123",
      "BASE_REF" => base_ref,
      "BASE_SHA" => base_sha,
      "HEAD_SHA" => head_sha,
      "TRUSTED_POLICY_SHA" => trusted_policy_sha,
      "PR_METADATA_FILE" => metadata_path,
      "SNAPSHOT_REPO" => snapshot_repo,
      "TRUSTED_REVIEW_DIR" => review_root.to_s,
      "MOCK_CURRENT_BASE_REF" => current_base_ref,
      "MOCK_CURRENT_BASE_SHA" => current_base_sha,
      "MOCK_CURRENT_HEAD_SHA" => current_head_sha,
      "RUNNER_TEMP" => runner_temp,
      "GITHUB_OUTPUT" => output_path
    }
    stdout, stderr, status = Open3.capture3(
      env,
      "bash",
      "-c",
      gh_context_stub + context_step.fetch("run")
    )
    {
      stdout: stdout,
      stderr: stderr,
      status: status,
      output_path: output_path
    }
  end

  stable = run_context.call(
    name: "stable",
    current_base_ref: base_ref,
    current_base_sha: base_sha,
    current_head_sha: head_sha
  )
  unless stable.fetch(:status).success?
    raise "Сборка неизменяемого prompt завершилась ошибкой:\n#{stable.fetch(:stdout)}#{stable.fetch(:stderr)}"
  end
  stable_outputs = read_outputs(stable.fetch(:output_path))
  prompt = File.read(stable_outputs.fetch("prompt_file"))
  raise "В prompt отсутствует точный base SHA" unless prompt.include?("BASE_SHA: `#{base_sha}`")
  raise "В prompt отсутствует точный head SHA" unless prompt.include?("HEAD_SHA: `#{head_sha}`")
  unless prompt.include?("MERGE_BASE_SHA: `#{merge_base_sha}`")
    raise "В prompt отсутствует точный merge-base SHA"
  end
  raise "В prompt отсутствует diff точного head" unless prompt.include?("+const answer = 42;")
  if prompt.include?("Изменение только в base")
    raise "В PR diff ошибочно попало изменение, существующее только в base"
  end
  unless stable_outputs.fetch("merge_base_sha") == merge_base_sha
    raise "Workflow вернул неверный merge-base SHA"
  end

  stale_head = run_context.call(
    name: "stale-head",
    current_base_ref: base_ref,
    current_base_sha: base_sha,
    current_head_sha: "c" * 40
  )
  raise "Изменение head SHA не было отклонено" if stale_head.fetch(:status).success?

  stale_base = run_context.call(
    name: "stale-base",
    current_base_ref: base_ref,
    current_base_sha: "d" * 40,
    current_head_sha: head_sha
  )
  raise "Изменение base SHA не было отклонено" if stale_base.fetch(:status).success?

  stale_base_ref = run_context.call(
    name: "stale-base-ref",
    current_base_ref: "main",
    current_base_sha: base_sha,
    current_head_sha: head_sha
  )
  raise "Изменение базовой ветки не было отклонено" if stale_base_ref.fetch(:status).success?

  run_extract = lambda do |name:, model:|
    case_dir = File.join(suite_dir, name)
    Dir.mkdir(case_dir)
    execution_file = File.join(case_dir, "claude-execution-output.json")
    output_path = File.join(case_dir, "github-output")
    messages = []
    if model
      messages << {
        type: "assistant",
        message: {
          model: model,
          content: [{ type: "text", text: "Проверенный результат" }]
        }
      }
    end
    messages << { type: "result", result: "Проверенный результат" }
    File.write(execution_file, JSON.generate(messages))
    env = {
      "EXECUTION_FILE" => execution_file,
      "RUNNER_TEMP" => case_dir,
      "GITHUB_OUTPUT" => output_path,
      "CLAUDE_CODE_OAUTH_TOKEN" => nil,
      "INPUT_CLAUDE_CODE_OAUTH_TOKEN" => nil
    }
    stdout, stderr, status = Open3.capture3(env, "bash", "-c", extract_step.fetch("run"))
    outputs = status.success? ? read_outputs(output_path) : {}
    { stdout: stdout, stderr: stderr, status: status, outputs: outputs }
  end

  fable_extract = run_extract.call(name: "extract-fable", model: "claude-fable-5")
  raise "Fable 5 не распознан" unless fable_extract.fetch(:status).success?
  unless fable_extract.fetch(:outputs).fetch("actual_model") == "claude-fable-5"
    raise "Извлечена неверная фактическая модель Fable"
  end

  opus_extract = run_extract.call(name: "extract-opus", model: "claude-opus-5")
  raise "Opus 5 fallback не распознан" unless opus_extract.fetch(:status).success?
  unless opus_extract.fetch(:outputs).fetch("actual_model") == "claude-opus-5"
    raise "Извлечена неверная фактическая модель Opus"
  end

  unknown_extract = run_extract.call(name: "extract-unknown", model: "claude-unknown")
  raise "Неизвестная модель не была отклонена" if unknown_extract.fetch(:status).success?
  missing_extract = run_extract.call(name: "extract-missing", model: nil)
  raise "Отсутствующая модель не была отклонена" if missing_extract.fetch(:status).success?

  run_publish = lambda do |name:, actual_model:, current_base_ref:, current_base_sha:, current_head_sha:|
    case_dir = File.join(suite_dir, name)
    Dir.mkdir(case_dir)
    published_body = File.join(case_dir, "published.md")
    env = {
      "GH_TOKEN" => "test-token-not-a-secret",
      "REPOSITORY" => "Abrikosov-group/example",
      "PR_NUMBER" => "123",
      "COMMENT_ID" => "456",
      "CLAUDE_RESULT_BASE64" => Base64.strict_encode64("Проверенный результат"),
      "ACTUAL_MODEL" => actual_model,
      "REVIEWED_BASE_REF" => base_ref,
      "REVIEWED_BASE_SHA" => base_sha,
      "REVIEWED_HEAD_SHA" => head_sha,
      "REVIEWED_MERGE_BASE_SHA" => merge_base_sha,
      "MOCK_CURRENT_BASE_REF" => current_base_ref,
      "MOCK_CURRENT_BASE_SHA" => current_base_sha,
      "MOCK_CURRENT_HEAD_SHA" => current_head_sha,
      "MOCK_PUBLISHED_BODY" => published_body,
      "RUNNER_TEMP" => case_dir
    }
    stdout, stderr, status = Open3.capture3(
      env,
      "bash",
      "-c",
      gh_publish_stub + publish_step.fetch("run")
    )
    {
      stdout: stdout,
      stderr: stderr,
      status: status,
      published_body: published_body
    }
  end

  stale_publish = run_publish.call(
    name: "publish-stale-base",
    actual_model: fable_extract.fetch(:outputs).fetch("actual_model"),
    current_base_ref: base_ref,
    current_base_sha: "e" * 40,
    current_head_sha: head_sha
  )
  raise "Публикация после изменения base SHA не была запрещена" if stale_publish.fetch(:status).success?
  if File.exist?(stale_publish.fetch(:published_body))
    raise "Устаревший результат был передан в gh pr comment"
  end

  stale_ref_publish = run_publish.call(
    name: "publish-stale-base-ref",
    actual_model: fable_extract.fetch(:outputs).fetch("actual_model"),
    current_base_ref: "main",
    current_base_sha: base_sha,
    current_head_sha: head_sha
  )
  if stale_ref_publish.fetch(:status).success?
    raise "Публикация после изменения базовой ветки не была запрещена"
  end
  if File.exist?(stale_ref_publish.fetch(:published_body))
    raise "Результат для другой базовой ветки был передан в gh pr comment"
  end

  fable_publish = run_publish.call(
    name: "publish-fable",
    actual_model: fable_extract.fetch(:outputs).fetch("actual_model"),
    current_base_ref: base_ref,
    current_base_sha: base_sha,
    current_head_sha: head_sha
  )
  raise "Результат Fable 5 не опубликован" unless fable_publish.fetch(:status).success?
  fable_body = File.read(fable_publish.fetch(:published_body))
  raise "Неверный заголовок Fable 5" unless fable_body.start_with?("## Ревью Claude Fable 5\n")
  [base_sha, merge_base_sha, head_sha].each do |sha|
    raise "В комментарии отсутствует проверенный SHA #{sha}" unless fable_body.include?(sha)
  end

  opus_publish = run_publish.call(
    name: "publish-opus",
    actual_model: opus_extract.fetch(:outputs).fetch("actual_model"),
    current_base_ref: base_ref,
    current_base_sha: base_sha,
    current_head_sha: head_sha
  )
  raise "Результат Opus 5 fallback не опубликован" unless opus_publish.fetch(:status).success?
  opus_body = File.read(opus_publish.fetch(:published_body))
  unless opus_body.start_with?("## Ревью Claude Opus 5 (fallback)\n")
    raise "Fallback Opus 5 не обозначен явно"
  end

  unknown_publish = run_publish.call(
    name: "publish-unknown",
    actual_model: "claude-unknown",
    current_base_ref: base_ref,
    current_base_sha: base_sha,
    current_head_sha: head_sha
  )
  raise "Publisher принял неизвестную модель" if unknown_publish.fetch(:status).success?
  if File.exist?(unknown_publish.fetch(:published_body))
    raise "Результат неизвестной модели был передан в gh pr comment"
  end
end

puts "OK: промежуточная базовая ветка использует доверенную политику из workflow SHA"
puts "OK: неизменяемый снимок принят при стабильных base ref/base SHA/head SHA"
puts "OK: изменения base ref, base SHA и head SHA отклоняются независимо"
puts "OK: публикация запрещается при изменении базы после выполнения модели"
puts "OK: Fable 5 и Opus 5 получают достоверные отдельные заголовки"
puts "OK: неизвестная или отсутствующая фактическая модель блокирует публикацию"
puts "OK: Action/SDK сохраняет пустой --tools и отдельные параметры изоляции"
puts "OK: тесты использовали только локальные fixture и не запускали Claude"
