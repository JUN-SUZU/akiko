export const STUDENT_SESSION = Symbol("student-session");

export type StudentSession = { readonly studentId: string };

export function isStudentId(value: unknown): value is string {
  return typeof value === "string" && /^s[0-9]{7}$/.test(value);
}

export function studentIdFromCookies(cookies: string): string | undefined {
  const value = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("akiko_student_id="))
    ?.slice("akiko_student_id=".length);
  if (!value) return undefined;
  try {
    const id = decodeURIComponent(value);
    return isStudentId(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function studentIdCookie(
  id: string,
  base: string,
  secure: boolean,
): string {
  if (!isStudentId(id)) throw new Error("Invalid student ID");
  return `akiko_student_id=${id}; Path=${base || "/"}; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
