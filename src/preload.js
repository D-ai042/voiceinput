const { contextBridge, ipcRenderer } = require('electron');

// ========================
// 全局变量
// ========================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let timerId = null;
let timerSeconds = 0;
let streamTimerStarted = false; // 流式首帧标记，用于准确启动计时器

// ========================
// 计时器
// ========================
function startTimer() {
  stopTimer();
  timerSeconds = 0;
  const el = document.getElementById('timer-text');
  if (el) el.textContent = '00:00';
  timerId = setInterval(() => {
    timerSeconds++;
    const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    if (el) el.textContent = m + ':' + s;
  }, 1000);
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  timerSeconds = 0;
}

// ========================
// WAV 转换
// ========================
function createWavFromBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 16;
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }
  const totalSamples = audioBuffer.length;
  const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return buffer;
}

// ========================
// 直接 IPC 监听 — UI 动画（在 preload 层直接处理，保证响应速度）
// ========================
function getEl(id) { return document.getElementById(id); }

ipcRenderer.on('start-recording-ui', () => {
  const btn = getEl('voice-btn');
  if (btn) { btn.classList.add('listening'); btn.classList.add('speaking'); }
  // 注：计时器在 startStreamAudioRecording / startAudioRecording 中启动，
  // 确保只有音频真正开始后才计时，不漏开头
});

ipcRenderer.on('stream-interim', (event, text) => {
  const st = getEl('status-text');
  if (st) {
    st.textContent = text || '…';
    st.className = 'recording';
  }
});

ipcRenderer.on('stop-recording-ui', () => {
  const btn = getEl('voice-btn');
  const tt = getEl('timer-text');
  if (btn) { btn.classList.remove('listening'); btn.classList.remove('speaking'); }
  if (tt) tt.classList.remove('active');
  stopTimer();
});

ipcRenderer.on('reset-ui', () => {
  const btn = getEl('voice-btn');
  const tt = getEl('timer-text');
  const st = getEl('status-text');
  if (btn) { btn.className = 'voice-btn'; }
  if (tt) tt.classList.remove('active');
  if (st) st.className = '';
  stopTimer();
});

// ========================
// contextBridge API
// ========================
contextBridge.exposeInMainWorld('electronAPI', {
  // ========== UI 更新 ==========
  updateIcon: (icon) => {
    const btn = document.getElementById('voice-btn');
    if (!btn) return;
    btn.classList.remove('listening', 'speaking', 'success');
    if (icon === '🔴') { btn.classList.add('listening'); btn.classList.add('speaking'); }
    else if (icon === '✅') btn.classList.add('success');
  },

  updateStatus: (text) => {
    const el = document.getElementById('status-text');
    if (!el) return;
    el.textContent = text;
    el.className = '';
    if (text.includes('录音') || text.includes('流式')) el.classList.add('recording');
    else if (text.includes('识别')) el.classList.add('processing');
  },

  startBreathing: () => {
    const btn = getEl('voice-btn');
    if (btn) { btn.classList.add('listening'); btn.classList.add('speaking'); }
    getEl('timer-text')?.classList.add('active');
    startTimer();
  },

  stopBreathing: () => {
    const btn = getEl('voice-btn');
    if (btn) { btn.classList.remove('listening'); btn.classList.remove('speaking'); }
    getEl('timer-text')?.classList.remove('active');
    stopTimer();
  },

  resetUI: () => {
    const btn = getEl('voice-btn');
    if (btn) btn.className = 'voice-btn';
    getEl('timer-text')?.classList.remove('active');
    const st = getEl('status-text');
    if (st) st.className = '';
    stopTimer();
  },

  // ========== IPC 监听器 ==========
  onUpdateIcon: (cb) => { ipcRenderer.on('update-icon', (e, icon) => cb(icon)); },
  onUpdateStatus: (cb) => { ipcRenderer.on('update-status', (e, text) => cb(text)); },
  onResetUI: (cb) => { /* 已由直接 IPC 监听处理 */ },
  onStartRecording: (cb) => { ipcRenderer.on('start-recording', () => cb()); },
  onStopRecording: (cb) => { ipcRenderer.on('stop-recording', () => cb()); },
  onStartStreamRecording: (cb) => { ipcRenderer.on('start-stream-recording', () => cb()); },
  onStopStreamRecording: (cb) => { ipcRenderer.on('stop-stream-recording', () => cb()); },
  onStreamResult: (cb) => { ipcRenderer.on('stream-result', (e, text) => cb(text)); },
  onNotify: (cb) => { ipcRenderer.on('notify', (e, msg) => cb(msg)); },

  // ========== 模式管理 ==========
  getMode: () => ipcRenderer.invoke('get-mode'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),

  // ========== 操作 ==========
  toggleRecording: () => ipcRenderer.send('toggle-recording'),
  startPressRecording: () => ipcRenderer.send('start-recording-press'),
  stopPressRecording: () => ipcRenderer.send('stop-recording-press'),
  sendRecordingStarted: (s) => ipcRenderer.send('recording-started', s),
  sendRecordingComplete: (p) => ipcRenderer.send('recording-complete', p),
  openSettings: () => ipcRenderer.send('open-settings'),
  quitApp: () => ipcRenderer.send('quit-app'),
  startWindowDrag: (p) => ipcRenderer.send('window-drag', p),
  sendStreamRecordingStopped: () => ipcRenderer.send('stream-recording-stopped'),

  // ========== 非流式录音 ==========
  startAudioRecording: async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 }
      });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunks = [];
      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunks.push(ev.data);
      };
      mediaRecorder.start(100);
      isRecording = true;

      // 非流式：MediaRecorder 已开始 → 启动计时器
      startTimer();
      const tt = document.getElementById('timer-text');
      if (tt) tt.classList.add('active');

      setTimeout(() => {
        if (isRecording) window.electronAPI.stopAudioRecording();
      }, 60000);
      return true;
    } catch (err) {
      console.error('startAudioRecording error:', err);
      return false;
    }
  },

  stopAudioRecording: async () => {
    return new Promise((resolve) => {
      if (!mediaRecorder || !isRecording) { resolve(null); return; }
      isRecording = false;
      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const buf = await blob.arrayBuffer();
          const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const audioBuf = await ctx.decodeAudioData(buf);
          ctx.close();
          const wavBuf = createWavFromBuffer(audioBuf);
          const path = await ipcRenderer.invoke('save-audio', Array.from(new Uint8Array(wavBuf)));
          setTimeout(() => {
            try { mediaRecorder.stream.getTracks().forEach(t => t.stop()); } catch (e) { }
          }, 500);
          audioChunks = [];
          resolve(path);
        } catch (err) {
          console.error('stopAudioRecording error:', err);
          resolve(null);
        }
      };
      mediaRecorder.stop();
    });
  },

  // ========== 流式录音（PCM 实时发送） ==========

  startStreamAudioRecording: async () => {
    // 可重入：已经录制中的不重复启动
    if (isRecording && mediaRecorder && mediaRecorder.stream) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      await audioCtx.resume();

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(1024, 1, 1);

      // 重置首次回调标记
      streamTimerStarted = false;

      processor.onaudioprocess = (ev) => {
        if (!isRecording) return;
        // 第一次收到音频数据时启动计时器（不漏开头，也不虚假计时）
        if (!streamTimerStarted) {
          streamTimerStarted = true;
          startTimer();
          const tt = document.getElementById('timer-text');
          if (tt) tt.classList.add('active');
        }
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        ipcRenderer.send('stream-audio-chunk', pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // 保存引用以便清理
      mediaRecorder = { stream, audioCtx, source, processor };
      isRecording = true;

      setTimeout(() => {
        if (isRecording) window.electronAPI.stopStreamAudioRecording();
      }, 60000);

      return true;
    } catch (err) {
      console.error('startStreamAudioRecording error:', err);
      return false;
    }
  },

  stopStreamAudioRecording: async () => {
    isRecording = false;
    try {
      if (mediaRecorder && mediaRecorder.processor) {
        mediaRecorder.processor.disconnect();
        mediaRecorder.source.disconnect();
        await mediaRecorder.audioCtx.close();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
      }
    } catch (e) { /* ignore */ }
    mediaRecorder = null;
    return true;
  }
});
