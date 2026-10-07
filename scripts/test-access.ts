import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { localDataDefault, localDataToJson } from "../src/lib/local-data.ts";

const dir = await mkdtemp(join(tmpdir(), "akiko-access-test-"));
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
const certs = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ keys: [jwk] }));
});
certs.listen(0, "127.0.0.1");
await once(certs, "listening");
const certAddress = certs.address();
if (!certAddress || typeof certAddress === "string") throw new Error("No cert server address");
const issuer = `http://127.0.0.1:${certAddress.port}`;
const port = 30000 + Math.floor(Math.random() * 20000);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  AUTH_MODE: "access",
  CF_ACCESS_TEAM_DOMAIN: issuer,
  CF_ACCESS_AUD: "akiko-test-audience",
  HOST: "127.0.0.1",
  PORT: String(port),
  DATA_DIR: dir,
  BASE_PATH: "",
  PUBLIC_ORIGIN: origin,
  TLS_CERT: "",
  TLS_KEY: "",
};
const child = spawn(process.execPath, ["--import", "tsx", "scripts/server.ts"], {
  env,
  stdio: ["ignore", "pipe", "inherit"],
});

function bind(...args: string[]) {
  return execFileSync(process.execPath, ["--import", "tsx", "scripts/bind-student.ts", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function token(email: string, options: { aud?: string; expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email, type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(options.aud ?? "akiko-test-audience")
    .setIssuedAt(now - 60)
    .setNotBefore(now - 60)
    .setExpirationTime(options.expired ? now - 1 : now + 300)
    .sign(privateKey);
}
async function request(path: string, jwt?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jwt) headers.set("Cf-Access-Jwt-Assertion", jwt);
  return fetch(`${origin}${path}`, { ...init, headers });
}

try {
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => { throw new Error("Server did not start"); }),
  ]);
  const email = "student@example.edu";
  const jwt = await token(email);
  const otherJwt = await token("other@example.edu");
  const studentPath = "/api/students/s1234567/coins_2023";
  assert.equal((await request("/api/session")).status, 401);
  assert.equal((await request("/api/shared/coins_2023")).status, 401);
  assert.equal((await request("/api/session", await token(email, { expired: true }))).status, 401);
  assert.equal((await request("/api/session", await token(email, { aud: "wrong" }))).status, 401);
  assert.equal((await request("/api/session", jwt)).status, 200);
  assert.equal((await request(studentPath, jwt)).status, 403);
  assert.equal((await request(studentPath, otherJwt, { headers: { "Cf-Access-Authenticated-User-Email": email } })).status, 403);

  bind("add", email.toUpperCase(), "s1234567");
  assert.equal((await request(studentPath, jwt)).status, 200);
  assert.equal((await request("/api/students/s7654321/coins_2023", jwt)).status, 403);
  assert.equal((await request(studentPath, otherJwt)).status, 403);
  const session = await request("/api/session", jwt, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: "s1234567" }),
  });
  assert.equal(session.status, 200);
  assert.equal((await request("/api/session", jwt, {
    method: "POST", headers: { Origin: origin }, body: JSON.stringify({ studentId: "s7654321" }),
  })).status, 403);
  const saved = await request(studentPath, jwt, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ data: localDataToJson(localDataDefault()) }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await stat(join(dir, "student-bindings.json"))).mode & 0o077, 0);
  const bindings = JSON.parse(await readFile(join(dir, "student-bindings.json"), "utf8")) as Record<string, string>;
  assert.equal(bindings[email], "s1234567");
  assert.throws(() => bind("add", "other@example.edu", "s1234567"));

  bind("add", email, "s7654321");
  assert.equal((await request(studentPath, jwt)).status, 403);
  assert.equal((await request("/api/students/s7654321/coins_2023", jwt)).status, 200);
  bind("remove", email);
  assert.equal((await request("/api/students/s7654321/coins_2023", jwt)).status, 403);
  console.log("Access JWT, student binding and live updates: ok");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
  }
  certs.close();
  await rm(dir, { recursive: true, force: true });
}
