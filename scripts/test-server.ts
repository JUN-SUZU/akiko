import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import {
  localDataDefault,
  localDataToJson,
  localDataFromJson,
} from "../src/lib/local-data.ts";

const dir = await mkdtemp(join(tmpdir(), "akiko-test-"));
const port = 30000 + Math.floor(Math.random() * 20000);
const child = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/server.ts"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      BASE_PATH: "",
      DATA_DIR: dir,
      TLS_CERT: "",
      TLS_KEY: "",
      PUBLIC_ORIGIN: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
const timeout = setTimeout(() => child.kill(), 15000);
try {
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => {
      throw new Error("Server did not start");
    }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}/api/shared/coins_2023`;
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/2023/coins`)).status, 200);
  const studentUrl = `${origin}/api/students/s1234567/coins_2023`;
  const studentData = localDataToJson({ ...localDataDefault(), native: false });
  assert.deepEqual(
    localDataFromJson(
      ((await (await fetch(studentUrl)).json()) as { data: string }).data,
    ),
    localDataDefault(),
  );
  const studentSave = await fetch(studentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ data: studentData }),
  });
  assert.equal(studentSave.status, 200);
  const proxiedOrigin = `https://127.0.0.1:${port}`;
  assert.equal(
    (
      await fetch(studentUrl, {
        method: "POST",
        headers: { Origin: proxiedOrigin },
        body: JSON.stringify({ data: studentData }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(studentUrl, {
        method: "POST",
        headers: {
          Origin: "https://example.com",
          "X-Forwarded-Host": "example.com",
          "X-Forwarded-Proto": "https",
        },
        body: JSON.stringify({ data: studentData }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(studentUrl, {
        method: "POST",
        headers: { Origin: "null" },
        body: JSON.stringify({ data: studentData }),
      })
    ).status,
    403,
  );
  const studentRead = await fetch(studentUrl);
  assert.equal(studentRead.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    localDataFromJson(((await studentRead.json()) as { data: string }).data),
    localDataFromJson(studentData),
  );
  for (const url of [
    `${origin}/api/students/s7654321/coins_2023`,
    `${origin}/api/students/s1234567/math_2023`,
  ]) {
    assert.deepEqual(
      localDataFromJson(
        ((await (await fetch(url)).json()) as { data: string }).data,
      ),
      localDataDefault(),
    );
  }
  for (const id of ["1234567", "s123456", "s12345678", "S1234567"]) {
    assert.equal(
      (await fetch(`${origin}/api/students/${id}/coins_2023`)).status,
      400,
    );
  }
  assert.equal(
    (
      await fetch(studentUrl, {
        method: "POST",
        body: JSON.stringify({ data: "invalid" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(studentUrl, { method: "POST", body: "bad JSON" })).status,
    400,
  );
  assert.equal(
    (
      await fetch(studentUrl, {
        method: "POST",
        headers: { Origin: "https://example.com" },
        body: JSON.stringify({ data: studentData }),
      })
    ).status,
    403,
  );
  assert.equal((await fetch(url)).status, 401);
  const data = localDataToJson(localDataDefault());
  const save = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ data }),
  });
  assert.equal(save.status, 200);
  const { key } = (await save.json()) as { key: string };
  assert.match(key, /^[a-f0-9]{64}$/);
  const cookie = save.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const read = await fetch(url, { headers: { Cookie: cookie.split(";")[0] } });
  assert.equal(read.status, 200);
  assert.deepEqual(
    localDataFromJson(((await read.json()) as { data: string }).data),
    localDataDefault(),
  );
  assert.equal(
    (
      await fetch(`${origin}/api/shared/math_2023`, {
        headers: { "X-Sharing-Key": key },
      })
    ).status,
    404,
  );
  const update = await fetch(url, {
    method: "POST",
    headers: { Cookie: cookie.split(";")[0] },
    body: JSON.stringify({
      data: localDataToJson({ ...localDataDefault(), native: false }),
    }),
  });
  assert.equal(update.status, 200);
  const updated = await fetch(url, { headers: { "X-Sharing-Key": key } });
  assert.equal(
    localDataFromJson(((await updated.json()) as { data: string }).data)
      ?.native,
    false,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { Origin: "https://example.com" },
        body: JSON.stringify({ data }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        body: JSON.stringify({ data: "invalid" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        body: JSON.stringify({ data, key: "invalid" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        body: JSON.stringify({ data, key: "a".repeat(64) }),
      })
    ).status,
    404,
  );
  const disconnected = await fetch(url, {
    method: "DELETE",
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(disconnected.status, 200);
  assert.match(disconnected.headers.get("set-cookie") ?? "", /Max-Age=0/);
  const publicOrigin = "https://akiko.xn--estu0hy29d.net";
  const configuredPort = port + 1;
  const configured = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/server.ts"],
    {
      env: {
        ...process.env,
        PORT: String(configuredPort),
        HOST: "127.0.0.1",
        BASE_PATH: "",
        DATA_DIR: dir,
        TLS_CERT: "",
        TLS_KEY: "",
        PUBLIC_ORIGIN: publicOrigin,
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  try {
    await Promise.race([
      once(configured.stdout, "data"),
      once(configured, "exit").then(() => {
        throw new Error("Configured server did not start");
      }),
    ]);
    const internalOrigin = `http://127.0.0.1:${configuredPort}`;
    const configuredUrl = `${internalOrigin}/api/students/s1234567/coins_2023`;
    assert.equal(
      (
        await fetch(configuredUrl, {
          method: "POST",
          headers: { Origin: publicOrigin },
          body: JSON.stringify({ data: studentData }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(configuredUrl, {
          method: "POST",
          headers: { Origin: internalOrigin },
          body: JSON.stringify({ data: studentData }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(configuredUrl, {
          method: "POST",
          headers: { Origin: "https://example.com" },
          body: JSON.stringify({ data: studentData }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${internalOrigin}/api/shared/math_2023`, {
          method: "POST",
          headers: { Origin: publicOrigin },
          body: JSON.stringify({ data }),
        })
      ).status,
      200,
    );
  } finally {
    if (configured.exitCode === null && configured.signalCode === null) {
      const exited = once(configured, "exit");
      configured.kill();
      await exited;
    }
  }
  console.log(
    "Shared API, persistence, cookies, validation and origin checks: ok",
  );
} finally {
  clearTimeout(timeout);
  const exited = once(child, "exit");
  child.kill();
  await exited;
  await rm(dir, { recursive: true, force: true });
}
