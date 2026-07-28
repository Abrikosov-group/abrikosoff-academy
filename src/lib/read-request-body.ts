export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Размер тела запроса превышает допустимый.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJsonBodyWithLimit<T>(
  request: Request,
  maxBytes: number,
) {
  const rawBody = await readTextBodyWithLimit(request, maxBytes);
  return JSON.parse(rawBody) as T;
}

export async function readTextBodyWithLimit(
  request: Request,
  maxBytes: number,
) {
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    receivedBytes += value.byteLength;

    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }

    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}
