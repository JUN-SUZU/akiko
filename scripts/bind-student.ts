import { normalizedEmail, readBindings, writeBindings } from "./student-bindings.ts";
import { isStudentId } from "../src/lib/student-session.ts";

const [action, suppliedEmail, studentId] = process.argv.slice(2);
const usage = "Usage: npm run student:bind -- add EMAIL s1234567 | remove EMAIL | list";

if (action === "list" && !suppliedEmail && !studentId) {
  const bindings = await readBindings();
  for (const [email, id] of Object.entries(bindings).sort())
    console.log(`${email}\t${id}`);
} else if (action === "add" && suppliedEmail && studentId) {
  const email = normalizedEmail(suppliedEmail);
  if (!email || !isStudentId(studentId)) throw new Error(usage);
  const bindings = await readBindings();
  if (Object.entries(bindings).some(([otherEmail, id]) => otherEmail !== email && id === studentId))
    throw new Error("That student ID is already bound to another email");
  bindings[email] = studentId;
  await writeBindings(bindings);
  console.log(`Bound ${email} to ${studentId}`);
} else if (action === "remove" && suppliedEmail && !studentId) {
  const email = normalizedEmail(suppliedEmail);
  if (!email) throw new Error(usage);
  const bindings = await readBindings();
  if (!(email in bindings)) throw new Error("No binding for that email");
  delete bindings[email];
  await writeBindings(bindings);
  console.log(`Removed binding for ${email}`);
} else {
  throw new Error(usage);
}
