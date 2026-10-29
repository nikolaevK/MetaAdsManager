import { parseArgs } from "node:util";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { ROLES, users, type Role } from "@/lib/db/schema";

/** npm run user:create -- --email a@b.com --name "Jane" --role admin   (password read from USER_PASSWORD) */
const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "buyer" } },
});
const password = process.env.USER_PASSWORD;
const email = values.email?.trim().toLowerCase();
const role = values.role as Role;

if (!email || !values.name || !password || !ROLES.includes(role)) {
  console.error('Usage: USER_PASSWORD=… npm run user:create -- --email a@b.com --name "Jane" --role admin|buyer|viewer');
  process.exit(1);
}
if (password.length < PASSWORD_MIN_LENGTH) {
  console.error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  process.exit(1);
}
await db().insert(users).values({ email, name: values.name, role, passwordHash: await hashPassword(password) });
console.log(`Created ${role} ${email}`);
