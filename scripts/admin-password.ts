/**
 * Sets a staff password from the command line, for when someone is locked out.
 *
 *   npm run admin:set-password
 *
 * Reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD from .env. The account must
 * already exist (create the first one with `npm run db:seed`). Signs that
 * person out everywhere and clears the sign-in attempt lock. Anyone who can
 * run this already has the database, so it grants nothing new.
 */
import "dotenv/config";
import { hashPassword } from "../src/server/crypto";
import { getPrisma } from "../src/server/db";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters) in .env first.");

  const db = getPrisma();
  const admin = await db.adminUser.findUnique({ where: { email } });
  if (!admin) throw new Error(`No staff account for ${email}. Run \`npm run db:seed\` to create the first administrator.`);

  await db.$transaction([
    // A lost phone is the other way to be locked out, so two-factor sign-in is cleared too and can be set up again.
    db.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(password), totpSecret: null, totpEnabledAt: null } }),
    db.adminSession.deleteMany({ where: { adminUserId: admin.id } }),
    db.rateLimit.deleteMany({ where: { key: { startsWith: "admin-login:" } } }),
    db.auditLog.create({ data: { actorType: "system", action: "admin.password.reset_cli", entity: "AdminUser", entityId: admin.id } }),
  ]);
  console.log(`Password updated for ${email}. Two-factor sign-in was cleared and existing sessions were signed out.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
