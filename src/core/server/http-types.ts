export interface HttpRequest {
  readonly method: string;

  readonly path: string;

  readonly query: URLSearchParams;

  readonly headers: Readonly<Record<string, string>>;

  readonly body: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

export interface ErrorBody {
  readonly error: string;
  readonly code: string;
}

export function jsonResponse(
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(value),
  };
}

export function errorResponse(status: number, code: string, message: string): HttpResponse {
  return jsonResponse(status, { error: message, code } satisfies ErrorBody);
}

export function noContentResponse(): HttpResponse {
  return { status: 204, headers: {}, body: '' };
}
