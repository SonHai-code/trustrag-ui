# trustrag-ui

React + Vite + TypeScript chat UI (smooth streaming, citations, source cards), served by nginx.
nginx forwards `/api/*` to the gateway, so the browser only ever talks to one origin.

```bash
npm install && npm run dev        # http://localhost:5173, /api -> http://127.0.0.1:8000 (vite.config.ts)
npm run build                     # type-check + production bundle
docker build -t trustrag-ui .
docker run -p 8080:80 -e API_UPSTREAM=http://host.docker.internal:8000 trustrag-ui
```

`API_UPSTREAM` is the only setting: the gateway's internal URL (no trailing slash). The gateway must exist when this container starts, otherwise nginx stops with "host not found in upstream".
In Azure Container Apps this is `http://trustrag-gateway` (internal ingress); this app is the only one with a public URL.
