# Phonetopc

A remote-browser controller built with HTML, CSS, and JavaScript. The browser UI connects to a persistent Node.js WebSocket service, which launches Chromium with Playwright and streams JPEG frames to the page.

## Vercel frontend and remote service

Vercel can serve the static HTML, CSS, and JavaScript, but its serverless functions do not host this app's persistent WebSocket and Playwright browser process. Deploy the Node service separately on a container host that supports long-running processes and WebSockets.

1. Deploy this repository as a Docker service using the included `Dockerfile`.
2. Set `REMOTE_ACCESS_TOKEN` to a long, random secret in the service host's environment settings. The service listens on the host-provided `PORT` and binds to `0.0.0.0`.
3. Make sure the service host provides an HTTPS URL and WebSocket upgrades. The health check is `GET /health`.
4. In the Vercel site, open the gear beside the service status. Enter the service's public HTTPS URL and the same access token, then choose **Save & connect**. The page stores the service URL in local storage and the token for the current browser tab session.

The access token is important: without it, anyone who can reach the public service could control its shared browser session and navigate that browser. Keep the token private and do not commit it to the repository. The service currently has one shared browser session, so anyone authorized with the token controls that same session.

## Run

```sh
npm install
npx playwright install chromium
npm start
```

Open `http://localhost:8787`. For local use, the service accepts connections without a token by default. Use the address field to start a session, choose a desktop, tablet, or phone viewport, and select mouse, keyboard, or touch input. The browser/device panel detects the browser and device used to open the controller.

To run the service in Docker:

```sh
docker build -t phonetopc .
docker run --rm -p 8787:8787 -e REMOTE_ACCESS_TOKEN='replace-with-a-long-random-secret' phonetopc
```

Set `REMOTE_ACCESS_TOKEN` through your hosting provider's environment-variable settings instead of putting a real secret in a shell history or source file.

## WebSocket protocol

Connect to `ws://localhost:8787/ws` locally or `wss://your-service-host/ws` from a public HTTPS site. When `REMOTE_ACCESS_TOKEN` is set, send `{ "type": "auth", "token": "..." }` immediately after connecting; the server replies with `authenticated` or `auth-error`. Messages are JSON. The server sends `status`, `navigated`, `frame`, and `error` messages. Frame messages contain a base64 JPEG and the emulated viewport dimensions.

Client messages:

- `{ "type": "start", "url": "https://example.com", "device": "desktop" }`
- `{ "type": "navigate", "url": "https://example.com" }`
- `{ "type": "device", "device": "phone" }`
- `{ "type": "input", "action": "mouse", "event": "move", "x": 120, "y": 80 }`
- `{ "type": "input", "action": "keyboard", "event": "down", "key": "Enter" }`
- `{ "type": "input", "action": "text", "text": "Hello" }`
- `{ "type": "input", "action": "touch", "event": "start", "x": 120, "y": 80 }`
- `{ "type": "stop" }`

Only one remote browser session is active at a time. Stopping the session closes its browser context. The service accepts HTTP and HTTPS navigation URLs.