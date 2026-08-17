(() => {
  const workspace = document.getElementById('workspace');
  const emptyState = document.getElementById('emptyState');
  const controlsToggle = document.getElementById('controlsToggle');
  const controlsPanel = document.getElementById('controlsPanel');
  const addCameraBtn = document.getElementById('addCameraBtn');
  const manageCamerasBtn = document.getElementById('manageCamerasBtn');
  const presetRow = document.getElementById('presetRow');
  const overlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const nameInput = document.getElementById('camName');
  const companyInput = document.getElementById('camCompany');
  const rtspInput = document.getElementById('camRtsp');
  const rtspLabel = document.getElementById('camRtspLabel');
  const modalError = document.getElementById('modalError');
  const cancelBtn = document.getElementById('modalCancel');
  const saveBtn = document.getElementById('modalSave');
  const manageOverlay = document.getElementById('manageOverlay');
  const manageList = document.getElementById('manageList');
  const manageClose = document.getElementById('manageClose');

  let cameras = [];
  let editingId = null;
  let topZ = 1;
  let layoutMode = 'free'; // 'free' or a number 1-10
  // Slot assignment for grid mode: index = slot number (0 = biggest/first cell),
  // value = camera id occupying it, or null if that slot is empty. Supports gaps,
  // so a camera can sit in slot 5 while slots 0-4 stay empty.
  let gridSlots = [];
  const tileEls = new Map(); // camera id -> tile DOM element
  const placeholderEls = []; // empty-slot DOM elements currently in the workspace

  async function api(path, opts) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function enabledCameras() {
    return cameras.filter((c) => c.enabled !== false);
  }

  // ---------- Floating controls ----------

  controlsToggle.addEventListener('click', () => {
    controlsPanel.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!document.getElementById('controls').contains(e.target)) {
      controlsPanel.classList.add('hidden');
    }
  });

  function buildPresetButtons() {
    presetRow.innerHTML = '';

    const freeBtn = document.createElement('button');
    freeBtn.className = 'presetBtn';
    freeBtn.dataset.mode = 'free';
    freeBtn.innerHTML = `
      <span class="presetCheck">&#10003;</span>
      <svg class="presetIcon" viewBox="0 0 34 24" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="14" height="10" rx="1.5" />
        <rect x="17" y="4" width="10" height="8" rx="1.5" />
        <rect x="6" y="13" width="12" height="10" rx="1.5" />
        <rect x="20" y="14" width="13" height="9" rx="1.5" />
      </svg>
      <span class="presetLabel2">Free (drag &amp; resize)</span>
    `;
    freeBtn.addEventListener('click', () => setLayoutMode('free'));
    presetRow.appendChild(freeBtn);

    for (let n = 1; n <= 10; n++) {
      const btn = document.createElement('button');
      btn.className = 'presetBtn';
      btn.dataset.mode = n;
      btn.innerHTML = `
        <span class="presetCheck">&#10003;</span>
        ${gridIconSvg(n)}
        <span class="presetLabel2">${n} Camera${n > 1 ? 's' : ''}</span>
      `;
      btn.addEventListener('click', () => setLayoutMode(n));
      presetRow.appendChild(btn);
    }
  }

  function highlightActivePreset() {
    presetRow.querySelectorAll('.presetBtn').forEach((btn) => {
      const isActive = String(btn.dataset.mode) === String(layoutMode);
      btn.classList.toggle('active', isActive);
    });
  }

  async function setLayoutMode(mode) {
    layoutMode = mode;
    workspace.classList.toggle('free', mode === 'free');
    workspace.classList.toggle('grid', mode !== 'free');
    highlightActivePreset();
    applyLayout();
    try {
      await api('/api/layout-mode', { method: 'PUT', body: JSON.stringify({ mode }) });
    } catch (e) {
      console.error('Failed to save layout mode', e);
    }
  }

  // ---------- Layout math ----------

  // The same asymmetric layouts UniFi Protect itself uses for 1-10 cameras (a big
  // "main" tile plus smaller ones, not just a plain even grid) - each cell as a
  // fraction (0-1) of the available width/height. Slot order matters: it's the order
  // cameras fill in (slot 0 is always the biggest/most prominent cell).
  function rect(x, y, w, h) { return { x, y, w, h }; }

  function gridFractions(n) {
    switch (n) {
      case 1:
        return [rect(0, 0, 1, 1)];
      case 2:
        return [rect(0, 0, 0.5, 1), rect(0.5, 0, 0.5, 1)];
      case 3:
        return [rect(0, 0, 0.6, 1), rect(0.6, 0, 0.4, 0.5), rect(0.6, 0.5, 0.4, 0.5)];
      case 4:
        return [rect(0, 0, 0.5, 0.5), rect(0.5, 0, 0.5, 0.5), rect(0, 0.5, 0.5, 0.5), rect(0.5, 0.5, 0.5, 0.5)];
      case 5: {
        const out = [rect(0, 0, 0.5, 1)];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out.push(rect(0.5 + c * 0.25, r * 0.5, 0.25, 0.5));
        return out;
      }
      case 6: {
        const out = [rect(0, 0, 0.65, 0.65), rect(0.65, 0, 0.35, 0.325), rect(0.65, 0.325, 0.35, 0.325)];
        for (let c = 0; c < 3; c++) out.push(rect(c / 3, 0.65, 1 / 3, 0.35));
        return out;
      }
      case 7: {
        const out = [rect(0, 0, 0.5, 0.5), rect(0.5, 0, 0.5, 0.5), rect(0, 0.5, 0.5, 0.5)];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out.push(rect(0.5 + c * 0.25, 0.5 + r * 0.25, 0.25, 0.25));
        return out;
      }
      case 8: {
        const out = [];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) out.push(rect(c * 0.325, r * 0.5, 0.325, 0.5));
        for (let r = 0; r < 4; r++) out.push(rect(0.65, r * 0.25, 0.35, 0.25));
        return out;
      }
      case 9: {
        const out = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(rect(c / 3, r / 3, 1 / 3, 1 / 3));
        return out;
      }
      case 10: {
        const out = [rect(0, 0, 0.55, 0.5), rect(0, 0.5, 0.55, 0.5)];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) out.push(rect(0.55 + c * 0.225, r * 0.25, 0.225, 0.25));
        return out;
      }
      default:
        return [];
    }
  }

  function computeGridRectsFor(n, w, h) {
    return gridFractions(n).map((r) => ({ x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h }));
  }

  function computeGridRects(n) {
    return computeGridRectsFor(n, workspace.clientWidth, workspace.clientHeight);
  }

  // Tiny SVG preview of what a given preset's grid looks like, for the layout menu -
  // built from the exact same fractions as the real layout, so it always matches.
  function gridIconSvg(n) {
    const W = 34, H = 24, gap = 2;
    const rects = computeGridRectsFor(n, W, H);
    const cells = rects.map((r) => {
      const x = r.x + gap / 2, y = r.y + gap / 2;
      const w = Math.max(1, r.w - gap), h = Math.max(1, r.h - gap);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" />`;
    }).join('');
    return `<svg class="presetIcon" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
  }

  // Keeps gridSlots in sync with the camera list: removed cameras' slots become
  // empty (not deleted from the array, so nothing else shifts), and any enabled
  // camera not currently placed anywhere gets dropped into the first empty slot.
  function syncGridSlots() {
    const ids = new Set(cameras.map((c) => c.id));
    gridSlots = gridSlots.map((id) => (id && ids.has(id) ? id : null));
    enabledCameras().forEach((cam) => {
      if (gridSlots.includes(cam.id)) return;
      const emptyIndex = gridSlots.indexOf(null);
      if (emptyIndex !== -1) gridSlots[emptyIndex] = cam.id;
      else gridSlots.push(cam.id);
    });
  }

  let gridOrderSaveTimer = null;
  function persistGridOrder() {
    clearTimeout(gridOrderSaveTimer);
    gridOrderSaveTimer = setTimeout(() => {
      api('/api/layout-order', { method: 'PUT', body: JSON.stringify({ order: gridSlots }) })
        .catch((e) => console.error('Failed to save grid order', e));
    }, 250);
  }

  function clearPlaceholders() {
    placeholderEls.forEach((el) => el.remove());
    placeholderEls.length = 0;
  }

  function renderPlaceholder(rect, slotIndex) {
    const el = document.createElement('div');
    el.className = 'tile placeholderTile';
    el.dataset.slot = slotIndex;
    el.style.left = rect.x + 'px';
    el.style.top = rect.y + 'px';
    el.style.width = rect.w + 'px';
    el.style.height = rect.h + 'px';
    el.style.zIndex = 0;
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    `;
    el.title = 'Drag a camera here, or click to add one';
    el.addEventListener('click', () => openModal('add'));
    workspace.appendChild(el);
    placeholderEls.push(el);
  }

  function applyLayout() {
    // Tiles for disabled cameras are never shown, in any layout mode.
    cameras.forEach((cam) => {
      const tile = tileEls.get(cam.id);
      if (tile && cam.enabled === false) tile.style.display = 'none';
    });

    clearPlaceholders();
    const active = enabledCameras();
    const visibleIds = new Set();

    if (layoutMode === 'free') {
      active.forEach((cam) => {
        const tile = tileEls.get(cam.id);
        if (tile) tile.style.display = '';
        positionTile(cam.id, cam.x, cam.y, cam.w, cam.h, cam.z);
        visibleIds.add(cam.id);
      });
    } else {
      // Always show the full preset's slot count, even if you have fewer cameras
      // than that - empty slots render as drop targets so you can plan out where
      // cameras will go (and click one to add a camera directly into that spot).
      const n = Number(layoutMode);
      const rects = computeGridRects(n);
      while (gridSlots.length < n) gridSlots.push(null);

      // Any active camera that fell outside the visible range (e.g. parked in a
      // higher slot from a bigger preset) gets pulled into an empty visible slot
      // if one's available, so shrinking the preset doesn't just hide it.
      const activeIds = new Set(active.map((c) => c.id));
      for (let i = 0; i < gridSlots.length; i++) {
        if (gridSlots[i] && !activeIds.has(gridSlots[i])) gridSlots[i] = null;
      }
      active.forEach((cam) => {
        const idx = gridSlots.indexOf(cam.id);
        if (idx === -1 || idx >= n) {
          const emptyIndex = gridSlots.slice(0, n).indexOf(null);
          if (emptyIndex !== -1) {
            if (idx !== -1) gridSlots[idx] = null;
            gridSlots[emptyIndex] = cam.id;
          }
        }
      });

      for (let i = 0; i < n; i++) {
        const camId = gridSlots[i];
        const cam = camId ? active.find((c) => c.id === camId) : null;
        if (cam) {
          const tile = tileEls.get(cam.id);
          if (tile) {
            tile.style.display = '';
            positionTile(cam.id, rects[i].x, rects[i].y, rects[i].w, rects[i].h, 1);
            visibleIds.add(cam.id);
          }
        } else {
          renderPlaceholder(rects[i], i);
        }
      }
      // Any enabled camera that couldn't fit in the visible slots stays hidden.
      active.forEach((cam) => {
        if (!visibleIds.has(cam.id)) {
          const tile = tileEls.get(cam.id);
          if (tile) tile.style.display = 'none';
        }
      });
    }

    // Only cameras actually on screen right now keep a live connection - this is what
    // keeps bandwidth down when a preset or a disabled camera hides most of the tiles.
    cameras.forEach((cam) => {
      if (visibleIds.has(cam.id)) ensureConnected(cam);
      else ensureDisconnected(cam.id);
    });
  }

  window.addEventListener('resize', () => {
    if (layoutMode !== 'free') applyLayout();
  });

  // ---------- Add / edit camera modal ----------

  function openModal(mode, cam) {
    modalError.classList.add('hidden');
    modalError.textContent = '';
    if (mode === 'edit') {
      editingId = cam.id;
      modalTitle.textContent = 'Edit camera';
      nameInput.value = cam.name;
      companyInput.value = cam.company || '';
      rtspInput.value = cam.rtsp;
      rtspInput.disabled = true;
      rtspLabel.style.display = 'none';
    } else {
      editingId = null;
      modalTitle.textContent = 'Add camera';
      nameInput.value = '';
      companyInput.value = '';
      rtspInput.value = '';
      rtspInput.disabled = false;
      rtspLabel.style.display = '';
    }
    overlay.classList.remove('hidden');
    nameInput.focus();
  }

  function closeModal() {
    overlay.classList.add('hidden');
  }

  addCameraBtn.addEventListener('click', () => {
    controlsPanel.classList.add('hidden');
    openModal('add');
  });
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const company = companyInput.value.trim();
    const rtsp = rtspInput.value.trim();
    if (!name) return showModalError('Give the camera a name.');

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      if (editingId) {
        const cam = await api(`/api/cameras/${editingId}/rename`, {
          method: 'PUT',
          body: JSON.stringify({ name, company }),
        });
        const idx = cameras.findIndex((c) => c.id === editingId);
        cameras[idx] = { ...cameras[idx], name: cam.name, company: cam.company };
      } else {
        if (!rtsp) return showModalError('Paste the RTSP link.');
        const cam = await api('/api/cameras', {
          method: 'POST',
          body: JSON.stringify({ name, company, rtsp }),
        });
        cameras.push(cam);
        syncGridSlots();
        persistGridOrder();
        renderTile(cam);
        applyLayout();
      }
      closeModal();
      updateEmptyState();
    } catch (e) {
      showModalError(e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  function showModalError(msg) {
    modalError.textContent = msg;
    modalError.classList.remove('hidden');
  }

  function updateEmptyState() {
    emptyState.classList.toggle('hidden', cameras.length > 0);
  }

  // ---------- Manage cameras overview ----------

  manageCamerasBtn.addEventListener('click', () => {
    controlsPanel.classList.add('hidden');
    renderManageList();
    manageOverlay.classList.remove('hidden');
  });
  manageClose.addEventListener('click', () => manageOverlay.classList.add('hidden'));
  manageOverlay.addEventListener('click', (e) => {
    if (e.target === manageOverlay) manageOverlay.classList.add('hidden');
  });

  function renderManageList() {
    manageList.innerHTML = '';
    if (cameras.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'manageRowEmpty';
      empty.textContent = 'No cameras added yet.';
      manageList.appendChild(empty);
      return;
    }
    cameras.forEach((cam) => {
      const row = document.createElement('div');
      row.className = 'manageRow';

      const info = document.createElement('div');
      info.className = 'manageRowInfo';
      const nameEl = document.createElement('div');
      nameEl.className = 'manageRowName';
      nameEl.textContent = cam.name;
      info.appendChild(nameEl);
      if (cam.company) {
        const companyEl = document.createElement('div');
        companyEl.className = 'manageRowCompany';
        companyEl.textContent = cam.company;
        info.appendChild(companyEl);
      }

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = cam.enabled !== false;
      checkbox.addEventListener('change', async () => {
        try {
          await api(`/api/cameras/${cam.id}/enabled`, {
            method: 'PUT',
            body: JSON.stringify({ enabled: checkbox.checked }),
          });
          cam.enabled = checkbox.checked;
          applyLayout();
        } catch (e) {
          checkbox.checked = !checkbox.checked;
          alert('Could not update camera: ' + e.message);
        }
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      toggleLabel.appendChild(checkbox);
      toggleLabel.appendChild(slider);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'manageRowRemove';
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', async () => {
        if (!confirm(`Remove "${cam.name}"?`)) return;
        try {
          await api(`/api/cameras/${cam.id}`, { method: 'DELETE' });
          ensureDisconnected(cam.id);
          connections.delete(cam.id);
          cameras = cameras.filter((c) => c.id !== cam.id);
          syncGridSlots();
          persistGridOrder();
          const tile = tileEls.get(cam.id);
          if (tile) tile.remove();
          tileEls.delete(cam.id);
          updateEmptyState();
          applyLayout();
          renderManageList();
        } catch (e) {
          alert('Could not remove camera: ' + e.message);
        }
      });

      row.appendChild(info);
      row.appendChild(toggleLabel);
      row.appendChild(removeBtn);
      manageList.appendChild(row);
    });
  }

  // ---------- Live video (direct WebRTC to go2rtc, no embedded player) ----------

  // camera id -> { pc, ws, stop(), active }
  const connections = new Map();

  function waitIceGatheringComplete(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', done);
        resolve();
      };
      pc.addEventListener('icegatheringstatechange', function check() {
        if (pc.iceGatheringState === 'complete') done();
      });
      // Safety timeout - on a LAN, gathering is normally near-instant, but this
      // guarantees we never hang forever waiting on it.
      setTimeout(resolve, 2000);
    });
  }

  // Opens a direct WebRTC connection to go2rtc for one camera and plays it into the
  // given <video> element. Reconnects automatically if the connection drops. Returns a
  // stop() function that tears everything down (used when a tile is hidden/removed).
  function connectCamera(cam, videoEl, dotEl) {
    let stopped = false;
    let pc = null;
    let ws = null;
    let retryTimer = null;
    let watchdog = null;

    function cleanup() {
      clearTimeout(watchdog);
      if (pc) { try { pc.close(); } catch (e) {} pc = null; }
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      if (dotEl) dotEl.classList.remove('live');
    }

    function scheduleReconnect(delayMs) {
      if (stopped) return;
      cleanup();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(start, delayMs || 2000);
    }

    async function start() {
      if (stopped) return;
      cleanup();
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        pc.ontrack = (ev) => {
          console.log(`[${cam.name}] track received:`, ev.track.kind);
          if (videoEl.srcObject !== ev.streams[0]) {
            videoEl.srcObject = ev.streams[0];
            videoEl.play().catch((e) => console.warn(`[${cam.name}] play() blocked:`, e.message));
          }
        };
        pc.onconnectionstatechange = () => {
          console.log(`[${cam.name}] connection state:`, pc.connectionState);
          if (pc.connectionState === 'connected') {
            clearTimeout(watchdog);
            if (dotEl) dotEl.classList.add('live');
          } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            scheduleReconnect();
          }
        };

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${window.location.host}/go2rtc-ws?src=${encodeURIComponent(cam.id)}`);

        ws.addEventListener('open', async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitIceGatheringComplete(pc);
            if (stopped || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'webrtc/offer', value: pc.localDescription.sdp }));
          } catch (e) {
            console.error(`[${cam.name}] failed to create/send offer:`, e);
            scheduleReconnect();
          }
        });

        ws.addEventListener('message', async (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'webrtc/answer' && pc) {
              await pc.setRemoteDescription({ type: 'answer', sdp: msg.value });
            } else if (msg.type === 'webrtc/candidate' && msg.value && pc) {
              // go2rtc sends bare candidate strings without a mid/mline-index, but since
              // both transceivers are bundled onto one shared transport (standard for a
              // simple recvonly setup like this), it's safe to always target m-line 0.
              try { await pc.addIceCandidate({ candidate: msg.value, sdpMLineIndex: 0 }); } catch (e) {
                console.warn(`[${cam.name}] addIceCandidate failed:`, e.message);
              }
            } else if (msg.type === 'error') {
              console.error(`[${cam.name}] go2rtc error:`, msg.value);
            }
          } catch (e) {
            console.error(`[${cam.name}] failed to handle signaling message:`, e, ev.data);
          }
        });

        ws.addEventListener('close', () => scheduleReconnect());
        ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });

        // If nothing connects within a reasonable time, retry rather than sit stuck.
        watchdog = setTimeout(() => scheduleReconnect(), 8000);
      } catch (e) {
        scheduleReconnect();
      }
    }

    start();

    return function stop() {
      stopped = true;
      clearTimeout(retryTimer);
      cleanup();
      videoEl.srcObject = null;
    };
  }

  function ensureConnected(cam) {
    const entry = connections.get(cam.id);
    if (entry && entry.active) return;
    const tile = tileEls.get(cam.id);
    if (!tile) return;
    const video = tile.querySelector('video');
    const dot = tile.querySelector('.tile-status-dot');
    const stop = connectCamera(cam, video, dot);
    connections.set(cam.id, { stop, active: true });
  }

  function ensureDisconnected(id) {
    const entry = connections.get(id);
    if (entry && entry.active) {
      entry.stop();
      connections.set(id, { stop: () => {}, active: false });
    }
  }

  function positionTile(id, x, y, w, h, z) {
    const tile = tileEls.get(id);
    if (!tile) return;
    tile.style.left = x + 'px';
    tile.style.top = y + 'px';
    tile.style.width = w + 'px';
    tile.style.height = h + 'px';
    tile.style.zIndex = z || 1;
  }

  function renderTile(cam) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.id = cam.id;
    tile.style.zIndex = cam.z || 1;
    topZ = Math.max(topZ, cam.z || 1);

    tile.innerHTML = `
      <div class="tile-video-wrap">
        <video autoplay muted playsinline></video>
        <span class="tile-status-dot"></span>
      </div>
      <div class="drag-handle"></div>
      <div class="tile-actions">
        <button class="renameBtn" title="Edit">&#9998;</button>
        <button class="removeBtn" title="Remove">&times;</button>
      </div>
      <div class="resize-handle"></div>
    `;

    workspace.appendChild(tile);
    tileEls.set(cam.id, tile);
    positionTile(cam.id, cam.x, cam.y, cam.w, cam.h, cam.z);

    if (cam.enabled === false) tile.style.display = 'none';

    tile.querySelector('.removeBtn').addEventListener('click', async () => {
      if (!confirm(`Remove "${cam.name}"?`)) return;
      try {
        await api(`/api/cameras/${cam.id}`, { method: 'DELETE' });
        ensureDisconnected(cam.id);
        connections.delete(cam.id);
        cameras = cameras.filter((c) => c.id !== cam.id);
        syncGridSlots();
        persistGridOrder();
        tile.remove();
        tileEls.delete(cam.id);
        updateEmptyState();
        applyLayout();
      } catch (e) {
        alert('Could not remove camera: ' + e.message);
      }
    });

    tile.querySelector('.renameBtn').addEventListener('click', () => {
      const current = cameras.find((c) => c.id === cam.id);
      openModal('edit', current);
    });

    makeDraggable(tile, cam);
    makeResizable(tile, cam);

    tile.addEventListener('mousedown', () => bringToFront(tile, cam));
  }

  function bringToFront(tile, cam) {
    topZ += 1;
    tile.style.zIndex = topZ;
    const stored = cameras.find((c) => c.id === cam.id);
    if (stored) stored.z = topZ;
    if (layoutMode === 'free') persistLayout(stored);
  }

  let saveTimers = {};
  function persistLayout(cam) {
    if (!cam) return;
    clearTimeout(saveTimers[cam.id]);
    saveTimers[cam.id] = setTimeout(() => {
      api(`/api/cameras/${cam.id}/layout`, {
        method: 'PUT',
        body: JSON.stringify({ x: cam.x, y: cam.y, w: cam.w, h: cam.h, z: cam.z }),
      }).catch((e) => console.error('Failed to save layout', e));
    }, 250);
  }

  function findTileUnder(clientX, clientY, excludeTile) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const tile = el.closest('.tile');
    if (!tile || tile === excludeTile) return null;
    return tile;
  }

  function clearDropHighlight() {
    document.querySelectorAll('.tile.dropTarget').forEach((t) => t.classList.remove('dropTarget'));
  }

  function swapOrMoveIntoSlot(camId, target) {
    const sourceIndex = gridSlots.indexOf(camId);
    if (sourceIndex === -1) return;
    if (target.dataset.id) {
      // Dropped onto another camera's tile - swap the two slots.
      const targetIndex = gridSlots.indexOf(target.dataset.id);
      if (targetIndex === -1) return;
      [gridSlots[sourceIndex], gridSlots[targetIndex]] = [gridSlots[targetIndex], gridSlots[sourceIndex]];
    } else if (target.dataset.slot !== undefined) {
      // Dropped onto an empty placeholder - move into that slot, vacating the old one.
      const targetIndex = Number(target.dataset.slot);
      gridSlots[sourceIndex] = null;
      gridSlots[targetIndex] = camId;
    }
  }

  function makeDraggable(tile, camRef) {
    const handle = tile.querySelector('.drag-handle');
    let startX, startY, startLeft, startTop, dragging = false, mode = 'free';

    function begin(clientX, clientY) {
      mode = layoutMode === 'free' ? 'free' : 'grid';
      dragging = true;
      tile.classList.add('dragging');
      startX = clientX;
      startY = clientY;
      startLeft = tile.offsetLeft;
      startTop = tile.offsetTop;
      if (mode === 'grid') tile.style.zIndex = 9999;
    }
    function move(clientX, clientY) {
      if (!dragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (mode === 'free') {
        const cam = cameras.find((c) => c.id === camRef.id);
        const newLeft = Math.max(0, startLeft + dx);
        const newTop = Math.max(0, startTop + dy);
        tile.style.left = newLeft + 'px';
        tile.style.top = newTop + 'px';
        if (cam) { cam.x = newLeft; cam.y = newTop; }
      } else {
        // Grid mode: the tile follows the cursor and highlights whichever other
        // tile it's currently over - drop on it to swap the two cameras' slots.
        tile.style.left = (startLeft + dx) + 'px';
        tile.style.top = (startTop + dy) + 'px';
        clearDropHighlight();
        const target = findTileUnder(clientX, clientY, tile);
        if (target) target.classList.add('dropTarget');
      }
    }
    function end(clientX, clientY) {
      if (!dragging) return;
      dragging = false;
      if (mode === 'free') {
        tile.classList.remove('dragging');
        persistLayout(cameras.find((c) => c.id === camRef.id));
      } else {
        // Find what's under the cursor BEFORE restoring pointer-events on the
        // dragged tile - otherwise the tile itself (still sitting right at the
        // cursor) blocks detection and every drop looks like it found nothing.
        const target = typeof clientX === 'number' ? findTileUnder(clientX, clientY, tile) : null;
        tile.classList.remove('dragging');
        clearDropHighlight();
        if (target) {
          swapOrMoveIntoSlot(camRef.id, target);
          persistGridOrder();
        }
        applyLayout(); // snaps every tile back to its (possibly now-updated) slot
      }
    }

    handle.addEventListener('mousedown', (e) => { begin(e.clientX, e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', (e) => end(e.clientX, e.clientY));

    handle.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      begin(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      move(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      end(t ? t.clientX : undefined, t ? t.clientY : undefined);
    });
  }

  function makeResizable(tile, camRef) {
    const handle = tile.querySelector('.resize-handle');
    let startX, startY, startW, startH, resizing = false;

    handle.addEventListener('mousedown', (e) => {
      if (layoutMode !== 'free') return;
      resizing = true;
      tile.classList.add('resizing');
      startX = e.clientX;
      startY = e.clientY;
      startW = tile.offsetWidth;
      startH = tile.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const cam = cameras.find((c) => c.id === camRef.id);
      const dw = e.clientX - startX;
      const dh = e.clientY - startY;
      const newW = Math.max(160, startW + dw);
      const newH = Math.max(100, startH + dh);
      tile.style.width = newW + 'px';
      tile.style.height = newH + 'px';
      if (cam) { cam.w = newW; cam.h = newH; }
    });

    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      tile.classList.remove('resizing');
      persistLayout(cameras.find((c) => c.id === camRef.id));
    });
  }

  // ---------- Init ----------

  async function init() {
    buildPresetButtons();

    const layoutCfg = await api('/api/layout-mode');
    layoutMode = layoutCfg.mode;
    gridSlots = layoutCfg.order || [];
    workspace.classList.toggle('free', layoutMode === 'free');
    workspace.classList.toggle('grid', layoutMode !== 'free');
    highlightActivePreset();

    cameras = await api('/api/cameras');
    syncGridSlots();
    cameras.forEach(renderTile);
    updateEmptyState();
    applyLayout();
  }

  init().catch((e) => {
    console.error(e);
    alert('Could not load CamViewer: ' + e.message);
  });
})();
