import { GITHUB_API_VERSION } from "./config.mjs";
import { ReleaseGateError, assertGate } from "./errors.mjs";

function parseResponseBody(text) {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function safeErrorMessage(body) {
  if (body && typeof body === "object" && typeof body.message === "string") {
    return body.message;
  }

  return "GitHub API вернул неожиданный ответ";
}

export class GitHubApiError extends ReleaseGateError {
  constructor({ body, method, path, response }) {
    super(
      "GITHUB_API_ERROR",
      `${method} ${path}: HTTP ${response.status}: ${safeErrorMessage(body)}`,
    );
    this.body = body;
    this.headers = response.headers;
    this.method = method;
    this.path = path;
    this.status = response.status;
  }
}

export class GitHubTransportError extends ReleaseGateError {
  constructor({ cause, method, path }) {
    super(
      "GITHUB_API_TRANSPORT_ERROR",
      `${method} ${path}: транспортный запрос к GitHub API не выполнен`,
      { cause },
    );
    this.method = method;
    this.path = path;
  }
}

export class GitHubApi {
  constructor({
    apiUrl = "https://api.github.com",
    fetchImpl = globalThis.fetch,
    repository,
    token,
  }) {
    assertGate(typeof fetchImpl === "function", "FETCH_UNAVAILABLE", "fetch недоступен");
    assertGate(
      typeof token === "string" && token.length > 0,
      "GITHUB_TOKEN_MISSING",
      "Не задан GitHub token",
    );
    assertGate(
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""),
      "GITHUB_REPOSITORY_INVALID",
      "GITHUB_REPOSITORY имеет недопустимый формат",
    );

    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.repository = repository;
    this.token = token;
  }

  async request(
    path,
    { body, expectedStatuses = [200], method = "GET" } = {},
  ) {
    assertGate(path.startsWith("/"), "GITHUB_API_PATH_INVALID", "API path должен начинаться с /");

    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    let response;
    let text;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        body: requestBody,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        method,
      });
      text = await response.text();
    } catch (cause) {
      throw new GitHubTransportError({ cause, method, path });
    }
    const data = parseResponseBody(text);

    if (!expectedStatuses.includes(response.status)) {
      throw new GitHubApiError({ body: data, method, path, response });
    }

    return { data, headers: response.headers, status: response.status };
  }

  repoPath(path) {
    return `/repos/${this.repository}${path}`;
  }
}
