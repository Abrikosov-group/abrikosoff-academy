#!/usr/bin/env node

import {
  AdminBootstrapError,
  bootstrapOwner,
} from "./lib/admin-bootstrap.mjs";

const help = `Управление административным контуром Академии

Использование:
  academy-admin grant \\
    --user-id <UUID> \\
    --role owner \\
    --reason "<причина>" \\
    --idempotency-key <ключ> \\
    [--production]
`;

function parseArguments(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }

  const [command, ...argumentsList] = argv;

  if (command !== "grant") {
    throw new AdminBootstrapError(
      "INVALID_COMMAND",
      "Разрешена только команда grant.",
      2,
    );
  }

  const values = new Map();
  let production = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const name = argumentsList[index];

    if (name === "--production") {
      if (production) {
        throw new AdminBootstrapError(
          "DUPLICATE_ARGUMENT",
          "Флаг --production передан повторно.",
          2,
        );
      }

      production = true;
      continue;
    }

    if (
      ![
        "--user-id",
        "--role",
        "--reason",
        "--idempotency-key",
      ].includes(name)
    ) {
      throw new AdminBootstrapError(
        "INVALID_ARGUMENT",
        `Неизвестный аргумент: ${name || "(пусто)"}.`,
        2,
      );
    }

    if (values.has(name)) {
      throw new AdminBootstrapError(
        "DUPLICATE_ARGUMENT",
        `Аргумент ${name} передан повторно.`,
        2,
      );
    }

    const value = argumentsList[index + 1];

    if (!value || value.startsWith("--")) {
      throw new AdminBootstrapError(
        "MISSING_ARGUMENT_VALUE",
        `Для ${name} не задано значение.`,
        2,
      );
    }

    values.set(name, value);
    index += 1;
  }

  if (process.env.NODE_ENV === "production" && !production) {
    throw new AdminBootstrapError(
      "PRODUCTION_CONFIRMATION_REQUIRED",
      "В production требуется явный флаг --production.",
      2,
    );
  }

  return {
    help: false,
    input: {
      userId: values.get("--user-id") || "",
      role: values.get("--role") || "",
      reason: values.get("--reason") || "",
      idempotencyKey:
        values.get("--idempotency-key") || "",
    },
  };
}

try {
  const parsed = parseArguments(process.argv.slice(2));

  if (parsed.help) {
    process.stdout.write(help);
    process.exitCode = 0;
  } else {
    const result = await bootstrapOwner(parsed.input);
    const status = result.repeated
      ? "Команда уже была успешно выполнена."
      : result.created
        ? "Первый владелец назначен."
        : "Активная роль владельца уже существовала.";

    process.stdout.write(
      `${status} execution_id=${result.executionId}\n`,
    );
  }
} catch (error) {
  if (error instanceof AdminBootstrapError) {
    process.stderr.write(
      `Команда отклонена: ${error.message} (${error.code})\n`,
    );
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(
      "Команда завершилась ошибкой (ADMIN_BOOTSTRAP_FAILED).\n",
    );
    process.exitCode = 1;
  }
}
