# Deploying BCX

Two routes. Pick one.

- **[Free: Render + Neon](#free-render--neon)** — genuinely $0, no card. Right choice
  for a 10-20 team event. The server sleeps after 15 minutes of no traffic and
  takes about 50 seconds to wake, which does not matter once people are trading.
- **[Paid: Railway](#paid-railway)** — about $5/month, no sleeping, one dashboard
  instead of two. Worth it only if you are running for 100+ teams or want the
  extra headroom.

Both use the same code and the same `npm run deploy` start command. Switching
later means changing where `DATABASE_URL` points, nothing else.

---

# Free: Render + Neon

The database and the app live on two different services, because Render's free
Postgres is **deleted after 30 days** whereas Neon's free tier does not expire.

## 1. Create the database (Neon)

1. Go to **neon.tech** → sign in with GitHub → **Create project**.
2. Name it `mockstock`, pick the region closest to you, create.
3. On the dashboard, copy the **connection string**. It looks like
   `postgresql://user:pass@ep-something.aws.neon.tech/neondb?sslmode=require`.

Keep that tab open, you need the string in a moment.

## 2. Create the web service (Render)

1. Go to **render.com** → **Get Started** → sign in with GitHub.
2. **New → Web Service** → connect your GitHub → pick **mockstock**.
   Since the repo is private you may have to click **Configure account** and
   grant Render access to it specifically.
3. Render reads `render.yaml` from the repo, so build and start commands fill
   themselves in. Confirm they say:
   - Build: `npm install && npm run build`
   - Start: `npm run deploy`
4. Instance type: **Free**.

## 3. Set the environment variables

Before the first deploy, add these under **Environment**:

```
DATABASE_URL=<paste your Neon connection string here>
SESSION_SECRET=eca924f3c98ceb52c34d75c95f893fcf70cae581b5d00b1025bf59d6f032d2fc
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE-THIS-TO-SOMETHING-REAL
```

`TICKER_ENABLED` and `SEED_DEMO` come from `render.yaml` automatically.

**Change `ADMIN_PASSWORD` before deploying.** This is your admin login on a
public URL. Minimum 8 characters — the app refuses to start otherwise.

**Do not share `SESSION_SECRET`.** It signs every login cookie.

## 4. Deploy and watch the log

Click **Create Web Service**. First build takes 3-5 minutes.

In the logs you want to see:

```
[deploy-init] applying migrations...
[deploy-init] applying constraints...
[deploy-init] created admin "admin"
[deploy-init] seeded the demo competition
[deploy-init] ready
✓ Ready in ...
```

Render then shows your URL at the top: `https://mockstock-xxxx.onrender.com`.
That is the link you send your team.

## 5. Know about the sleep

On the free tier Render stops the server after **15 minutes with no requests**,
and the next visitor waits ~50 seconds while it wakes.

In practice:

- Open the link yourself 2 minutes before the event so it is warm.
- Once teams are trading it never idles, so it never sleeps.
- If the market is open and everyone walks away for 15 minutes, the ticker stops
  with it. On wake it replays the missed ticks (capped at 20 minutes' worth), so
  nothing is lost, but prices will jump rather than move. Pause the market if you
  are taking a long break.

---

# Paid: Railway

A public URL like `https://mockstock-production.up.railway.app`, no sleeping,
app and database in one dashboard. About $5/month — Railway no longer has a
free tier, only a one-off trial credit that runs out in a few days of uptime.

---

## 1. Put the code on GitHub

(Already done if you followed the free route — skip to step 2.)

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
