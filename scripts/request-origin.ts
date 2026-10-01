import type { IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";

export function requestOriginAllowed(
  req: IncomingMessage,
  publicOrigin?: string,
): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== origin
    )
      return false;
    if (publicOrigin) return origin === new URL(publicOrigin).origin;
    if (!req.headers.host) return false;
    // TLS may terminate at a reverse proxy. Match the public authority without
    // trusting client-supplied forwarding headers or TLS_CERT environment state.
    if (
      req.socket instanceof TLSSocket &&
      req.socket.encrypted &&
      parsed.protocol !== "https:"
    )
      return false;
    return origin === new URL(`${parsed.protocol}//${req.headers.host}`).origin;
  } catch {
    return false;
  }
}
