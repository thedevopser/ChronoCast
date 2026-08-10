export const WS_PORT_META = 'chronocast-ws-port';

const WS_PORT_PLACEHOLDER = '__CHRONOCAST_WS_PORT__';

const DEFAULT_WS_PATH = '/ws';

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function readWebSocketPort(source: Document): number | null {
  const meta = source.querySelector(`meta[name="${WS_PORT_META}"]`);
  const raw = meta?.getAttribute('content')?.trim() ?? '';

  if (raw === '' || raw === WS_PORT_PLACEHOLDER) {
    return null;
  }

  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const port = Number(raw);
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

export interface WebSocketUrlOptions {
  readonly host: string;
  readonly protocol: string;
  readonly port: number | null;
  readonly path?: string;
}

function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const closing = host.indexOf(']');
    return closing < 0 ? host : host.slice(0, closing + 1);
  }

  const separator = host.indexOf(':');
  return separator < 0 ? host : host.slice(0, separator);
}

export function resolveWebSocketUrl(options: WebSocketUrlOptions): string {
  const { host, protocol, port } = options;
  const path = options.path ?? DEFAULT_WS_PATH;

  const scheme = protocol === 'https:' ? 'wss' : 'ws';

  if (port === null) {
    return `${scheme}://${host}${path}`;
  }

  const hostname = hostnameOf(host);
  return `${scheme}://${hostname}:${String(port)}${path}`;
}
