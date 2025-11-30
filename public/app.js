(() => {
  const previewVideo = document.getElementById('preview-video');
  const libraryList = document.getElementById('library-list');
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const clearLibraryBtn = document.getElementById('clear-library');
  const timelineVideoEl = document.getElementById('timeline-video');
  const timelineAudioEl = document.getElementById('timeline-audio');
  const timelineTextEl = document.getElementById('timeline-text');
  const timelineDrop = document.getElementById('timeline-drop');
  const timelineRuler = document.getElementById('timeline-ruler');
  const playToggle = document.getElementById('play-toggle');
  const stepBack = document.getElementById('step-back');
  const stepForward = document.getElementById('step-forward');
  const scrub = document.getElementById('scrub');
  const timeReadout = document.getElementById('time-readout');
  const durationChip = document.getElementById('duration-chip');
  const selectionLabel = document.getElementById('selection-label');
  const statusChip = document.getElementById('status-chip');
  const jobChip = document.getElementById('job-chip');
  const splitBtn = document.getElementById('split-btn');
  const removeBtn = document.getElementById('remove-btn');
  const playbackRate = document.getElementById('playback-rate');
  const sendBackendBtn = document.getElementById('send-backend');
  const logEl = document.getElementById('log');
  const downloadLink = document.getElementById('download-link');
  const textOverlay = document.getElementById('text-overlay');
  const textContentInput = document.getElementById('text-content');
  const textFontSelect = document.getElementById('text-font');
  const textDurationInput = document.getElementById('text-duration');
  const textLayerSelect = document.getElementById('text-layer');
  const addTextBtn = document.getElementById('add-text');
  const textColorInput = document.getElementById('text-color');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');

  const palette = ['#5cf4be', '#f4a261', '#7dd3fc', '#f472b6', '#bef264', '#c084fc'];
  let availableFonts = [];
  let rulerPlayhead = null;

  const config = window.APP_CONFIG || {};
  const state = {
    files: [],
    timeline: { video: [], audio: [], text: [] },
    currentTime: 0,
    selected: { track: null, id: null },
    playing: false,
    lastTick: null,
    pollHandle: null,
    pxPerSecond: 10,
  };
  const hiddenAudio = new Audio();
  hiddenAudio.crossOrigin = 'anonymous';
  hiddenAudio.playsInline = true;

  const log = (message) => {
    const ts = new Date().toLocaleTimeString();
    logEl.textContent = `[${ts}] ${message}\n` + logEl.textContent;
    logEl.scrollTop = 0;
  };

  const fmt = (seconds) => {
    const sec = Math.max(0, seconds || 0);
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${s}`;
  };

  const generateId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `id-${Math.random().toString(16).slice(2)}`;

  const clipDuration = (clip) => Math.max(0, (clip.end || 0) - (clip.start || 0));

  const trackDuration = (track) =>
    (state.timeline[track] || []).reduce((acc, clip) => acc + clipDuration(clip), 0);

  const totalDuration = () =>
    ['video', 'audio', 'text'].reduce((max, track) => Math.max(max, trackDuration(track)), 0);

  const cumulativeBefore = (track, index) =>
    (state.timeline[track] || []).slice(0, index).reduce((acc, clip) => acc + clipDuration(clip), 0);

  const locateInTrack = (track, time) => {
    const list = state.timeline[track] || [];
    let elapsed = 0;
    for (let i = 0; i < list.length; i += 1) {
      const clip = list[i];
      const dur = clipDuration(clip);
      const next = elapsed + dur;
      if (time <= next + 0.0001) {
        return { clip, index: i, offset: time - elapsed };
      }
      elapsed = next;
    }
    return null;
  };

  const updateStatus = (text) => {
    statusChip.textContent = text;
  };

  const updateTimeUI = () => {
    const total = totalDuration();
    timeReadout.textContent = `${fmt(state.currentTime)} / ${fmt(total)}`;
    durationChip.textContent = fmt(total);
    scrub.max = total || 0;
    scrub.value = Math.min(state.currentTime, total);
  };

  const setSelection = (track, clipId) => {
    state.selected = { track, id: clipId };
    if (!clipId) {
      selectionLabel.textContent = 'None';
      return;
    }
    const clip = (state.timeline[track] || []).find((c) => c.id === clipId);
    selectionLabel.textContent = clip
      ? `${track.toUpperCase()}: ${clip.label} (${fmt(clipDuration(clip))})`
      : 'None';
    renderTimeline();
  };

  const seekFromTrackEvent = (event) => {
    const targetTrack = event.currentTarget;
    const rect = targetTrack.getBoundingClientRect();
    const x = event.clientX - rect.left + targetTrack.scrollLeft;
    const seconds = Math.max(0, x / (state.pxPerSecond || 10));
    seekGlobal(seconds, true);
  };

  const enablePlayheadDrag = (el) => {
    let dragging = false;
    el.addEventListener('mousedown', (e) => {
      dragging = true;
      seekFromTrackEvent(e);
    });
    el.addEventListener('mousemove', (e) => {
      if (dragging) seekFromTrackEvent(e);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  };

  const refreshPlaybackRate = () => {
    previewVideo.playbackRate = Number(playbackRate.value) || 1;
    hiddenAudio.playbackRate = Number(playbackRate.value) || 1;
  };

  const loadDuration = (fileEntry) =>
    new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = fileEntry.url;
      probe.onloadedmetadata = () => {
        fileEntry.duration = probe.duration;
        probe.remove();
        resolve(fileEntry.duration);
      };
      probe.onerror = () => resolve(null);
    });

  const addFiles = (files) => {
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      const safeName = file.name;
      const entry = {
        id: generateId(),
        name: safeName,
        size: file.size,
        file,
        url,
        duration: null,
      };
      state.files.push(entry);
      loadDuration(entry).then(() => renderLibrary());
    });
    renderLibrary();
    log(`Added ${files.length} file(s)`);
  };

  const renderLibrary = () => {
    libraryList.innerHTML = '';
    state.files.forEach((file) => {
      const li = document.createElement('li');
      li.className = 'library-item';
      li.setAttribute('draggable', 'true');
      li.dataset.fileId = file.id;
      li.innerHTML = `<div>
          <strong>${file.name}</strong>
          <small>${file.duration ? fmt(file.duration) : 'Loading…'}</small>
        </div>
        <small>${(file.size / (1024 * 1024)).toFixed(1)} MB</small>`;

      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/library', file.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      li.addEventListener('dblclick', () => addBothTracksFromLibrary(file.id));
      libraryList.appendChild(li);
    });
  };

  const addClipFromLibrary = (fileId, track = 'video', insertIndex) => {
    const source = state.files.find((f) => f.id === fileId);
    if (!source) return;
    const clip = {
      id: generateId(),
      sourceId: source.id,
      url: source.url,
      label: source.name,
      start: 0,
      end: source.duration || 8,
      color: palette[(state.timeline[track] || []).length % palette.length],
      type: track,
      layer: 0,
    };
    const list = state.timeline[track];
    if (typeof insertIndex === 'number') {
      list.splice(insertIndex, 0, clip);
    } else {
      list.push(clip);
    }
    renderTimeline();
    updateTimeUI();
    log(`Clip added to ${track.toUpperCase()} track: ${clip.label}`);
  };

  const addBothTracksFromLibrary = (fileId) => {
    addClipFromLibrary(fileId, 'video');
    addClipFromLibrary(fileId, 'audio');
  };

  const addTextClip = () => {
    const text = (textContentInput.value || '').trim();
    if (!text) {
      log('Enter text before adding to the track.');
      return;
    }
    const duration = Math.max(1, Number(textDurationInput.value) || 3);
    const start = trackDuration('text');
    const clip = {
      id: generateId(),
      label: 'Text',
      text,
      font: textFontSelect.value,
      start,
      end: start + duration,
      color: textColorInput.value || '#c4b5fd',
      type: 'text',
      layer: Number(textLayerSelect.value || 1),
    };
    state.timeline.text.push(clip);
    renderTimeline();
    updateTimeUI();
    log(`Text clip added (${duration}s).`);
  };

  const renderTimeline = () => {
    const total = totalDuration() || 1;
    const pxPerSecond = Math.max(8, Math.min(30, 900 / Math.max(total, 8)));
    state.pxPerSecond = pxPerSecond;
    const trackWidth = total * pxPerSecond + 60;
    if (timelineRuler) {
      if (!rulerPlayhead) {
        rulerPlayhead = timelineRuler.querySelector('.playhead');
      }
      timelineRuler.style.width = `${trackWidth}px`;
      timelineRuler.style.minWidth = `${trackWidth}px`;
      if (rulerPlayhead) {
        rulerPlayhead.style.left = `${state.currentTime * pxPerSecond}px`;
      }
    }

    const renderTrack = (trackName, container) => {
      container.innerHTML = '';
      container.style.minWidth = `${trackWidth}px`;
      container.style.width = `${trackWidth}px`;
      let playhead = container.querySelector('.playhead');
      if (!playhead) {
        playhead = document.createElement('div');
        playhead.className = 'playhead';
        container.appendChild(playhead);
      }
      playhead.style.left = `${state.currentTime * pxPerSecond}px`;
      const list = state.timeline[trackName];
      list.forEach((clip, index) => {
        const width = Math.max(40, clipDuration(clip) * pxPerSecond);
        const offset = cumulativeBefore(trackName, index) * pxPerSecond;
        const el = document.createElement('div');
        el.className = `clip ${clip.id === state.selected.id ? 'active' : ''} ${
          trackName === 'audio' ? 'audio' : trackName === 'text' ? 'text' : ''
        }`;
        el.style.background =
          trackName === 'audio' ? '#184035' : trackName === 'text' ? '#241a3e' : clip.color;
        el.style.width = `${width}px`;
        el.style.left = `${offset}px`;
        el.draggable = true;
        el.dataset.clipId = clip.id;
        el.dataset.track = trackName;
        el.dataset.index = index;
        el.innerHTML = `<div>${clip.label}</div><small>${fmt(clipDuration(clip))}</small>`;

        el.addEventListener('click', () => {
          setSelection(trackName, clip.id);
        });

        el.addEventListener('dblclick', () => {
          const start = cumulativeBefore(trackName, index);
          seekGlobal(start);
        });

        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/timeline', JSON.stringify({ id: clip.id, track: trackName }));
          e.dataTransfer.effectAllowed = 'move';
        });

        container.appendChild(el);
      });
    };

    renderTrack('video', timelineVideoEl);
    renderTrack('audio', timelineAudioEl);
    renderTrack('text', timelineTextEl);
  };

  const getClipById = (track, id) => (state.timeline[track] || []).find((clip) => clip.id === id);

  const syncMedia = (time, { force = false } = {}) => {
    const syncTrack = (track, el) => {
      const loc = locateInTrack(track, time);
      if (!loc) {
        el.pause();
        el.removeAttribute('src');
        el.load();
        el.dataset.clipId = '';
        return;
      }
      const { clip, offset } = loc;
      const desiredTime = clip.start + offset;
      const needsSrc = el.dataset.clipId !== clip.id;
      const needsSeek = Math.abs((el.currentTime || 0) - desiredTime) > 0.25;
      if (needsSrc) {
        el.src = clip.url;
        el.dataset.clipId = clip.id;
      }
      if (needsSrc || force || needsSeek) {
        const apply = () => {
          el.currentTime = desiredTime;
          if (state.playing) {
            el.play().catch(() => {});
          }
        };
        if (el.readyState >= 2) {
          apply();
        } else {
          el.onloadedmetadata = () => apply();
        }
      }
    };

    syncTrack('video', previewVideo);
    syncTrack('audio', hiddenAudio);

      const textLoc = locateInTrack('text', time);
      if (textLoc?.clip) {
        const clip = textLoc.clip;
        textOverlay.style.display = 'block';
        textOverlay.textContent = clip.text || clip.label;
        textOverlay.style.fontFamily = clip.font || "'Space Grotesk', sans-serif";
        textOverlay.style.color = clip.color || '#fff';
        textOverlay.style.zIndex = 2 + (clip.layer || 0);
      } else {
        textOverlay.style.display = 'none';
      }
    };

  const seekGlobal = (time, force = false) => {
    const total = totalDuration();
    state.currentTime = Math.min(Math.max(0, time), total || 0);
    const loc =
      locateInTrack('video', state.currentTime) ||
      locateInTrack('audio', state.currentTime) ||
      locateInTrack('text', state.currentTime);
    if (loc) {
      setSelection(loc.clip.type, loc.clip.id);
    }
    syncMedia(state.currentTime, { force });
    updateTimeUI();
  };

  const tick = (ts) => {
    if (!state.playing) return;
    if (state.lastTick === null) state.lastTick = ts;
    const delta = ((ts - state.lastTick) / 1000) * (Number(playbackRate.value) || 1);
    state.lastTick = ts;
    const total = totalDuration();
    state.currentTime = Math.min(total, state.currentTime + delta);
    syncMedia(state.currentTime);
    updateTimeUI();
    if (state.currentTime >= total - 0.01) {
      pause();
      state.currentTime = 0;
      syncMedia(state.currentTime, { force: true });
      updateTimeUI();
      return;
    }
    requestAnimationFrame(tick);
  };

  const play = () => {
    if (!totalDuration()) return;
    const hasVideo = locateInTrack('video', state.currentTime);
    const hasAudio = locateInTrack('audio', state.currentTime);
    state.playing = true;
    state.lastTick = null;
    playToggle.textContent = 'Pause';
    updateStatus('Playing');
    refreshPlaybackRate();
    previewVideo.muted = true;
    if (hasVideo) previewVideo.play().catch(() => {});
    if (hasAudio) hiddenAudio.play().catch(() => {});
    requestAnimationFrame(tick);
  };

  const pause = () => {
    state.playing = false;
    previewVideo.pause();
    hiddenAudio.pause();
    playToggle.textContent = 'Play';
    updateStatus('Idle');
  };

  const downloadRender = async () => {
    const url = downloadLink.href;
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadLink.getAttribute('download') || 'render.mp4';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      log('Download started.');
    } catch (err) {
      log(`Download error: ${err.message}`);
    }
  };

  const splitAtPlayhead = () => {
    const { track, id } = state.selected;
    if (!track || !id) return;
    const list = state.timeline[track];
    const idx = list.findIndex((c) => c.id === id);
    const loc = locateInTrack(track, state.currentTime);
    if (!loc || loc.clip.id !== id) return;
    const { clip, offset } = loc;
    const dur = clipDuration(clip);
    if (offset <= 0.1 || offset >= dur - 0.1) {
      log('Cannot split at the very edge of a clip.');
      return;
    }
    const first = {
      ...clip,
      id: generateId(),
      end: clip.start + offset,
      label: `${clip.label} (A)`,
    };
    const second = {
      ...clip,
      id: generateId(),
      start: clip.start + offset,
      label: `${clip.label} (B)`,
    };
    list.splice(idx, 1, first, second);
    setSelection(track, first.id);
    updateTimeUI();
    renderTimeline();
    log(`Split ${clip.label} at ${fmt(offset)} on ${track.toUpperCase()}.`);
  };

  const removeSelected = () => {
    const { track, id } = state.selected;
    if (!track || !id) return;
    const list = state.timeline[track];
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const removed = list.splice(idx, 1)[0];
      log(`Removed clip ${removed.label} from ${track.toUpperCase()}`);
      setSelection(null, null);
      updateTimeUI();
      renderTimeline();
    }
  };

  const reorderTimeline = (dragged, targetTrack, targetIndex) => {
    const sourceTrack = dragged.track;
    const sourceList = state.timeline[sourceTrack];
    const destList = state.timeline[targetTrack];
    const srcIdx = sourceList.findIndex((c) => c.id === dragged.id);
    if (srcIdx === -1) return;
    if (dragged.track === 'text' && targetTrack !== 'text') {
      log('Text clips stay on the text track.');
      return;
    }
    if (dragged.track !== 'text' && targetTrack === 'text') {
      log('Use the text controls to add overlays.');
      return;
    }
    if (targetIndex == null || Number.isNaN(targetIndex)) targetIndex = destList.length;
    const [clip] = sourceList.splice(srcIdx, 1);
    clip.type = targetTrack;
    if (targetTrack === 'audio') {
      clip.color = '#1f5a47';
    }
    destList.splice(targetIndex, 0, clip);
    renderTimeline();
    updateTimeUI();
  };

  const setupTimelineDrop = () => {
    const activate = () => timelineDrop.classList.add('active');
    const deactivate = () => timelineDrop.classList.remove('active');

    const handleDrop = (e) => {
      e.preventDefault();
      deactivate();
      const timelineData = e.dataTransfer.getData('text/timeline');
      const libraryId = e.dataTransfer.getData('text/library');
      const targetClip = e.target.closest('.clip');
      const targetTrackEl = e.target.closest('.timeline-track');
      const droppedOnShell = !!e.target.closest('#timeline-drop');
      const targetTrackRaw = targetClip?.dataset.track || targetTrackEl?.dataset.track || 'video';
      const targetTrack = targetTrackRaw === 'text' ? 'text' : targetTrackRaw || 'video';
      const list = state.timeline[targetTrack] || [];
      const rect = (targetTrackEl || timelineDrop).getBoundingClientRect();
      const x = e.clientX - rect.left + (targetTrackEl ? targetTrackEl.scrollLeft : 0);
      const timeAtPointer = x / (state.pxPerSecond || 10);
      let insertIndex = list.findIndex((clip, idx) => cumulativeBefore(targetTrack, idx) > timeAtPointer);
      if (insertIndex === -1) insertIndex = targetClip ? Number(targetClip.dataset.index) : list.length;

      if (timelineData) {
        const parsed = JSON.parse(timelineData);
        if (parsed.track === 'text' && targetTrack !== 'text') {
          log('Text clips stay on the text track.');
          return;
        }
        if (targetTrack === 'text' && parsed.track !== 'text') {
          log('Use the text controls to add overlays.');
          return;
        }
        reorderTimeline(parsed, targetTrack, insertIndex);
        return;
      }
      if (libraryId) {
        if (targetTrack === 'text') {
          log('Use the text controls to add overlays.');
          return;
        }
        const destination = droppedOnShell ? 'video' : targetTrack;
        addClipFromLibrary(libraryId, destination, insertIndex);
        if (droppedOnShell) {
          addClipFromLibrary(libraryId, 'audio', insertIndex);
        }
        return;
      }
      const files = e.dataTransfer.files;
      if (files && files.length) {
        addFiles(files);
        Array.from(files).forEach((file) => {
          const match = state.files.find((f) => f.name === file.name);
          if (match) {
            if (droppedOnShell) {
              addClipFromLibrary(match.id, 'video');
              addClipFromLibrary(match.id, 'audio');
            } else {
              addClipFromLibrary(match.id, targetTrack);
            }
          }
        });
      }
    };

    [timelineDrop, timelineVideoEl, timelineAudioEl, timelineTextEl].forEach((el) => {
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        activate();
      });
      el.addEventListener('dragleave', deactivate);
      el.addEventListener('drop', handleDrop);
    });
  };

  const resetProgress = () => {
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Idle';
  };

  const monitorJob = (jobId) => {
    if (state.pollHandle) clearInterval(state.pollHandle);
    progressFill.style.width = '5%';
    progressLabel.textContent = 'Queued...';
    state.pollHandle = setInterval(async () => {
      try {
        const res = await fetch(`${config.apiEndpoint}/jobs/${jobId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Job failed');
        const pct = json.progress ?? 0;
        progressFill.style.width = `${pct}%`;
        progressLabel.textContent = `${pct}% ${json.status}`;
        statusChip.textContent = json.status;
        if (json.status === 'complete') {
          clearInterval(state.pollHandle);
          state.pollHandle = null;
          if (json.downloadUrl) {
            downloadLink.href = json.downloadUrl;
            downloadLink.download = `${jobId}.mp4`;
            downloadLink.hidden = false;
            log(`Render ready: ${json.downloadUrl}`);
          } else {
            downloadLink.hidden = true;
            log('Job complete (no download URL provided by backend).');
          }
          if (json.logUrl) log(`ffmpeg log: ${json.logUrl}`);
          updateStatus('Render complete');
        }
        if (json.status === 'error') {
          clearInterval(state.pollHandle);
          state.pollHandle = null;
          updateStatus('Error');
          log(`Render failed${json.error ? `: ${json.error}` : ''}`);
          if (json.logUrl) log(`ffmpeg log: ${json.logUrl}`);
        }
      } catch (err) {
        clearInterval(state.pollHandle);
        state.pollHandle = null;
        progressLabel.textContent = 'Error';
        updateStatus('Error');
        log(`Render error: ${err.message}`);
      }
    }, 1200);
  };

  const sendToBackend = async () => {
    if (!totalDuration()) {
      log('Timeline is empty; nothing to send.');
      return;
    }
    if (!config.apiEndpoint) {
      log('API endpoint not configured.');
      return;
    }

    const payload = {
      timeline: {
        video: state.timeline.video.map((clip, idx) => ({
          id: clip.id,
          sourceId: clip.sourceId,
          label: clip.label,
          start: clip.start,
          end: clip.end,
          timelineIn: cumulativeBefore('video', idx),
          layer: clip.layer || 0,
        })),
        audio: state.timeline.audio.map((clip, idx) => ({
          id: clip.id,
          sourceId: clip.sourceId,
          label: clip.label,
          start: clip.start,
          end: clip.end,
          timelineIn: cumulativeBefore('audio', idx),
          layer: clip.layer || 0,
        })),
        text: state.timeline.text.map((clip, idx) => ({
          id: clip.id,
          label: clip.text || clip.label,
          start: clip.start,
          end: clip.end,
          font: clip.font,
          color: clip.color,
          text: clip.text,
          timelineIn: cumulativeBefore('text', idx),
          layer: clip.layer || 0,
        })),
      },
      metadata: {
        createdAt: new Date().toISOString(),
        note: 'Server render via ffmpeg.',
      },
    };

    const usedSourceIds = new Set([
      ...payload.timeline.video.map((c) => c.sourceId),
      ...payload.timeline.audio.map((c) => c.sourceId),
    ]);

    const sanitizeKey = (name) => name.replace(/[^A-Za-z0-9._-]/g, '_');

    const assets = state.files
      .filter((f) => usedSourceIds.has(f.id))
      .map((f) => {
        const safeName = sanitizeKey(f.name);
        return {
          file: f,
          key: `uploads/${f.id}-${safeName}`,
          contentType: f.file.type || 'application/octet-stream',
        };
      });

    updateStatus('Requesting presigned URLs');
    log('Requesting job and presigned uploads…');
    try {
      const res = await fetch(`${config.apiEndpoint}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets: assets.map((a) => ({ key: a.key, contentType: a.contentType })),
          timeline: payload.timeline,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Export failed');
      }
      const { jobId, uploadUrls = [] } = json;
      jobChip.textContent = `Job ${jobId}`;
      jobChip.classList.remove('muted');
      downloadLink.hidden = true;
      resetProgress();
      updateStatus('Uploading assets');
      for (const { key, file, contentType } of assets) {
        const match = uploadUrls.find((u) => u.key === key);
        if (!match || !match.url) {
          log(`No upload URL for ${key}; skipping.`);
          continue;
        }
        const targetHost = (() => {
          try {
            return new URL(match.url).host;
          } catch {
            return 'unknown-host';
          }
        })();
        log(`Uploading ${file.name} -> ${key} @ ${targetHost}`);
        const putRes = await fetch(match.url, {
          method: 'PUT',
          body: file.file,
          headers: contentType ? { 'Content-Type': contentType } : undefined,
        });
        if (!putRes.ok) {
          let detail = '';
          try {
            const txt = await putRes.text();
            if (txt) detail = ` - ${txt}`;
          } catch {}
          throw new Error(`Upload failed for ${file.name} (${putRes.status})${detail}`);
        }
      }

      monitorJob(jobId);
      log(`Job queued: ${jobId}. Uploads done, polling progress...`);
      updateStatus('Queued (server)');
    } catch (err) {
      log(`Export error: ${err.message}`);
      updateStatus('Error');
    }
  };

  const setupUploadZone = () => {
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter', 'dragover'].forEach((evt) =>
      uploadZone.addEventListener(evt, (e) => {
        stop(e);
        uploadZone.classList.add('active');
      }),
    );
    ['dragleave', 'drop'].forEach((evt) =>
      uploadZone.addEventListener(evt, (e) => {
        stop(e);
        uploadZone.classList.remove('active');
      }),
    );
    uploadZone.addEventListener('drop', (e) => {
      stop(e);
      if (e.dataTransfer.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    });
  };

  const bindEvents = () => {
    fetch('/api/fonts')
      .then((r) => r.json())
      .then((fonts) => {
    availableFonts = fonts || [];
    textFontSelect.innerHTML = '';
    availableFonts.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = f.name;
      textFontSelect.appendChild(opt);
    });
  })
      .catch(() => {});
    setupUploadZone();
    setupTimelineDrop();
    enablePlayheadDrag(timelineRuler);

    fileInput.addEventListener('change', (e) => addFiles(e.target.files));
    clearLibraryBtn.addEventListener('click', () => {
      state.files = [];
      state.timeline = { video: [], audio: [] };
      state.currentTime = 0;
      setSelection(null, null);
      renderLibrary();
      renderTimeline();
      updateTimeUI();
      log('Cleared library and timeline.');
    });

    playToggle.addEventListener('click', () => {
      state.playing ? pause() : play();
    });
    stepBack.addEventListener('click', () => {
      seekGlobal(Math.max(0, state.currentTime - 1), true);
    });
    stepForward.addEventListener('click', () => {
      seekGlobal(Math.min(totalDuration(), state.currentTime + 1), true);
    });
    scrub.addEventListener('input', (e) => {
      seekGlobal(Number(e.target.value), true);
    });
    playbackRate.addEventListener('change', refreshPlaybackRate);
    addTextBtn.addEventListener('click', addTextClip);
    splitBtn.addEventListener('click', splitAtPlayhead);
    removeBtn.addEventListener('click', removeSelected);
    sendBackendBtn.addEventListener('click', sendToBackend);
    downloadLink.addEventListener('click', (e) => {
      e.preventDefault();
      downloadRender();
    });
    timelineDrop.addEventListener('click', () => {
      if (!totalDuration()) setSelection(null, null);
    });
  };

  const init = () => {
    bindEvents();
    renderLibrary();
    renderTimeline();
    updateTimeUI();
    refreshPlaybackRate();
    resetProgress();
    textOverlay.style.display = 'none';
    renderTimeline();
    log('Editor ready. Upload clips to begin.');
  };

  init();
})();
