import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isStudentId } from "../src/lib/student-session.ts";

export const dataDir = resolve(process.env.DATA_DIR ?? "data");
const file = resolve(dataDir, "student-bindings.json");

export function normalizedEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function readBindings(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid student bindings file");
  const bindings = Object.create(null) as Record<string, string>;
  const used = new Set<string>();
  for (const [email, id] of Object.entries(parsed as Record<string, unknown>)) {
    if (normalizedEmail(email) !== email || !isStudentId(id) || used.has(id))
      throw new Error("Invalid or duplicate student binding");
    bindings[email] = id;
    used.add(id);
  }
  return bindings;
}

export async function writeBindings(bindings: Record<string, string>): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(bindings, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, file);
}
