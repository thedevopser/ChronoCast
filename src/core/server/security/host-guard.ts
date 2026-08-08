import { errorResponse, type HttpRequest, type HttpResponse } from '../http-types.js';

const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

const HOST_PORT_PATTERN = /^([a-z0-9.-]+)(?::([0-9]+))?$/;

const BRACKETED_IPV6_PATTERN = /^\[([0-9a-f:]+)\](?::([0-9]+))?$/;

function isValidPort(port: string): boolean {
  if (!/^[1-9][0-9]{0,4}$/.test(port)) {
    return false;
  }
  const value = Number.parseInt(port, 10);
  return value >= 1 && value <= 65_535;
}

export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader === '') {
    return false;
  }

  if (hostHeader.includes(',')) {
    return false;
  }

  const value = hostHeader.toLowerCase();

  const bracketed = BRACKETED_IPV6_PATTERN.exec(value);
  if (bracketed) {
    const [, address, port] = bracketed;
    if (port !== undefined && !isValidPort(port)) {
      return false;
    }
    return address !== undefined && ALLOWED_HOSTNAMES.has(address);
  }

  const matched = HOST_PORT_PATTERN.exec(value);
  if (!matched) {
    return false;
  }

  const [, hostname, port] = matched;
  if (port !== undefined && !isValidPort(port)) {
    return false;
  }

  return hostname !== undefined && ALLOWED_HOSTNAMES.has(hostname);
}

export function checkHost(request: HttpRequest): HttpResponse | null {
  if (isLoopbackHost(request.headers['host'])) {
    return null;
  }

  return errorResponse(
    403,
    'host_not_allowed',
    "Requête refusée : ChronoCast n'accepte que les connexions locales.",
  );
}
