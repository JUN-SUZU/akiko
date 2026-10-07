import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { normalizedEmail } from "./student-bindings.ts";

export type AccessIdentity = { mode: "access"; email: string } | { mode: "local" };

const mode = process.env.AUTH_MODE ?? "access";
const host = process.env.HOST ?? "0.0.0.0";
if (mode !== "access" && mode !== "local") throw new Error("Invalid AUTH_MODE");
if (mode === "local" && host !== "127.0.0.1" && host !== "::1" && host !== "localhost")
  throw new Error("Local authentication mode requires a loopback HOST");
if (mode === "local" && process.env.PUBLIC_ORIGIN && process.env.NODE_ENV !== "test")
  throw new Error(
    "AUTH_MODE=local and PUBLIC_ORIGIN are both set. For Cloudflare Access, use AUTH_MODE=access with CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD. For loopback-only local use, unset PUBLIC_ORIGIN.",
  );

const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
const audience = process.env.CF_ACCESS_AUD;
if (mode === "access" && (!teamDomain || !audience))
  throw new Error("CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required");

let verify: ((token: string) => Promise<string | null>) | undefined;
if (mode === "access") {
  const issuer = new URL(teamDomain!);
  if (
    (issuer.protocol !== "https:" && !(process.env.NODE_ENV === "test" && issuer.protocol === "http:")) ||
    issuer.pathname !== "/" || issuer.search || issuer.hash || issuer.username || issuer.password
  ) throw new Error("CF_ACCESS_TEAM_DOMAIN must be an HTTPS origin");
  const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  verify = async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: issuer.origin,
        audience,
        algorithms: ["RS256"],
      });
      if (payload.type !== "app" || typeof payload.email !== "string") return null;
      return normalizedEmail(payload.email);
    } catch {
      return null;
    }
  };
}

export async function accessIdentity(req: IncomingMessage): Promise<AccessIdentity | null> {
  if (mode === "local") return { mode: "local" };
  const token = req.headers["cf-access-jwt-assertion"];
  if (typeof token !== "string" || !token) return null;
  const email = await verify!(token);
  return email ? { mode: "access", email } : null;
}
