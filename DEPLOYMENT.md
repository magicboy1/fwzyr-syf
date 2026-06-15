# Deployment (external server)

This app keeps **all game state in memory**. It must run as a **single Node
process** — no PM2/Node cluster mode, no multiple replicas behind a load
balancer. Players would otherwise land on an instance that doesn't hold their
session and the game breaks.

## Build & run

```bash
npm ci                 # install deps (dependencies are needed at runtime)
npm run build          # builds client -> dist/public and server -> dist/index.cjs
ADMIN_PASSWORD=... PORT=5000 npm start
# or, loading a .env file (Node 20.6+):
node --env-file=.env dist/index.cjs
```

## Environment variables

See `.env.example`. The only required one is `ADMIN_PASSWORD` — without it the
admin/question-management endpoints stay disabled (a warning is logged on boot).

**Do not commit secrets.** Set `ADMIN_PASSWORD` via your process manager
(systemd `EnvironmentFile`, Docker `-e`, a `.env` loaded with `--env-file`).

## Reverse proxy (nginx) — WebSocket passthrough

Socket.io needs the upgrade headers forwarded:

```nginx
location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
}
```

If you terminate TLS at nginx, set `HOST=127.0.0.1` so Node only listens locally.

## Process manager (systemd example)

```ini
[Service]
ExecStart=/usr/bin/node /opt/fawazeer/dist/index.cjs
EnvironmentFile=/opt/fawazeer/.env
Restart=always
WorkingDirectory=/opt/fawazeer
```

Keep it a **single** unit — do not template multiple instances on the same port.

## Capacity notes

Tuned for ~500 concurrent players on one process. The biggest stability risk is
a CPU spike triggering mass socket reconnects; mitigations are already in code
(coalesced answer broadcasts, forgiving ping timeout, reconnection jitter).
Give the process a full CPU core and run the **production build** (not `npm run
dev`).
