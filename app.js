const addressForm = document.querySelector('#address-form');
const addressInput = document.querySelector('#address-input');
const startButton = document.querySelector('#start-button');
const stopButton = document.querySelector('#stop-button');
const reloadButton = document.querySelector('#reload-button');
const fullscreenButton = document.querySelector('#fullscreen-button');
const viewportStage = document.querySelector('#viewport-stage');
const remoteFrame = document.querySelector('#remote-frame');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const sessionIndicator = document.querySelector('#session-indicator');
const serviceStatus = document.querySelector('#service-status');
const deviceSizes = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
};

let socket;
let socketTimer;
let toastTimer;
let selectedDevice = 'desktop';
let inputMode = 'mouse';
let sessionState = 'idle';
let pendingStart = false;
let currentViewport = deviceSizes.desktop;
let frameTimes = [];
let touchActive = false;
let lastFrameData = '';

function setService(state) {
  serviceStatus.dataset.state = state;
  document.querySelector('#service-label').textContent = state === 'online' ? 'SERVICE ONLINE' : state === 'offline' ? 'SERVICE OFFLINE' : 'CONNECTING';
  startButton.disabled = state !== 'online' || sessionState === 'connecting';
}

function setSession(state) {
  sessionState = state;
  const connected = state === 'connected';
  sessionIndicator.dataset.state = state;
  document.querySelector('#session-label').textContent = connected ? 'SESSION LIVE' : state === 'connecting' ? 'STARTING SESSION' : 'NO ACTIVE SESSION';
  document.querySelector('#detail-status').textContent = connected ? 'Connected' : state === 'connecting' ? 'Starting' : 'Standby';
  document.querySelector('.session-card').dataset.state = state;
  document.querySelector('#connection-label').textContent = connected ? 'Remote browser connected' : state === 'connecting' ? 'Launching remote Chrome' : 'Waiting for session';
  document.querySelector('#connection-dot').dataset.active = String(connected);
  startButton.disabled = serviceStatus.dataset.state !== 'online' || state === 'connecting';
  stopButton.disabled = !connected && state !== 'connecting';
  reloadButton.disabled = !connected;
  if (!connected) {
    viewportStage.dataset.active = 'false';
    remoteFrame.removeAttribute('src');
    document.querySelector('#frame-rate').textContent = '-- FPS';
  }
}

function showError(message) {
  toast.textContent = message;
  toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.dataset.visible = 'false'; }, 4200);
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connect() {
  clearTimeout(socketTimer);
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${scheme}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    setService('online');
    if (pendingStart) beginSession();
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'status') setSession(message.status);
    if (message.type === 'frame') showFrame(message);
    if (message.type === 'navigated') updatePage(message);
    if (message.type === 'error') {
      setSession(sessionState === 'connected' ? 'connected' : 'idle');
      showError(message.message || 'The remote browser could not complete that action.');
    }
  });
  socket.addEventListener('close', () => {
    setService('offline');
    setSession('idle');
    socketTimer = setTimeout(connect, 1800);
  });
  socket.addEventListener('error', () => socket.close());
}

function normalizeAddress(value) {
  const entered = value.trim();
  if (!entered) throw new Error('Enter a website URL first.');
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(entered) ? entered : `https://${entered}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS addresses are supported.');
  return url.toString();
}

function beginSession() {
  try {
    const url = normalizeAddress(addressInput.value);
    pendingStart = false;
    addressInput.value = url;
    document.querySelector('#detail-title').textContent = 'Launching Chrome';
    document.querySelector('#detail-url').textContent = new URL(url).host;
    setSession('connecting');
    send({ type: 'start', url, device: selectedDevice });
  } catch (error) {
    pendingStart = false;
    showError(error.message);
  }
}

function updatePage(message) {
  const title = message.title || new URL(message.url).hostname;
  document.querySelector('#page-title-label').textContent = title;
  document.querySelector('#detail-title').textContent = title;
  document.querySelector('#detail-url').textContent = new URL(message.url).host;
  document.querySelector('#favicon-mark').textContent = title.trim().charAt(0).toUpperCase() || '◉';
  addressInput.value = message.url;
  setSession('connected');
}

function showFrame(message) {
  currentViewport = { width: message.width, height: message.height };
  if (lastFrameData !== message.data) {
    remoteFrame.src = `data:image/jpeg;base64,${message.data}`;
    lastFrameData = message.data;
  }
  viewportStage.dataset.active = 'true';
  if (sessionState !== 'connected') setSession('connected');
  frameTimes.push(performance.now());
  frameTimes = frameTimes.filter((time) => performance.now() - time < 1200);
  document.querySelector('#frame-rate').textContent = `${Math.max(1, frameTimes.length - 1)} FPS`;
}

function setDevice(device) {
  if (!deviceSizes[device]) return;
  selectedDevice = device;
  currentViewport = deviceSizes[device];
  document.querySelectorAll('[data-device]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.device === device));
  });
  document.querySelector('#viewport-label').textContent = `${currentViewport.width} × ${currentViewport.height}`;
  document.querySelector('#empty-title').textContent = device === 'phone' ? 'Phone profile selected' : device === 'tablet' ? 'Tablet profile selected' : 'Ready when you are';
  if (sessionState === 'connected') send({ type: 'device', device });
}

function setMode(mode) {
  inputMode = mode;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  viewportStage.classList.remove('viewer-stage-mode-mouse', 'viewer-stage-mode-keyboard', 'viewer-stage-mode-touch');
  viewportStage.classList.add(`viewer-stage-mode-${mode}`);
  document.querySelector('#control-note').textContent = mode === 'keyboard' ? 'Click the viewport, then type to send keys.' : mode === 'touch' ? 'Drag on the viewport to send touch gestures.' : 'Click and scroll inside the remote viewport.';
}

function updateDetection() {
  const ua = navigator.userAgent;
  let browser = 'Unknown browser';
  let glyph = '?';
  if (/Edg\//.test(ua)) { browser = 'Microsoft Edge'; glyph = 'E'; }
  else if (/Firefox\//.test(ua)) { browser = 'Firefox'; glyph = 'F'; }
  else if (/CriOS\//.test(ua)) { browser = 'Chrome'; glyph = 'C'; }
  else if (/Chrome\//.test(ua)) { browser = 'Chrome'; glyph = 'C'; }
  else if (/Safari\//.test(ua)) { browser = 'Safari'; glyph = 'S'; }
  let os = 'Unknown OS';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  const mobile = navigator.userAgentData?.mobile ?? /Android.*Mobile|iPhone|iPod|Windows Phone/i.test(ua);
  const tablet = /iPad|Tablet|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.max(screen.width, screen.height) < 1200);
  const device = mobile ? 'Mobile device' : tablet ? 'Tablet' : 'Desktop computer';
  document.querySelector('#detected-browser').textContent = browser;
  document.querySelector('#detected-device').textContent = `${device} · ${os}`;
  document.querySelector('#browser-glyph').textContent = glyph;
  document.querySelector('#device-glyph').innerHTML = mobile
    ? '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="1.5" width="8" height="17" rx="2"></rect><path d="M9 15.5h2"></path></svg>'
    : '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="10" rx="1.5"></rect><path d="M7 17h6m-3-3.5V17"></path></svg>';
}

function frameCoordinates(event) {
  const rect = remoteFrame.getBoundingClientRect();
  const scale = Math.min(rect.width / currentViewport.width, rect.height / currentViewport.height);
  const renderedWidth = currentViewport.width * scale;
  const renderedHeight = currentViewport.height * scale;
  const left = rect.left + (rect.width - renderedWidth) / 2;
  const top = rect.top + (rect.height - renderedHeight) / 2;
  return {
    x: Math.max(0, Math.min(currentViewport.width, Math.round((event.clientX - left) / scale))),
    y: Math.max(0, Math.min(currentViewport.height, Math.round((event.clientY - top) / scale))),
  };
}

function remoteKey(key) {
  const aliases = { ' ': 'Space', Control: 'Control', Meta: 'Meta', Alt: 'Alt', Shift: 'Shift', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter', Tab: 'Tab' };
  return aliases[key] || key;
}

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (sessionState === 'connected') {
    try {
      const url = normalizeAddress(addressInput.value);
      addressInput.value = url;
      send({ type: 'navigate', url });
    } catch (error) { showError(error.message); }
    return;
  }
  if (serviceStatus.dataset.state !== 'online') {
    pendingStart = true;
    showError('Waiting for the local browser service to reconnect.');
    return;
  }
  beginSession();
});

stopButton.addEventListener('click', () => {
  pendingStart = false;
  send({ type: 'stop' });
  setSession('idle');
  document.querySelector('#detail-title').textContent = 'No browser connected';
  document.querySelector('#detail-url').textContent = 'Enter an address to begin';
  document.querySelector('#page-title-label').textContent = 'New session';
});

reloadButton.addEventListener('click', () => {
  try { send({ type: 'navigate', url: normalizeAddress(addressInput.value) }); }
  catch (error) { showError(error.message); }
});

fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.viewer-column').requestFullscreen();
  } catch { showError('Fullscreen is not available in this browser.'); }
});

document.querySelectorAll('[data-device]').forEach((button) => button.addEventListener('click', () => setDevice(button.dataset.device)));
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));

viewportStage.addEventListener('pointerdown', (event) => {
  if (sessionState !== 'connected' || !viewportStage.dataset.active) return;
  viewportStage.focus({ preventScroll: true });
  if (inputMode === 'touch') {
    event.preventDefault();
    viewportStage.setPointerCapture(event.pointerId);
    touchActive = true;
    send({ type: 'input', action: 'touch', event: 'start', ...frameCoordinates(event) });
  } else if (inputMode === 'mouse') {
    const button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
    send({ type: 'input', action: 'mouse', event: 'down', button, ...frameCoordinates(event) });
  }
});

viewportStage.addEventListener('pointermove', (event) => {
  if (sessionState !== 'connected' || !viewportStage.dataset.active) return;
  if (inputMode === 'touch' && touchActive) {
    event.preventDefault();
    send({ type: 'input', action: 'touch', event: 'move', ...frameCoordinates(event) });
  } else if (inputMode === 'mouse') {
    send({ type: 'input', action: 'mouse', event: 'move', ...frameCoordinates(event) });
  }
});

function endPointer(event) {
  if (inputMode === 'touch' && touchActive) {
    send({ type: 'input', action: 'touch', event: 'end', ...frameCoordinates(event) });
    touchActive = false;
  } else if (inputMode === 'mouse') {
    const button = event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left';
    send({ type: 'input', action: 'mouse', event: 'up', button, ...frameCoordinates(event) });
  }
}

viewportStage.addEventListener('pointerup', endPointer);
viewportStage.addEventListener('pointercancel', endPointer);
viewportStage.addEventListener('contextmenu', (event) => event.preventDefault());
viewportStage.addEventListener('wheel', (event) => {
  if (inputMode !== 'mouse' || sessionState !== 'connected') return;
  event.preventDefault();
  send({ type: 'input', action: 'mouse', event: 'wheel', ...frameCoordinates(event), deltaX: event.deltaX, deltaY: event.deltaY });
}, { passive: false });

viewportStage.addEventListener('keydown', (event) => {
  if (sessionState !== 'connected' || inputMode === 'mouse' || event.isComposing) return;
  event.preventDefault();
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!event.repeat) send({ type: 'input', action: 'text', text: event.key });
    return;
  }
  send({ type: 'input', action: 'keyboard', event: 'down', key: remoteKey(event.key) });
});

viewportStage.addEventListener('keyup', (event) => {
  if (sessionState !== 'connected' || inputMode === 'mouse' || event.key.length === 1) return;
  send({ type: 'input', action: 'keyboard', event: 'up', key: remoteKey(event.key) });
});

window.addEventListener('beforeunload', () => {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
});

updateDetection();
window.addEventListener('resize', updateDetection);
setMode('mouse');
setSession('idle');
setService('connecting');
connect();