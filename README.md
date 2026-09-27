# Phonetopc

A local remote-browser controller built with HTML, CSS, and JavaScript. The browser UI connects to a Node.js WebSocket service, which launches a headless Chromium session with Playwright and streams JPEG frames to the page.

## Run

```sh
npm install
npx playwright install chromium
npm start
```

Open `http://localhost:8787`. The service listens on localhost only. Use the address field to start a session, choose a desktop, tablet, or phone viewport, and select mouse, keyboard, or touch input. The browser/device panel detects the browser and device used to open the controller.

## WebSocket protocol

Connect to `ws://localhost:8787/ws`. Messages are JSON. The server sends `status`, `navigated`, `frame`, and `error` messages. Frame messages contain a base64 JPEG and the emulated viewport dimensions.

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