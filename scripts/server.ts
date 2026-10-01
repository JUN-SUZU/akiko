import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { localDataFromJson, localDataToJson } from "../src/lib/local-data.ts";
import { localDataDefault } from "../src/lib/local-data.ts";
import { isStudentId } from "../src/lib/student-session.ts";
import { requestOriginAllowed } from "./request-origin.ts";

const root = resolve("build");
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const base = process.env.BASE_PATH ?? "";
const publicOrigin = process.env.PUBLIC_ORIGIN;
if (publicOrigin) {
  const url = new URL(publicOrigin);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN must be an HTTP(S) origin without a path, credentials, query or fragment",
    );
}
const keyPattern = /^[a-f0-9]{64}$/;
const scopePattern = /^[a-z0-9-]+_20\d{2}$/;
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};

function cookieName(scope: string) {
  return `akiko_share_${scope}`;
}
function setCookie(res: ServerResponse, scope: string, key: string) {
  res.setHeader(
    "Set-Cookie",
    `${cookieName(scope)}=${key}; Path=${base || "/"}; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`,
  );
}
function dataPath(scope: string, key: string) {
  return resolve(
    dataDir,
    `${scope}-${createHash("sha256").update(key).digest("hex")}.json`,
  );
}
function respond(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function handle(req: IncomingMessage, res: ServerResponse) {
  const pathname = decodeURIComponent(
    new URL(req.url ?? "/", "http://localhost").pathname,
  );
  if (base && pathname !== base && !pathname.startsWith(`${base}/`))
    return respond(res, 404, { error: "Not found" });
  const route = pathname.slice(base.length) || "/";
  if (route.startsWith("/api/students/")) {
    const parts = route.slice("/api/students/".length).split("/");
    const [studentId, scope] = parts;
    if (
      parts.length !== 2 ||
      !isStudentId(studentId) ||
      !scopePattern.test(scope)
    )
      return respond(res, 400, { error: "Invalid student ID or scope" });
    if (req.method !== "GET" && req.method !== "POST")
      return respond(res, 405, { error: "Method not allowed" });
    if (!requestOriginAllowed(req, publicOrigin))
      return respond(res, 403, { error: "Invalid origin" });
    const file = resolve(
      dataDir,
      `student-${createHash("sha256").update(studentId).digest("hex")}-${scope}.json`,
    );
    if (req.method === "GET") {
      try {
        return respond(res, 200, { data: await readFile(file, "utf8") });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return respond(res, 200, { data: localDataToJson(localDataDefault()) });
      }
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > 2 * 1024 * 1024)
        return respond(res, 413, { error: "Too large" });
      chunks.push(buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return respond(res, 400, { error: "Invalid JSON" });
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("data" in body) ||
      typeof body.data !== "string"
    )
      return respond(res, 400, { error: "Invalid data" });
    const parsed = localDataFromJson(body.data);
    if (!parsed) return respond(res, 400, { error: "Invalid data" });
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, localDataToJson(parsed), { mode: 0o600 });
    await rename(temporary, file);
    return respond(res, 200, { saved: true });
  }
  if (route.startsWith("/api/shared/")) {
    const scope = route.slice("/api/shared/".length);
    if (!scopePattern.test(scope))
      return respond(res, 400, { error: "Invalid scope" });
    if (
      req.method !== "GET" &&
      req.method !== "POST" &&
      req.method !== "DELETE"
    )
      return respond(res, 405, { error: "Method not allowed" });
    if (!requestOriginAllowed(req, publicOrigin))
      return respond(res, 403, { error: "Invalid origin" });
    if (req.method === "DELETE") {
      res.setHeader(
        "Set-Cookie",
        `${cookieName(scope)}=; Path=${base || "/"}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      );
      return respond(res, 200, { disconnected: true });
    }
    const cookieKey = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName(scope)}=`))
      ?.split("=")[1];
    const headerKey = req.headers["x-sharing-key"];
    let key = typeof headerKey === "string" ? headerKey : cookieKey;
    if (req.method === "GET") {
      if (!key || !keyPattern.test(key))
        return respond(res, 401, { error: "Key required" });
      let data: string;
      try {
        data = await readFile(dataPath(scope, key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return respond(res, 404, { error: "Not found" });
        throw error;
      }
      setCookie(res, scope, key);
      return respond(res, 200, { data });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > 2 * 1024 * 1024)
        return respond(res, 413, { error: "Too large" });
      chunks.push(buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return respond(res, 400, { error: "Invalid JSON" });
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("data" in body) ||
      typeof body.data !== "string"
    )
      return respond(res, 400, { error: "Invalid data" });
    const parsed = localDataFromJson(body.data);
    if (!parsed) return respond(res, 400, { error: "Invalid data" });
    const suppliedKey = "key" in body ? body.key : undefined;
    if (suppliedKey !== undefined) {
      if (typeof suppliedKey !== "string" || !keyPattern.test(suppliedKey))
        return respond(res, 400, { error: "Invalid key" });
      key = suppliedKey;
    }
    if (key && !keyPattern.test(key))
      return respond(res, 400, { error: "Invalid key" });
    // An existing key must refer to an existing share. A typo must not create a new share.
    if (key) {
      try {
        await stat(dataPath(scope, key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return respond(res, 404, { error: "Not found" });
        throw error;
      }
    } else key = randomBytes(32).toString("hex");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const file = dataPath(scope, key);
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, localDataToJson(parsed), { mode: 0o600 });
    await rename(temporary, file);
    setCookie(res, scope, key);
    return respond(res, 200, { key });
  }
  if (req.method !== "GET" && req.method !== "HEAD")
    return respond(res, 405, { error: "Method not allowed" });
  let file = resolve(root, `.${route}`);
  if (!file.startsWith(root + sep) && file !== root)
    return respond(res, 403, { error: "Forbidden" });
  try {
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      file += ".html";
    }
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const content = await readFile(resolve(root, "404.html"));
    res.writeHead(404, { "Content-Type": mime[".html"] });
    res.end(req.method === "HEAD" ? undefined : content);
  }
}

const listener = (req: IncomingMessage, res: ServerResponse) => {
  void handle(req, res).catch((error: unknown) => {
    console.error("Request failed", error);
    if (!res.headersSent) respond(res, 500, { error: "Server error" });
    else res.end();
  });
};
const server =
  process.env.TLS_CERT && process.env.TLS_KEY
    ? createHttpsServer(
        {
          cert: await readFile(process.env.TLS_CERT),
          key: await readFile(process.env.TLS_KEY),
        },
        listener,
      )
    : createServer(listener);
server.listen(
  Number(process.env.PORT ?? 3000),
  process.env.HOST ?? "0.0.0.0",
  () => {
    console.log(
      `あきこ: ${process.env.TLS_CERT ? "https" : "http"}://${process.env.HOST ?? "localhost"}:${process.env.PORT ?? 3000}${base}/`,
    );
  },
);
