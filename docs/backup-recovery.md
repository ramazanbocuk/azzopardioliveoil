# Backup and recovery

Two independent layers. Use both.

## Layer 1 — the database host's own backups (primary)

On Neon, enable history retention (point-in-time recovery). To recover, create a branch at a moment just before the incident, check it, then point `DATABASE_URL` at it and redeploy. This is the fastest way back and loses the least data. **Not yet set up: no database account exists.**

## Layer 2 — logical backups you hold yourself

```bash
npm run db:backup
```

Writes `backups/azzopardi-<timestamp>.json.gz` containing every table. It needs no extra tools and takes a consistent snapshot while the shop is running.

- The file contains customers' personal data and password hashes. Keep it **encrypted**, outside the repository (the `backups/` folder is git-ignored), with access limited to the people who need it.
- Recommended: daily, kept for 30 days, stored with a different provider than the database. Deleting old backups is part of data-protection compliance: an erased customer remains in older backups until those expire, so state the retention period in the privacy policy.
- **Scheduling is not automated.** Run it from a machine or CI job you control, with `DATABASE_URL` set to production.

For very large databases, `pg_dump` is the better tool; this script loads each table into memory and suits a shop of this size.

## Restoring

1. Check out the code version that matches the backup, and create an empty database.
2. Apply the schema: `npm run db:deploy`.
3. Restore:

   ```bash
   npm run db:restore -- backups/azzopardi-<timestamp>.json.gz
   ```

   The script refuses if the database is not empty or its schema version differs from the backup's. To overwrite an existing database deliberately, add `--force`; this erases it first.
4. Order numbering continues after the highest restored order.
5. Check `/api/health`, sign in to the admin, and compare the latest orders with the payment provider's records: payments taken after the backup will be missing and must be re-entered or reconciled by hand.

## What is tested

The automated tests back up a populated database, wipe it, restore it and compare every record, including dates, arrays, JSON and unusual characters; they also check that numbering continues, that a non-empty database is refused, and that a schema mismatch is refused. The command-line script has been run once against the development database.

**Not tested:** restoring into Neon, restoring a large database, and the host's point-in-time recovery. Do one practice restore into a scratch database before launch, and repeat it every few months. A backup that has never been restored is not yet a backup.

## Not covered by any backup

Uploaded files (none exist yet) and secrets in the host's environment settings. Keep a separate, secure record of the environment variables.
