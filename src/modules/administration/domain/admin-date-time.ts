const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

function dateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function formatDateTimeLocal(
  date: Date,
  timeZone: string,
) {
  const parts = dateTimeParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateTimeLocalToUtcIso(
  value: string,
  timeZone: string,
) {
  const match = localDateTimePattern.exec(value);
  if (!match) {
    throw new TypeError("Укажите дату и время полностью.");
  }
  const [, year, month, day, hour, minute] = match;
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let instant = localAsUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = dateTimeParts(new Date(instant), timeZone);
    const renderedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const offset = renderedAsUtc - Math.floor(instant / 1_000) * 1_000;
    instant = localAsUtc - offset;
  }

  const date = new Date(instant);
  if (formatDateTimeLocal(date, timeZone) !== value) {
    throw new TypeError(
      "Указанное местное время отсутствует в выбранном часовом поясе.",
    );
  }

  return date.toISOString();
}
