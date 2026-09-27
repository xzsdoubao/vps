# Secure VLESS Node v2.0

A hardened Node.js launcher for running **Sing-box VLESS + WebSocket** behind a **Cloudflare Quick Tunnel**. Designed for container hosts (bot-hosting, Pterodactyl, etc.) where you get one public port and no root SSH.

## Architecture

```
Client (v2rayN / Shadowrocket)
        │
        │  wss (TLS) on 443
        ▼
Cloudflare Edge  ── Quick Tunnel ──►  cloudflared (localhost)
                                              │
                                              ▼
                              Sing-box VLESS + WS on 127.0.0.1:PORT
                                              │
                                              ▼
                                      Direct internet (outbound)
```

By default **Sing-box listens on `127.0.0.1` only**. All public traffic enters through the encrypted Cloudflare Tunnel. Direct public listening is opt-in.

## Quick start

1. Fork this repo and set your UUID in `config.json` (or set `VLESS_UUID` env).
2. In your container host, connect the GitHub repo as source.
3. Set startup file to `index.js`, runtime Node.js 18+.
4. Start. The launcher downloads sing-box and cloudflared from **official GitHub releases**, verifies SHA256, and starts both.

## config.json

```json
{
  "server": {
    "port": 3000,
    "listen": "127.0.0.1"
  },
  "vless": {
    "uuid": "your-uuid-here",
    "path": "/vless-ws"
  },
  "security": {
    "enableDirect": false,
    "showFullLink": false
  },
  "versions": {
    "singBox": "1.9.3",
    "cloudflared": "2024.10.1"
  }
}
```

| Field | Meaning |
|---|---|
| `server.port` | Internal port sing-box listens on (overridden by `SERVER_PORT` env) |
| `server.listen` | Always `127.0.0.1` unless `enableDirect` is true |
| `vless.uuid` | Your VLESS UUID (overridden by `VLESS_UUID` env) |
| `vless.path` | WebSocket path, default `/vless-ws` |
| `security.enableDirect` | If `true`, listen on `0.0.0.0` and print a plaintext node |
| `security.showFullLink` | If `true`, print the unmasked VLESS link in logs |
| `versions.singBox` | Pinned sing-box version (no `latest`) |
| `versions.cloudflared` | Pinned cloudflared version (no `latest`) |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VLESS_UUID` | — | Overrides config UUID |
| `SERVER_PORT` / `PORT` | `3000` | Internal port (host sets this) |
| `ENABLE_DIRECT` | `false` | Set to `true` to allow public direct mode |
| `SHOW_FULL_LINK` | `false` | Print unmasked link in logs |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` |

## Node links

The launcher prints links to the console on startup. UUID is masked by default (e.g. `bd21****e84a`).

- **CF Tunnel node (recommended)**: TLS on port 443 through trycloudflare.com.
- **Direct node (only if `ENABLE_DIRECT=true`)**: plaintext WS, no TLS.

Set `SHOW_FULL_LINK=true` to print the complete unmasked link for client import.

## Operations

```bash
npm start          # start the node
npm run check      # syntax-check all source files
npm run doctor     # environment health check
```

Logs are written to `logs/app.log` (rotated at 2 MB).

## Upgrading

- **sing-box**: change `versions.singBox` in config.json, restart. The launcher detects the version mismatch, re-downloads, and re-verifies SHA256.
- **cloudflared**: same, change `versions.cloudflared`.
- **Code**: `git pull` (or let the host auto-pull on restart), then restart.

## Security notes

- Binaries are downloaded only from `github.com/SagerNet/sing-box` and `github.com/cloudflare/cloudflared`.
- SHA256 is checked against the official `checksums.txt` / `SHA256SUMS` before execution.
- No `eval`, no base64-obscured URLs, no remote code execution.
- No credentials, tokens, or panel passwords are stored in the repo.
- Default mode never exposes sing-box to the public internet directly.
- Child processes are tracked via `ChildProcess` objects (not `pkill`), and shut down gracefully on SIGINT/SIGTERM.

## Troubleshooting

- **Port in use**: the process exits immediately; check if another service holds the port.
- **Tunnel fails**: cloudflared retries up to 5 times with exponential backoff (3s/6s/12s/24s/48s). If it still fails, check outbound network.
- **No output after start**: set `LOG_LEVEL=debug` to see sing-box/cloudflared logs.
- **Logs**: `logs/app.log`.
