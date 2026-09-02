# Deploying MockStock to Railway

End result: a public URL like `https://mockstock-production.up.railway.app` that
your team opens on their phones. Your laptop can be off.

About 15 minutes, most of it waiting on builds. Free tier is enough for a demo;
Railway's free credit runs out with continuous uptime, so for a real event
budget the ~$5/month Hobby plan.

---

## 1. Put the code on GitHub

You need a GitHub account (github.com, free).

Create a **new empty repository** — call it `mockstock`. Do not add a README,
.gitignore or licence; the repo already has them.

Then, from `C:\Users\aadit\Downloads\mockstock`:

```bash
git remote add origin https://github.com/YOUR-USERNAME/mockstock.git
```

```bash
git branch -M main && git push -u origin main
```

Git will ask you to sign in to GitHub the first time — a browser window opens.

**Make the repo private** unless you want other colleges reading your event
design. Railway deploys private repos fine.

---

## 2. Create the Railway project

1. Go to **railway.app** and sign in with GitHub.
2. **New Project → Deploy from GitHub repo → mockstock.**
   Authorise Railway to see the repo when asked.
3. The first build will start and **it will fail.** That is expected — there is
   no database yet. Carry on.

---

## 3. Add the database

In the same project: **New → Database → Add PostgreSQL.**

Railway creates it in a few seconds and wires up an internal connection string.

---

## 4. Set the variables

Click your **mockstock service** (not the database) → **Variables** → and add
these five. Use **Raw Editor** and paste the block in one go:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=19f1cd0f883a14aaabb56af9cd5d180c36b19d0bdf814c07107c8acf6666a6b9
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE-THIS-TO-SOMETHING-REAL
TICKER_ENABLED=true
SEED_DEMO=true
```

Three things about that block:

- `${{Postgres.DATABASE_URL}}` is literal — type it exactly. Railway substitutes
  the real connection string and keeps it in sync if the database moves.
- **`SESSION_SECRET` is a real secret I generated for this deploy.** It signs
  every login cookie. Do not commit it, do not paste it in WhatsApp.
- **Change `ADMIN_PASSWORD` before you deploy.** It becomes your admin login and
  the app will be on the public internet. Minimum 8 characters; the app refuses
  to start otherwise.

`SEED_DEMO=true` populates the 20-stock, 10-team demo so the app is usable the
moment it comes up. It only ever runs when there are no competitions at all, so
it cannot overwrite a real event — but delete the variable once you have your
own data in, to be safe.

---

## 5. Generate the public URL

**Settings → Networking → Generate Domain.**

Railway gives you `something.up.railway.app`. That is the link you send your team.

Redeploy if it hasn't already (**Deployments → Redeploy**). Watch the logs — you
are looking for:

```
[deploy-init] applying migrations...
[deploy-init] created admin "admin"
[deploy-init] seeded the demo competition
[deploy-init] ready
```

Then `Ready in …` from Next.js. That means you are live.

---

## 6. What to send your team

Send them the URL and their join code. Nothing else — **do not send the admin
password to the group.**

> MockStock is live: https://YOUR-APP.up.railway.app
> Your team's join code is **3HV3DU**.
> Open the link, enter the code, and pick a password — whatever you type the
> first time becomes your team's password, so agree on it between you.
> Trading opens at 5pm.

Get the real join codes from **Admin → Teams → Copy all**.

You sign in separately at `/admin/login`.

---

## 7. Before the actual event

- Delete `SEED_DEMO` from the variables.
- **Settings** — set your real starting cash, brokerage, spread, tick interval.
- **Stocks** — import your own universe, and read RUNBOOK section 1 on sizing
  `liquidity` for your team count. The demo assumes 10 teams; 300 teams needs a
  roughly 30x larger figure or the first stampede trips a circuit breaker.
- **Teams** — import your real teams, then **Copy all** for the join codes.
- Keep **replicas at 1** (Settings → Deploy). The app runs one price ticker per
  process and assumes a single instance.
- Do a dry run. RUNBOOK section 3.

---

## Troubleshooting

**Build fails with a database error.** You added the variables before the
Postgres plugin existed. Add the plugin, then redeploy.

**"DATABASE_URL is not set".** The variable is missing or you typed
`${{Postgres.DATABASE_URL}}` into the *database* service instead of the app.

**"No admin exists and ADMIN_USERNAME / ADMIN_PASSWORD are not set".** Add both
variables and redeploy.

**App loads but prices never move.** You have not pressed **Open market** in the
admin console. Nothing ticks until you do.

**Deploy succeeds but the URL 502s.** Check Settings → Networking has a domain,
and that the deploy logs show `Ready in …`. If the log stops at `[deploy-init]`,
the database is unreachable — check `DATABASE_URL`.

**Everyone gets logged out after a deploy.** You changed `SESSION_SECRET`. Set it
once and leave it alone.
