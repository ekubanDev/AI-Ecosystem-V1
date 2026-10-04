# Deploying to one server

This sets up the whole app on a single small Linux server with Docker Compose. Nothing is deployed by merging this: you run these steps yourself, on a server you choose.

**What you get:** HTTPS with automatic certificates (Caddy), the web app and `/api` on one origin, the API, a separate task worker, MongoDB (not reachable from the internet), and a daily database dump.

**What you do not get yet:** monitoring or alerts, off-server backups (a script is described below, but you must set it up), automatic deletion of old leads, zero-downtime deploys, or multiple servers.

> **Status:** rehearsed locally on Docker Desktop (macOS, Docker 24, `APP_DOMAIN=localhost`): all images build, every service starts healthy, HTTPS and the HTTP→HTTPS redirect work, the app loads and logs in over HTTPS with `Secure; HttpOnly` cookies, registration is closed, the separate worker claims tasks, unique indexes are created, MongoDB is not published, and a backup restores correctly. **Not yet exercised on a real server:** public DNS, Let's Encrypt certificates for a real domain, and the firewall. Rehearse first (step 1), then deploy.

## 0. Before the app is public

A public page that collects names and emails is a legal and trust matter, not only a technical one. Decide these before you share a link:

1. **Privacy notice.** The app serves a plain-language notice at `/privacy` and links it beside the consent box. It describes what the system *actually* does today (what is collected, cookie-free view counts, no IP stored, no automatic deletion, the visitor's rights). It is a **template, not legal advice**: have it reviewed, and change it whenever the system changes (cookies, analytics, retention). Set `PRIVACY_OPERATOR_NAME` and `PRIVACY_CONTACT_EMAIL` in `backend/.env.production`: they name who is responsible, the config check requires them, and in production a landing page cannot be published without them. The consent wording itself is in `backend/services/landingService.js` (`consentTextFor`).
2. **Registration with the regulator.** Ghana's Data Protection Act, 2012 (Act 843) generally expects organisations that process personal data to register with the Data Protection Commission. I am not a lawyer: confirm what applies to you before collecting data from real people.
3. **Deleting data on request.** The Leads tab has a delete button that really removes a person's details, and the notice tells visitors to email the contact address. Decide who answers those emails and how quickly. Nothing deletes leads automatically, and the notice says so: if you want a retention period, that needs building first.
4. **Say only what is true.** The page copy is yours. Do not promise listings, verification or prices you cannot deliver yet.

## 1. Rehearse locally (free, 10 minutes)

On your own machine with Docker Desktop running:

```bash
cp docker/prod.env.example docker/.env
cp backend/production.env.example backend/.env.production
```

Edit `docker/.env`: set `APP_DOMAIN=localhost` and `MONGO_PASSWORD=$(openssl rand -hex 24)`.
Edit `backend/.env.production`: set `CLIENT_URL=https://localhost`, two different `JWT_*` secrets (`openssl rand -hex 48`), and leave `REGISTRATION_ENABLED=false`.

```bash
node scripts/check-prod.mjs                      # must say "Config OK" (warnings about missing keys are fine here)
docker compose -f docker/docker-compose.prod.yml up -d --build
docker compose -f docker/docker-compose.prod.yml ps
```

Docker Desktop must be running (`open -a Docker`). The first build takes a few minutes. Open `https://localhost` (your browser warns about the certificate: Caddy made it for localhost; accept it for the rehearsal; the `certutil` lines in Caddy's log are harmless). Create the owner (step 6), log in, and try Discovery. Stop it with `docker compose -f docker/docker-compose.prod.yml down` (add `-v` to delete the rehearsal data).

If something in this file is wrong, this is where you find out.

## 2. Server

- Ubuntu 22.04 or 24.04 LTS, 2 vCPU, 2 GB RAM minimum (4 GB is comfortable), 20 GB disk. Any provider works (AWS EC2 or Lightsail, DigitalOcean, Hetzner).
- Use SSH keys, not passwords. Turn on automatic security updates (`sudo apt install unattended-upgrades`).
- Firewall: allow **22, 80, 443** only (`sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable`). Docker bypasses ufw for published ports, which is why the Compose file publishes only Caddy's 80/443 and nothing else.
- Install Docker Engine and the Compose plugin from Docker's official instructions.

## 3. Domain

Buy a domain (or use a subdomain such as `app.yourdomain.com`) and create an **A record** pointing at the server's public IP. Wait for it to resolve (`dig +short app.yourdomain.com`) **before** the first start: Caddy asks Let's Encrypt for a certificate on startup and repeated failures get rate-limited.

## 4. Configure

```bash
git clone https://github.com/ekubanDev/AI-Ecosystem-V1.git && cd AI-Ecosystem-V1
cp docker/prod.env.example docker/.env
cp backend/production.env.example backend/.env.production
chmod 600 docker/.env backend/.env.production
```

Fill them in (generate secrets on the server, never reuse the development ones):

| Where | Value |
|---|---|
| `docker/.env` | `APP_DOMAIN=app.yourdomain.com`, `MONGO_PASSWORD=$(openssl rand -hex 24)` |
| `backend/.env.production` | `CLIENT_URL=https://app.yourdomain.com` (exactly), `PRIVACY_OPERATOR_NAME` and `PRIVACY_CONTACT_EMAIL` (a real mailbox), two different `JWT_*` secrets, your OpenAI / search / Gmail keys, correct `AI_PRICE_*` (dollars per **million** tokens) |

Then run the checker. It refuses to continue on the mistakes that fail quietly in production (indexes left off, proxy setting, wrong `CLIENT_URL`, weak secrets, open registration, per-token AI prices):

```bash
node scripts/check-prod.mjs
```

## 5. Start

```bash
docker compose -f docker/docker-compose.prod.yml up -d --build
docker compose -f docker/docker-compose.prod.yml ps        # everything "running"; backend and mongo "healthy"
docker compose -f docker/docker-compose.prod.yml logs -f caddy backend
```

## 6. Create the owner (do this before telling anyone the address)

Registration is closed in production, so the owner is created with the seed script:

```bash
read -rs -p "Owner password (10+ characters): " PW; echo
docker compose -f docker/docker-compose.prod.yml exec \
  -e SEED_OWNER_EMAIL=you@yourdomain.com -e SEED_OWNER_PASSWORD="$PW" \
  backend node scripts/seed.js
unset PW
```

You choose the password (it is not echoed or logged); change it after the first login. To add a teammate later: set `REGISTRATION_ENABLED=true`, restart the backend, let them register, promote them on the Users page, then set it back to `false`.

## 7. Verify

- `https://app.yourdomain.com` loads with a valid certificate; `http://` redirects to `https://`.
- Log in, run a small Discovery (count 3), and check the Evidence tab.
- Register nothing: `https://app.yourdomain.com/register` should say registration is closed.
- Confirm the database is not reachable from outside: `nc -vz <server-ip> 27017` must fail.

## 8. Backups

A dump runs daily into the `backups` volume and keeps 14 days. That protects against mistakes, **not** against losing the server. Copy dumps off the machine, for example a nightly cron on the host:

```bash
docker run --rm -v abf_backups:/b -v "$HOME/backups:/out" alpine sh -c 'cp -n /b/*.archive.gz /out/'
# then sync ~/backups to storage you control (rsync, rclone to S3/Drive, etc.)
```

The first backup is written at start-up, before there is any data, so it is only ~100 bytes: that is normal. Restore, then **test a restore once** before you need it. This safe version restores into a scratch database and compares counts, without touching live data:

```bash
set -a; . docker/.env; set +a
docker compose -f docker/docker-compose.prod.yml exec -T mongo \
  mongorestore -u abf -p "$MONGO_PASSWORD" --authenticationDatabase admin --gzip --archive=/dev/stdin \
  --nsFrom 'ai_business_factory.*' --nsTo 'restore_test.*' < abf-2026-10-03.archive.gz
# check counts in restore_test, then drop it:  db.getSiblingDB('restore_test').dropDatabase()
```

To actually restore over the live database (this **replaces** current data):

```bash
set -a; . docker/.env; set +a        # loads MONGO_PASSWORD into this shell
docker compose -f docker/docker-compose.prod.yml exec -T mongo \
  mongorestore -u abf -p "$MONGO_PASSWORD" --authenticationDatabase admin --gzip --archive=/dev/stdin --drop < abf-2026-10-03.archive.gz
```

## 9. Updating

```bash
git pull
node scripts/check-prod.mjs
docker compose -f docker/docker-compose.prod.yml up -d --build
```

There is no schema-migration system yet: if a release adds a required field, `docs/HANDOFF.md` and the release notes must include a backfill plan.

## 10. Operating notes

- **One worker.** Run exactly the services in the Compose file. A stray API process pointed at the same database also runs a task worker, and an old-code one can claim and fail tasks.
- **Logs:** `docker compose -f docker/docker-compose.prod.yml logs --tail=200 backend worker`. Every API response carries a request id that is also in the log.
- **Rotate keys** by editing `backend/.env.production` and `docker compose ... up -d`. Rotate anything that was ever pasted into a chat.
- **Cost:** AI spend is recorded per run (Dashboard → AI cost) once `AI_PRICE_*` are right.
- **Rate limits** assume `TRUST_PROXY=1` (one Caddy hop). If you add a CDN or another proxy in front, raise it, or every visitor shares one limit.
