# Deploying to one server

This sets up the whole app on a single small Linux server with Docker Compose. Nothing is deployed by merging this: you run these steps yourself, on a server you choose.

**What you get:** HTTPS with automatic certificates (Caddy), the web app and `/api` on one origin, the API, a separate task worker, MongoDB (not reachable from the internet), and a daily database dump.

**What you do not get yet:** monitoring or alerts, off-server backups (a script is described below, but you must set it up), a privacy notice page in the app, zero-downtime deploys, or multiple servers.

> **Status:** the Compose file validates and the config checker is tested, but the images have **not been built or run end to end** (the machine this was written on had no running Docker). Do the local rehearsal in step 1 before spending money on a server.

## 0. Before the app is public

A public page that collects names and emails is a legal and trust matter, not only a technical one. Decide these before you share a link:

1. **Privacy notice.** The sign-up form has a consent checkbox and promises deletion on request, but the app has **no privacy page**. Write one (what you collect, why, how long you keep it, who to contact) and link it from the landing page. The consent wording is generated in `backend/services/landingService.js` (`consentTextFor`).
2. **Registration with the regulator.** Ghana's Data Protection Act, 2012 (Act 843) generally expects organisations that process personal data to register with the Data Protection Commission. I am not a lawyer: confirm what applies to you before collecting data from real people.
3. **Deleting data on request.** The Leads tab has a delete button that really removes a person's details. Decide who answers deletion requests and how quickly.
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

Open `https://localhost` (your browser warns about the certificate: Caddy made it for localhost; accept it for the rehearsal). Create the owner (step 6), log in, and try Discovery. Stop it with `docker compose -f docker/docker-compose.prod.yml down` (add `-v` to delete the rehearsal data).

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
| `backend/.env.production` | `CLIENT_URL=https://app.yourdomain.com` (exactly), two different `JWT_*` secrets, your OpenAI / search / Gmail keys, correct `AI_PRICE_*` (dollars per **million** tokens) |

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

Restore, then **test a restore once** before you need it:

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
