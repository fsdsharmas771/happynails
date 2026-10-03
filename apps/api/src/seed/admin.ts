import { hashPassword } from "../admin/auth";
import { AdminUser } from "../models/Admin";

/** Creates the first owner from env if there is no owner yet. Never changes an existing account. */
export async function seedOwner(email: string | undefined, password: string | undefined): Promise<string> {
  if (await AdminUser.exists({ role: "owner" })) return "owner already exists";
  if (!email || !password) return "no owner: set ADMIN_OWNER_EMAIL and ADMIN_OWNER_PASSWORD to create one";
  await AdminUser.create({ email, name: "Owner", role: "owner", passwordHash: await hashPassword(password) });
  return `owner created: ${email}`;
}
