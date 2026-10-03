# Global Advice Wall Setup

The advice page stores shared notes through the Vercel function at `/api/advice`. MongoDB Atlas stores the notes; the browser never receives the database connection string. The API creates its collection and indexes automatically.

## Configure MongoDB Atlas

1. Create an Atlas cluster and a database user with `readWrite` access to the `raccoontips` database.
2. Configure Atlas Network Access for your Vercel deployment. Vercel egress IPs may vary by plan and deployment; if you allow connections from all IPs, use a strong unique database password and keep the database user restricted to this app database.
3. Copy the cluster connection string and replace its database-user placeholders.

## Configure Vercel

Add these environment variables in the Vercel project settings for each environment you use:

- `MONGODB_URI`: the Atlas connection string. Treat this as a secret.
- `MONGODB_DB`: `raccoontips` (optional; this is the default database name).
- `ADVICE_ADMIN_PASSWORD`: a strong, unique password required to delete a shared note.

Redeploy after setting the variables. Then visit `/api/advice`; a configured service returns JSON with a `notes` array.

For local Vercel development, copy `.env.example` to `.env.local`, fill in the values locally, and run `npx vercel dev`. Never commit `.env.local` or put either password in frontend code.

## Note behavior

- Submissions are public and shared across visitors. The API validates note text, author length, date, and allowed colors, and limits each IP to 10 submissions per minute.
- Deletion prompts for `ADVICE_ADMIN_PASSWORD`; the server verifies it before deleting a note globally.
- On first load after deployment, notes from the browser's previous `localStorage` wall are migrated to MongoDB. Stable migration IDs make retries safe; the old local copy is removed only after every note migrates successfully.
- The page shows an unavailable message if MongoDB environment variables or the database connection are not configured.