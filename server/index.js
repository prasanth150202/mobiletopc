import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WebSocket, WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 8787);
const accessToken = process.env.REMOTE_ACCESS_TOKEN || '';
const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
};
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(root, requestedPath));
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
});

const sockets = new WebSocketServer({ server, path: '/ws' });
const authorizedSockets = new Set();
let browser;
let context;
let page;
let frameTimer;
let activeDevice = 'desktop';
let activeUrl = '';
let streamGeneration = 0;

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message) {
  for (const socket of authorizedSockets) send(socket, message);
}

function normalizeUrl(value) {
  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS addresses are supported.');
  return parsed.toString();
}

function scheduleFrames(generation) {
  if (frameTimer) clearTimeout(frameTimer);
  const capture = async () => {
    if (!page || page.isClosed() || generation !== streamGeneration) return;
    try {
      const image = await page.screenshot({ type: 'jpeg', quality: 58, animations: 'disabled' });
      broadcast({ type: 'frame', data: image.toString('base64'), width: viewports[activeDevice].width, height: viewports[activeDevice].height });
    } catch {
      return;
    }
    frameTimer = setTimeout(capture, 140);
  };
  void capture();
}

async function closeSession() {
  streamGeneration += 1;
  if (frameTimer) clearTimeout(frameTimer);
  frameTimer = undefined;
  await context?.close().catch(() => undefined);
  context = undefined;
  page = undefined;
  activeUrl = '';
  broadcast({ type: 'status', status: 'idle' });
}

async function openContext(device) {
  activeDevice = device;
  context = await browser.newContext({
    viewport: viewports[device],
    isMobile: device === 'phone',
    hasTouch: device !== 'desktop',
    deviceScaleFactor: device === 'phone' ? 2 : 1,
  });
  page = await context.newPage();
  page.on('close', () => broadcast({ type: 'status', status: 'idle' }));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      activeUrl = frame.url();
      broadcast({ type: 'navigated', url: frame.url(), title: '' });
    }
  });
  await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  broadcast({ type: 'navigated', url: page.url(), title: await page.title().catch(() => '') });
  scheduleFrames(streamGeneration);
}

async function startSession(socket, url, device) {
  if (!viewports[device]) throw new Error('Choose a supported device profile.');
  if (!browser) browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  await closeSession();
  activeUrl = normalizeUrl(url);
  broadcast({ type: 'status', status: 'connecting' });
  try {
    streamGeneration += 1;
    await openContext(device);
    send(socket, { type: 'status', status: 'connected' });
  } catch (error) {
    await closeSession();
    send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Could not open the remote browser.' });
  }
}

async function handleMessage(socket, message) {
  try {
    if (message.type === 'start') return await startSession(socket, message.url, message.device);
    if (message.type === 'stop') return await closeSession();
    if (message.type === 'navigate') {
      if (!page) throw new Error('Start a browser session first.');
      activeUrl = normalizeUrl(message.url);
      await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      send(socket, { type: 'navigated', url: page.url(), title: await page.title().catch(() => '') });
      return;
    }
    if (message.type === 'device') {
      if (!page) return;
      if (!viewports[message.device]) throw new Error('Choose a supported device profile.');
      activeUrl = page.url();
      streamGeneration += 1;
      await context?.close();
      context = undefined;
      page = undefined;
      await openContext(message.device);
      send(socket, { type: 'status', status: 'connected' });
      return;
    }
    if (!page) return;
    if (message.action === 'mouse') {
      if (message.event === 'move') await page.mouse.move(message.x, message.y);
      if (message.event === 'down') await page.mouse.down({ button: message.button });
      if (message.event === 'up') await page.mouse.up({ button: message.button });
      if (message.event === 'wheel') await page.mouse.wheel(message.deltaX || 0, message.deltaY || 0);
    }
    if (message.action === 'keyboard') {
      if (message.event === 'down') await page.keyboard.down(message.key);
      else await page.keyboard.up(message.key);
    }
    if (message.action === 'text') await page.keyboard.insertText(message.text);
    if (message.action === 'touch') {
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', {
          type: message.event === 'start' ? 'touchStart' : message.event === 'move' ? 'touchMove' : 'touchEnd',
          touchPoints: message.event === 'end' ? [] : [{ x: message.x, y: message.y, id: 1 }],
        });
      } finally {
        await cdp.detach();
      }
    }
  } catch (error) {
    send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Remote browser action failed.' });
  }
}

sockets.on('connection', (socket) => {
  let authorized = !accessToken;
  if (authorized) {
    authorizedSockets.add(socket);
    send(socket, { type: 'authenticated' });
    send(socket, { type: 'status', status: page ? 'connected' : 'idle' });
  }
  socket.on('close', () => authorizedSockets.delete(socket));
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (!authorized) {
        if (message.type !== 'auth' || message.token !== accessToken) {
          send(socket, { type: 'auth-error', message: 'Invalid remote service access token.' });
          socket.close(1008, 'Unauthorized');
          return;
        }
        authorized = true;
        authorizedSockets.add(socket);
        send(socket, { type: 'authenticated' });
        send(socket, { type: 'status', status: page ? 'connected' : 'idle' });
        return;
      }
      if (message.type === 'auth') return;
      void handleMessage(socket, message);
    } catch {
      send(socket, { type: 'error', message: 'Invalid WebSocket message.' });
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Phonetopc running at http://localhost:${port}`);
});