# frozen_string_literal: true

# Ручная tokenless-приёмка точной версии Claude Code.
# Процесс останавливается сразу после system.init; модель не вызывается.

require "fileutils"
require "json"
require "open3"
require "pathname"
require "tmpdir"
require "timeout"
require "yaml"

require_relative "claude_action_args"

def terminate_process(wait_thread)
  return if wait_thread.join(0.1)

  Process.kill("TERM", wait_thread.pid)
  return if wait_thread.join(3)

  Process.kill("KILL", wait_thread.pid)
  wait_thread.join
rescue Errno::ESRCH
  wait_thread.join
end

executable = ENV.fetch("CLAUDE_CODE_EXECUTABLE", "")
if executable.empty?
  warn "Укажите абсолютный путь CLAUDE_CODE_EXECUTABLE версии 2.1.220"
  exit 2
end

executable = File.realpath(executable)
version_stdout, version_stderr, version_status = Open3.capture3(executable, "--version")
unless version_status.success? && version_stdout.include?("2.1.220")
  warn "Ожидался Claude Code 2.1.220: #{version_stdout}#{version_stderr}"
  exit 1
end

init_message = nil
stderr_text = ""
review_root = Pathname.new(__dir__).parent
workflow = YAML.safe_load(
  review_root.parent.join("workflows/review-all.yml").read,
  permitted_classes: [],
  aliases: false
)
claude_step = workflow.fetch("jobs").fetch("claude-review").fetch("steps").find do |step|
  step["id"] == "claude"
end
raise "Шаг claude не найден" unless claude_step

claude_args = claude_step.fetch("with").fetch("claude_args")
action_argv = ClaudeActionArgs.sdk_argv(ClaudeActionArgs.extra_args(claude_args))

Dir.mktmpdir("claude-isolation-probe-") do |probe_dir|
  config_dir = File.join(probe_dir, "config")
  commands_dir = File.join(probe_dir, ".claude", "commands")
  FileUtils.mkdir_p(config_dir)
  FileUtils.mkdir_p(commands_dir)
  File.write(File.join(commands_dir, "ambient-probe.md"), "Эта команда не должна загрузиться.\n")
  File.write(
    File.join(probe_dir, ".mcp.json"),
    JSON.generate(mcpServers: { "ambient-probe" => { command: "/usr/bin/false", args: [] } })
  )

  env = {
    "PATH" => "/usr/bin:/bin",
    "CLAUDE_CONFIG_DIR" => config_dir,
    "CLAUDE_CODE_OAUTH_TOKEN" => "tokenless-local-probe",
    "ANTHROPIC_API_KEY" => "",
    "ANTHROPIC_AUTH_TOKEN" => "",
    "ANTHROPIC_BASE_URL" => "http://127.0.0.1:9",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY" => "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" => "1",
    "DISABLE_AUTOUPDATER" => "1",
    "DISABLE_TELEMETRY" => "1"
  }
  arguments = [
    "-p",
    "tokenless isolation probe",
    "--output-format", "stream-json",
    "--verbose",
    "--settings", review_root.join("claude-settings.json").to_s
  ] + action_argv

  Open3.popen3(
    env,
    executable,
    *arguments,
    chdir: probe_dir,
    unsetenv_others: true
  ) do |stdin, stdout, stderr, wait_thread|
    stdin.close
    stderr_reader = Thread.new { stderr.read }

    begin
      Timeout.timeout(15) do
        stdout.each_line do |line|
          message = JSON.parse(line)
          next unless message["type"] == "system" && message["subtype"] == "init"

          init_message = message
          break
        rescue JSON::ParserError
          next
        end
      end
    rescue Timeout::Error
      # Отсутствие init будет объяснено после безопасной остановки процесса.
    ensure
      terminate_process(wait_thread)
      stderr_text = stderr_reader.value
    end
  end

  session_files = Dir.glob(File.join(config_dir, "projects", "**", "*.jsonl"))
  raise "--no-session-persistence не применился: #{session_files.join(', ')}" unless session_files.empty?
end

raise "Claude Code не вернул system.init: #{stderr_text}" unless init_message

expected = {
  "tools" => [],
  "mcp_servers" => [],
  "slash_commands" => [],
  "model" => "claude-fable-5",
  "permissionMode" => "plan",
  "claude_code_version" => "2.1.220"
}
expected.each do |field, value|
  actual = init_message[field]
  raise "Неверное поле init #{field}: #{actual.inspect}, ожидалось #{value.inspect}" unless actual == value
end

puts "OK: tokenless init Claude Code 2.1.220 подтвердил пустые tools, MCP и slash commands"
puts "OK: probe использовал фиктивный OAuth и только недоступный loopback endpoint"
