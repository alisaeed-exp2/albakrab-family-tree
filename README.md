# شجرة عائلة الباكراب

Arabic-only (RTL) family tree for the Al-Bakrab family. Built with Next.js (App Router), Prisma and PostgreSQL.

## Data model
- **Person**: `name`, `gender`, `fatherId`, `motherId`, `parentMarriageId`
- **Marriage**: `husbandId`, `wifeId`, `order` (a man can have several wives; a woman can have several husbands over time)
- Adding a child under a marriage sets the father and mother automatically. Parents can also be set manually; choosing both links the person to their marriage (created if missing).
- Generations, roots, and the nasab (محمد بن أحمد بن علي) are computed, never typed.

## Access
- Anyone with the link can view and search the tree.
- Only the admin can edit: `/login` with `ADMIN_PASSWORD`.

## Environment
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_PASSWORD` | Admin login password |
| `AUTH_SECRET` | Signs the admin session cookie |

## Scripts
- `npm run build` → `prisma generate && next build`
- `npm start` → `prisma db push` (applies the schema) then `next start`
