# frozen_string_literal: true

require "json"
require "pathname"
require "yaml"

review_root = Pathname.new(__dir__).parent
policy_path = review_root.join("reviewer-policy.yaml")
settings_path = review_root.join("claude-settings.json")
prompt_path = review_root.join("prompts/claude-fable-5-review.md")
workflow_path = review_root.parent.join("workflows/review-all.yml")
isolation_probe_path = review_root.join("tests/verify_claude_isolation.rb")
action_args_path = review_root.join("tests/claude_action_args.rb")

policy = YAML.safe_load(policy_path.read, permitted_classes: [], aliases: false)
settings = JSON.parse(settings_path.read)
prompt = prompt_path.read
workflow = workflow_path.read

def assert(condition, message)
  raise message unless condition
end

assert(policy.dig("model", "primary") == "claude-fable-5", "Основная модель не закреплена")
assert(policy.dig("model", "claude_code_version") == "2.1.220", "Версия Claude Code не закреплена")
assert(policy.dig("model", "github_action_version") == "1.0.183", "Версия GitHub Action не закреплена")
assert(
  policy.dig("model", "github_action_revision") == "be7b93b1907a4abad570368f3c74b6fe3807510b",
  "Ревизия GitHub Action не совпадает"
)
assert(policy.dig("model", "effort") == "max", "Требуется режим effort=max")
assert(policy.dig("model", "max_turns") == 1, "Ревью должно завершаться за один ход")
assert(policy.dig("model", "fallback", "model") == "claude-opus-5", "Fallback Opus 5 не закреплён")
assert(policy.dig("model", "fallback", "silent_success_forbidden") == true, "Скрытый fallback должен быть запрещён")
assert(policy.dig("authentication", "provider") == "claude_subscription", "Разрешена только подписка Claude")
assert(policy.dig("authentication", "usage_credits_must_be_disabled") == true, "Usage credits должны быть запрещены")
assert(
  policy.dig("input", "trusted_policy_source") == "exact_workflow_sha",
  "Политика должна загружаться из точного SHA workflow"
)
assert(policy.dig("input", "exact_workflow_sha_required") == true, "Требуется точный SHA workflow")
assert(policy.dig("input", "exact_base_ref_required") == true, "Требуется точное имя базовой ветки")
assert(policy.dig("input", "exact_base_sha_required") == true, "Требуется точный base SHA")
assert(policy.dig("input", "exact_merge_base_sha_required") == true, "Требуется точный merge-base SHA")
assert(
  policy.dig("input", "current_base_and_head_recheck_before_publication") == true,
  "Перед публикацией требуется повторная проверка base и head"
)
assert(policy.dig("input", "maximum_prompt_bytes") == 750_000, "Лимит входного снимка должен быть 750000 байт")
assert(policy.dig("output", "maximum_bytes") == 60_000, "Лимит результата должен быть 60000 байт")
assert(policy.dig("runtime", "tools") == [], "Инструменты должны быть отключены")
assert(
  policy.dig("runtime", "tools_argument_encoding") == "attached_empty_value",
  "Пустой список инструментов должен передаваться без потери пустого значения"
)
assert(
  policy.dig("verification", "tokenless_init_probe", "required") == true,
  "Требуется tokenless-проверка фактического init"
)
assert(
  policy.dig("verification", "tokenless_init_probe", "claude_code_version") == "2.1.220",
  "Tokenless-probe должен использовать точную версию Claude Code"
)
assert(
  policy.dig("verification", "tokenless_init_probe", "network_target") == "loopback_only",
  "Tokenless-probe должен исключать внешние сетевые запросы"
)
assert(
  policy.dig("verification", "tokenless_init_probe", "expected", "tools") == [],
  "Init должен подтверждать пустой список инструментов"
)
assert(
  policy.dig("verification", "tokenless_init_probe", "expected", "mcp_servers") == [],
  "Init должен подтверждать пустой список MCP"
)
assert(
  policy.dig("verification", "tokenless_init_probe", "expected", "slash_commands") == [],
  "Init должен подтверждать пустой список slash-команд"
)
assert(policy.dig("capabilities", "modify_files") == false, "Изменение файлов должно быть запрещено")
assert(policy.dig("capabilities", "write_github") == false, "Ревьюер не должен писать в GitHub")
assert(policy.dig("failure_policy", "reviewer_failure_is_positive_verdict") == false, "Сбой не является успешным ревью")
assert(policy.dig("failure_policy", "unknown_actual_model") == "fail", "Неизвестная модель должна завершать job ошибкой")

assert(settings["model"] == "claude-fable-5", "Модель в settings не совпадает")
assert(settings.dig("permissions", "defaultMode") == "plan", "Требуется plan mode")
assert(settings.dig("permissions", "allow") == [], "Allowlist должна быть пустой")
assert(settings.dig("permissions", "ask") == [], "Список интерактивных запросов должен быть пустым")
assert(settings.dig("permissions", "deny")&.include?("*"), "Все инструменты должны быть запрещены")
assert(settings["disableAllHooks"] == true, "Hooks должны быть отключены")
assert(settings["autoMemoryEnabled"] == false, "Auto memory должна быть отключена")
assert(settings.dig("env", "ANTHROPIC_API_KEY") == "", "API key должен быть принудительно пустым")
assert(settings.dig("env", "ANTHROPIC_AUTH_TOKEN") == "", "API auth token должен быть принудительно пустым")

[
  "Не исправляй найденные проблемы",
  "Не создавай коммиты",
  "Не публикуй комментарии в GitHub",
  "Не запускай CI",
  "Не запрашивай и не используй выводы Codex, Gemini",
  "BASE_SHA",
  "HEAD_SHA",
  "MERGE_BASE_SHA",
  "НАЧАЛО НЕДОВЕРЕННОГО СНИМКА",
  "P0 или P1 допустимы только при объективном доказательстве",
  "Пиши по-русски",
  "Подтверждённых дефектов P0–P3 не обнаружено."
].each do |fragment|
  assert(prompt.include?(fragment), "В промте отсутствует обязательная граница: #{fragment}")
end

[
  "uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "TRUSTED_POLICY_SHA: ${{ github.workflow_sha }}",
  "ref: ${{ steps.pr.outputs.trusted_policy_sha }}",
  "fetch-depth: 0",
  "persist-credentials: false",
  "CLAUDE_WORKING_DIR: ${{ runner.temp }}",
  "settings: ${{ steps.context.outputs.settings_file }}",
  "--model claude-fable-5",
  "--fallback-model claude-opus-5",
  "--effort max",
  "--max-turns 1",
  "--permission-mode plan",
  "--tools=",
  "--strict-mcp-config",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--no-chrome",
  "prompt_bytes > 750000",
  "bytes > 60000",
  "reviewed_base_ref: ${{ steps.pr.outputs.base_ref }}",
  "reviewed_base_sha: ${{ steps.pr.outputs.base_sha }}",
  "reviewed_head_sha: ${{ steps.pr.outputs.head_sha }}",
  "reviewed_merge_base_sha: ${{ steps.context.outputs.merge_base_sha }}",
  "actual_model: ${{ steps.extract.outputs.actual_model }}",
  "+refs/heads/${BASE_REF}:${snapshot_base_ref}",
  "+refs/pull/${PR_NUMBER}/head:${snapshot_head_ref}",
  "merge-base \"${BASE_SHA}\" \"${HEAD_SHA}\"",
  "\"${merge_base_sha}...${HEAD_SHA}\" --",
  ".message.model",
  "Ревью Claude Fable 5",
  "Ревью Claude Opus 5 (fallback)",
  "base/head PR изменились после ревью; устаревший результат не опубликован"
].each do |fragment|
  assert(workflow.include?(fragment), "Во workflow отсутствует обязательная защита: #{fragment}")
end

assert(!workflow.include?('--tools ""'), "Пустое значение --tools не должно теряться в парсере Action")
assert(!workflow.include?("gh pr diff"), "Workflow не должен получать изменяемый серверный PR diff")
assert(!workflow.include?('"${base_ref}" != "main"'), "Workflow не должен запрещать безопасное ревью промежуточных веток")
assert(!prompt.include?("BASE_SHA..HEAD_SHA"), "Промт ошибочно называет PR diff диапазоном BASE_SHA..HEAD_SHA")

assert(isolation_probe_path.file?, "Отсутствует tokenless-проверка system.init")
assert(action_args_path.file?, "Отсутствует модель границы Action/SDK")

workflow.scan(/^\s*uses:\s*([^\s#]+)/).flatten.each do |action|
  next unless action.include?("@")

  revision = action.split("@", 2).last
  assert(revision.match?(/\A[0-9a-f]{40}\z/), "Action не закреплён на полном SHA: #{action}")
end

all_text = [
  policy_path,
  settings_path,
  prompt_path,
  workflow_path,
  isolation_probe_path,
  action_args_path
].map(&:read).join("\n")
assert(!all_text.match?(/sk-ant-[A-Za-z0-9_-]+/), "В конфигурацию попал Anthropic-секрет")
assert(!all_text.match?(/gh[opusr]_[A-Za-z0-9_]+/), "В конфигурацию попал GitHub-токен")

puts "OK: локальная конфигурация Fable 5 и workflow прошли статическую проверку"
