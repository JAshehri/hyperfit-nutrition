# Render deployment

The repository contains a Render Blueprint in `render.yaml` with two services:

- `hyperfit-nutrition-web-jashehri`: free static Next.js export.
- `hyperfit-nutrition-api-jashehri`: FastAPI service with a persistent SQLite disk.

Before applying the Blueprint, set `HYPERFIT_ADMIN_PASSWORD` to a unique password of at
least 12 characters containing uppercase, lowercase, a number, and a symbol. Render keeps
this value as a secret and it is never committed to GitHub.

The API uses a paid Starter instance because Render does not support persistent disks on
free web services. A free API instance would lose the SQLite database whenever it sleeps,
restarts, or redeploys.

After the first login, the administrator must change the temporary password. Later API
restarts do not reset the administrator password because the environment bootstrap only
creates the account when it does not already exist.
