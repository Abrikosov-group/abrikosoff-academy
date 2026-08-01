# frozen_string_literal: true

require "shellwords"

# Моделирует значимую для изоляции границу закреплённого Action
# be7b93b1907a4abad570368f3c74b6fe3807510b: shell-quote -> extraArgs -> argv SDK.
module ClaudeActionArgs
  module_function

  def extra_args(claude_args)
    args = Shellwords.shellsplit(
      claude_args.each_line.reject { |line| line.strip.start_with?("#") }.join
    )
    result = {}
    index = 0

    while index < args.length
      argument = args.fetch(index)
      unless argument.start_with?("--")
        index += 1
        next
      end

      flag = argument.delete_prefix("--")
      next_argument = args[index + 1]
      if next_argument && !next_argument.empty? && !next_argument.start_with?("--")
        result[flag] = next_argument
        index += 2
      else
        result[flag] = nil
        index += 1
      end
    end

    result
  end

  def sdk_argv(extra_args)
    extra_args.flat_map do |flag, value|
      value.nil? ? ["--#{flag}"] : ["--#{flag}", value]
    end
  end
end
