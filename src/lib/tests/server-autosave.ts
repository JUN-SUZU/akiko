import assert from "node:assert/strict";
import { ServerAutosave } from "../server-autosave";
import {
  isStudentId,
  studentIdFromCookies,
  studentIdCookie,
} from "../student-session";

assert.ok(isStudentId("s1234567"));
assert.equal(
  studentIdFromCookies("other=value; akiko_student_id=s1234567"),
  "s1234567",
);
assert.equal(studentIdFromCookies("akiko_student_id=invalid"), undefined);
assert.equal(studentIdFromCookies("akiko_student_id=%XX"), undefined);
assert.equal(studentIdFromCookies(""), undefined);
assert.match(
  studentIdCookie("s1234567", "/akiko", true),
  /Path=\/akiko; Max-Age=31536000; SameSite=Lax; Secure$/,
);
assert.throws(() => studentIdCookie("invalid", "", false));
for (const id of [
  "",
  "1234567",
  "s123456",
  "s12345678",
  "S1234567",
  "s１２３４５６７",
  "s1234567/../other",
]) {
  assert.equal(isStudentId(id), false);
}

let releaseFirst!: () => void;
const firstRequest = new Promise<void>((resolve) => {
  releaseFirst = resolve;
});
const writes: string[] = [];
const saver = new ServerAutosave(
  async (json) => {
    writes.push(json);
    if (json === "first") await firstRequest;
  },
  () => {},
  "initial",
);
saver.enqueue("initial");
assert.equal(writes.length, 0);
saver.enqueue("first");
saver.enqueue("second");
saver.enqueue("latest");
assert.deepEqual(writes, ["first"]);
assert.ok(saver.hasUnsavedData);
releaseFirst();
await saver.flush();
assert.deepEqual(writes, ["first", "latest"]);
assert.equal(saver.hasUnsavedData, false);
saver.enqueue("latest");
assert.equal(writes.length, 2);
saver.stopRetries();

const retried: string[] = [];
const retrySaver = new ServerAutosave(
  (json) => {
    retried.push(json);
    if (retried.length === 1) return Promise.reject(new Error("Offline"));
    return Promise.resolve();
  },
  () => {},
  "initial",
  10,
);
retrySaver.enqueue("failed");
await assert.rejects(retrySaver.flush());
assert.ok(retrySaver.hasUnsavedData);
retrySaver.enqueue("newest");
await retrySaver.flush();
assert.deepEqual(retried, ["failed", "newest"]);
assert.equal(retrySaver.hasUnsavedData, false);
retrySaver.stopRetries();

let retryComplete!: () => void;
const completed = new Promise<void>((resolve) => {
  retryComplete = resolve;
});
let attempts = 0;
const automaticRetry = new ServerAutosave(
  () => {
    if (++attempts === 1) return Promise.reject(new Error("Offline"));
    return Promise.resolve();
  },
  (status) => {
    if (status === "saved") retryComplete();
  },
  "initial",
  10,
);
automaticRetry.enqueue("pending");
await completed;
await automaticRetry.flush();
assert.equal(attempts, 2);
assert.equal(automaticRetry.hasUnsavedData, false);
automaticRetry.stopRetries();
console.log(import.meta.filename, "ok");
