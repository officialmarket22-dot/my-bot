/* ==========================================
   MARKET SENTIMENT DASHBOARD - script.js
   ========================================== */

// ⚙️ STATE GLOBAL
const state = {
  instrument: 'XAUUSD',
  timeframe: 'M15',
  apiKey: null,               // hanya di memori setelah decrypt
  analysisResult: null,
  screenshot1: null,          // base64
  rememberSession: false,
  confidenceThreshold: 70,
  cachedAnalysis: null,       // { ts, result }
};

// DOM elements cache
const dom = {};
function cacheDom() {
  dom.analyzeBtn = document.getElementById('analyzeBtn');
  dom.instrumentSelect = document.getElementById('instrumentSelect');
  dom.gaugeSvg = document.getElementById('gaugeSvg');
  dom.sentimentLabel = document.getElementById('sentimentLabel');
  dom.confidenceValue = document.getElementById('confidenceValue');
  dom.marketStatusBadge = document.getElementById('marketStatusBadge');
  dom.marketStatusText = document.getElementById('marketStatusText');
  dom.reasoningList = document.getElementById('reasoningList');
  dom.signalCard = document.getElementById('signalCard');
  dom.noSignalCard = document.getElementById('noSignalCard');
  dom.signalDirection = document.getElementById('signalDirection');
  dom.signalConfidence = document.getElementById('signalConfidence');
  dom.signalEntry = document.getElementById('signalEntry');
  dom.signalTP1 = document.getElementById('signalTP1');
  dom.signalTP2 = document.getElementById('signalTP2');
  dom.signalSL = document.getElementById('signalSL');
  dom.validCandles = document.getElementById('validCandles');
  dom.validMinutes = document.getElementById('validMinutes');
  dom.historyBody = document.getElementById('historyBody');
  dom.apiStatusText = document.getElementById('apiStatusText');
  dom.uploadArea = document.getElementById('uploadArea');
  dom.dropzone = document.getElementById('dropzone');
  dom.fileInput = document.getElementById('fileInput');
  dom.previewContainer = document.getElementById('previewContainer');
  dom.previewImage = document.getElementById('previewImage');
  dom.removePreview = document.getElementById('removePreview');
  dom.settingsModal = document.getElementById('settingsModal');
  dom.passwordModal = document.getElementById('passwordModal');
  dom.toast = document.getElementById('toast');
}

// 🛠 UTILS
function toast(msg, type='info') {
  dom.toast.textContent = msg;
  dom.toast.className = `toast show toast-${type}`;
  setTimeout(() => dom.toast.classList.remove('show'), 2500);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('✅ Berhasil disalin');
  } catch {
    toast('❌ Gagal menyalin', 'error');
  }
}

function compressImage(file, maxWidth=800, quality=0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = maxWidth / img.width;
        canvas.width = maxWidth;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

function generateHash(str) {
  let hash = 0;
  for (let i=0; i<str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
  }
  return hash.toString();
}

// 🔐 CRYPTO (Web Crypto API)
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    iv: Array.from(iv),
    salt: Array.from(salt)
  };
}

async function decryptApiKey(encryptedData, password) {
  const { ciphertext, iv, salt } = encryptedData;
  const key = await deriveKey(password, new Uint8Array(salt));
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      new Uint8Array(ciphertext)
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    throw new Error('Password salah atau data rusak');
  }
}

// 📦 STORAGE
function getEncryptedKey() {
  const raw = localStorage.getItem('gemini_encrypted_key');
  return raw ? JSON.parse(raw) : null;
}
function saveEncryptedKey(encryptedData) {
  localStorage.setItem('gemini_encrypted_key', JSON.stringify(encryptedData));
}
function clearKeys() {
  localStorage.removeItem('gemini_encrypted_key');
  sessionStorage.removeItem('gemini_session_key');
  state.apiKey = null;
}

function getCached(instrument) {
  const raw = localStorage.getItem(`cache_${instrument}`);
  if (!raw) return null;
  const { result, ts } = JSON.parse(raw);
  if (Date.now() - ts < 120000) return result; // 2 menit
  return null;
}
function setCached(instrument, result) {
  localStorage.setItem(`cache_${instrument}`, JSON.stringify({ result, ts: Date.now() }));
}

function getHistory() {
  const raw = localStorage.getItem('analysis_history');
  return raw ? JSON.parse(raw) : [];
}
function saveHistory(entry) {
  const history = getHistory();
  history.unshift(entry);
  if (history.length > 50) history.pop();
  localStorage.setItem('analysis_history', JSON.stringify(history));
}

// 🧠 PROMPT BUILDER
function buildPrompt(instrument, timeframe, additionalContext='') {
  return `
Anda adalah asisten trading profesional. Analisis pasar ${instrument} pada timeframe ${timeframe}.
${additionalContext}
Perhatikan screenshot chart yang diberikan (jika ada). Baca semua teks pada gambar (harga, level, indikator) dan kenali pola umum.
Berikan output JSON VALID dengan format berikut:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": <0-100>,
  "reasoning": ["<alasan 1>", "<alasan 2>", "<alasan 3>"],
  "marketStatus": "Disarankan" | "Hati-hati" | "Tidak Disarankan",
  "riskLevel": "low" | "medium" | "high",
  "eventRiskWarning": "<string atau null>",
  "signal": {
    "direction": "buy" | "sell" | null,
    "entry": <angka desimal> | null,
    "targets": [<tp1>, <tp2>] | [],
    "stopLoss": <angka desimal> | null,
    "validForCandles": <angka> | null
  },
  "keyLevels": { "support": <angka>, "resistance": <angka> }
}

ATURAN PENTING:
- Gunakan bahasa Indonesia santai untuk reasoning (campur istilah trading).
- JANGAN memberikan sinyal jika confidence di bawah 70 atau kondisi pasar tidak jelas.
- Jika tidak ada sinyal, set signal.direction = null, dan kosongkan entry, targets, stopLoss, validForCandles.
- Tentukan marketStatus berdasarkan confidence dan risiko.
- Baca setiap teks di screenshot dengan teliti.`;
}

// 📡 API CALL
async function unlockAndGetKey() {
  // cek sessionStorage dulu
  const sessionKey = sessionStorage.getItem('gemini_session_key');
  if (sessionKey) {
    state.apiKey = sessionKey;
    return sessionKey;
  }
  const encrypted = getEncryptedKey();
  if (!encrypted) {
    dom.settingsModal.classList.add('active');
    return null;
  }
  // tampilkan password modal
  return new Promise((resolve) => {
    dom.passwordModal.classList.add('active');
    const unlockHandler = async () => {
      const pwd = document.getElementById('inputUnlockPassword').value;
      const remember = document.getElementById('rememberSession').checked;
      try {
        const key = await decryptApiKey(encrypted, pwd);
        state.apiKey = key;
        if (remember) {
          sessionStorage.setItem('gemini_session_key', key);
          state.rememberSession = true;
        }
        dom.passwordModal.classList.remove('active');
        document.getElementById('inputUnlockPassword').value = '';
        resolve(key);
      } catch {
        toast('❌ Password salah', 'error');
        // biarkan modal tetap terbuka, user bisa coba lagi
        // tapi jangan resolve
      }
    };
    // bind unlock button sekali
    const btn = document.getElementById('unlockBtn');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', unlockHandler);
    // juga handle Enter
    document.getElementById('inputUnlockPassword').onkeydown = (e) => {
      if (e.key === 'Enter') unlockHandler();
    };
    // jika user cancel (batal)
    document.querySelector('#passwordModal .modal-close').onclick = () => {
      dom.passwordModal.classList.remove('active');
      resolve(null);
    };
  });
}

async function callGemini(prompt, imageBase64List) {
  if (!state.apiKey) {
    const key = await unlockAndGetKey();
    if (!key) throw new Error('API key tidak tersedia');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${state.apiKey}`;
  const parts = [{ text: prompt }];
  if (imageBase64List && imageBase64List.length) {
    imageBase64List.forEach(b64 => {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
    });
  }
  const body = { contents: [{ parts }] };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${err}`);
  }
  const data = await response.json();
  // parse teks JSON dari respons Gemini
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Respons AI kosong');
  // cari JSON di dalam teks (mungkin ada backticks)
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
  const jsonString = jsonMatch ? jsonMatch[1] : text;
  return JSON.parse(jsonString);
}

// 🖼️ UI UPDATER
function updateGauge(sentiment, confidence) {
  // Clear SVG
  dom.gaugeSvg.innerHTML = '';
  const cx=100, cy=100, r=80;
  // background arc
  const bgPath = document.createElementNS('http://www.w3.org/2000/svg','path');
  bgPath.setAttribute('d', `M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`);
  bgPath.setAttribute('stroke','#30363D');
  bgPath.setAttribute('stroke-width','12');
  bgPath.setAttribute('fill','none');
  dom.gaugeSvg.appendChild(bgPath);
  // needle
  const needle = document.createElementNS('http://www.w3.org/2000/svg','line');
  needle.setAttribute('x1', cx); needle.setAttribute('y1', cy);
  needle.setAttribute('x2', cx); needle.setAttribute('y2', cy-70);
  needle.setAttribute('stroke','#E6EDF3');
  needle.setAttribute('stroke-width','3');
  needle.setAttribute('stroke-linecap','round');
  needle.classList.add('gauge-needle');
  // rotasi berdasarkan sentimen
  let angle = 0; // netral
  if (sentiment === 'bullish') angle = -60; // kiri atas
  else if (sentiment === 'bearish') angle = 60; // kanan bawah
  needle.style.transform = `rotate(${angle}deg)`;
  dom.gaugeSvg.appendChild(needle);
  // label
  dom.sentimentLabel.textContent = sentiment.toUpperCase();
  dom.sentimentLabel.style.color = sentiment==='bullish'?'var(--success)':(sentiment==='bearish'?'var(--danger)':'var(--warning)');
}

function updateConfidence(confidence) {
  dom.confidenceValue.textContent = `${confidence}%`;
}

function updateMarketStatus(status) {
  dom.marketStatusText.textContent = status;
  dom.marketStatusBadge.className = 'market-status-badge';
  if (status === 'Disarankan') dom.marketStatusBadge.classList.add('status-disarankan');
  else if (status === 'Hati-hati') dom.marketStatusBadge.classList.add('status-hati-hati');
  else dom.marketStatusBadge.classList.add('status-tidak-disarankan');
}

function updateReasoning(reasoning) {
  dom.reasoningList.innerHTML = '';
  if (!reasoning || !reasoning.length) {
    dom.reasoningList.innerHTML = '<li class="placeholder">Tidak ada alasan</li>';
    return;
  }
  reasoning.forEach(r => {
    const li = document.createElement('li');
    li.textContent = r;
    dom.reasoningList.appendChild(li);
  });
}

function updateSignal(signal) {
  if (!signal || !signal.direction) {
    // tidak ada sinyal
    dom.signalCard.style.display = 'none';
    dom.noSignalCard.style.display = 'block';
    // hentikan timer jika ada
    if (window.signalTimer) clearInterval(window.signalTimer);
    return;
  }
  dom.noSignalCard.style.display = 'none';
  dom.signalCard.style.display = 'block';
  dom.signalDirection.textContent = signal.direction.toUpperCase();
  dom.signalDirection.style.background = signal.direction==='buy'?'var(--success)':'var(--danger)';
  dom.signalConfidence.textContent = state.analysisResult?.confidence + '%' || '';
  dom.signalEntry.textContent = signal.entry ? parseFloat(signal.entry).toFixed(2) : '--';
  dom.signalTP1.textContent = signal.targets?.[0] ? parseFloat(signal.targets[0]).toFixed(2) : '--';
  dom.signalTP2.textContent = signal.targets?.[1] ? parseFloat(signal.targets[1]).toFixed(2) : '--';
  dom.signalSL.textContent = signal.stopLoss ? parseFloat(signal.stopLoss).toFixed(2) : '--';
  
  // set data-value untuk copy
  document.querySelectorAll('.btn-copy').forEach(btn => {
    const val = btn.parentElement.querySelector('.level-value').textContent;
    btn.setAttribute('data-value', val);
  });

  // hitung validitas (menit)
  const candles = signal.validForCandles || 0;
  const minutes = candles * (state.timeframe === 'M15' ? 15 : 30);
  dom.validCandles.textContent = candles;
  dom.validMinutes.textContent = minutes;
  
  // hitung mundur
  if (window.signalTimer) clearInterval(window.signalTimer);
  let remaining = minutes * 60; // detik
  if (remaining > 0) {
    window.signalTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(window.signalTimer);
        dom.signalCard.style.opacity = '0.5';
        dom.signalCard.querySelector('.signal-validity').innerHTML = '⏰ EXPIRED';
      } else {
        const m = Math.floor(remaining/60);
        const s = remaining % 60;
        dom.signalCard.querySelector('.signal-validity').innerHTML = `⏳ Valid ${candles} candle (${m}:${s.toString().padStart(2,'0')} menit)`;
      }
    }, 1000);
  }
}

function updateHistory() {
  const history = getHistory();
  dom.historyBody.innerHTML = '';
  if (!history.length) {
    dom.historyBody.innerHTML = '<tr class="empty-row"><td colspan="5">Belum ada riwayat</td></tr>';
    return;
  }
  history.forEach(h => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(h.timestamp).toLocaleTimeString('id-ID')}</td>
      <td>${h.instrument}</td>
      <td>${h.sentiment}</td>
      <td>${h.confidence}%</td>
      <td>${h.signalDirection || '-'}</td>
    `;
    dom.historyBody.appendChild(row);
  });
}

async function displayResult(result) {
  state.analysisResult = result;
  updateGauge(result.sentiment, result.confidence);
  updateConfidence(result.confidence);
  updateMarketStatus(result.marketStatus || 'Hati-hati');
  updateReasoning(result.reasoning);
  updateSignal(result.signal);
  // simpan history
  saveHistory({
    timestamp: Date.now(),
    instrument: state.instrument,
    sentiment: result.sentiment,
    confidence: result.confidence,
    signalDirection: result.signal?.direction || null
  });
  updateHistory();
}

// 🚀 MAIN ANALYZE FLOW
async function analyzeNow() {
  try {
    dom.analyzeBtn.disabled = true;
    dom.analyzeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    
    // cek cache
    const cached = getCached(state.instrument);
    if (cached && !state.screenshot1) {
      // jika tidak ada screenshot baru, pakai cache
      await displayResult(cached);
      dom.analyzeBtn.disabled = false;
      dom.analyzeBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Analyze Now';
      return;
    }
    
    // siapkan gambar
    const images = [];
    if (state.screenshot1) images.push(state.screenshot1);
    
    // bangun prompt
    let context = '';
    if (images.length) context += 'Screenshot chart disertakan. ';
    const prompt = buildPrompt(state.instrument, state.timeframe, context);
    
    // panggil Gemini
    const result = await callGemini(prompt, images);
    
    // simpan cache
    setCached(state.instrument, result);
    // tampilkan
    await displayResult(result);
    
    // reset screenshot setelah analisis (opsional)
    // state.screenshot1 = null; updatePreviewUI();
  } catch (err) {
    console.error(err);
    toast(`❌ ${err.message}`, 'error');
  } finally {
    dom.analyzeBtn.disabled = false;
    dom.analyzeBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Analyze Now';
  }
}

// 🖱️ EVENT HANDLERS & INIT
function setupEventListeners() {
  // Instrument change
  dom.instrumentSelect.addEventListener('change', (e) => {
    state.instrument = e.target.value;
  });
  
  // Analyze button
  dom.analyzeBtn.addEventListener('click', analyzeNow);
  
  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    dom.settingsModal.classList.add('active');
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('inputApiKey').value.trim();
    const password = document.getElementById('inputPassword').value;
    const confirm = document.getElementById('inputConfirmPassword').value;
    const threshold = parseInt(document.getElementById('inputThreshold').value) || 70;
    if (!apiKey || !password) return toast('Isi API Key dan Password', 'error');
    if (password !== confirm) return toast('Password tidak cocok', 'error');
    try {
      const encrypted = await encryptApiKey(apiKey, password);
      saveEncryptedKey(encrypted);
      state.confidenceThreshold = threshold;
      localStorage.setItem('confidence_threshold', threshold);
      dom.apiStatusText.textContent = 'Tersimpan & Terenkripsi';
      dom.apiStatusText.style.color = 'var(--success)';
      dom.settingsModal.classList.remove('active');
      toast('✅ API Key tersimpan aman');
      // bersihkan input
      document.getElementById('inputApiKey').value = '';
      document.getElementById('inputPassword').value = '';
      document.getElementById('inputConfirmPassword').value = '';
    } catch (e) {
      toast('❌ Gagal enkripsi', 'error');
    }
  });
  document.getElementById('clearKeyBtn').addEventListener('click', () => {
    if (confirm('Hapus API key tersimpan?')) {
      clearKeys();
      dom.apiStatusText.textContent = 'Belum diatur';
      dom.apiStatusText.style.color = '';
      toast('Key dihapus');
      dom.settingsModal.classList.remove('active');
    }
  });
  
  // Close modals
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.remove('active');
    });
  });
  
  // Upload screenshot
  dom.dropzone.addEventListener('click', () => dom.fileInput.click());
  dom.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); });
  dom.dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processScreenshot(file);
  });
  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) processScreenshot(e.target.files[0]);
  });
  dom.removePreview.addEventListener('click', () => {
    state.screenshot1 = null;
    dom.previewContainer.style.display = 'none';
    dom.dropzone.style.display = 'block';
  });
  
  async function processScreenshot(file) {
    try {
      const compressed = await compressImage(file);
      const b64 = await blobToBase64(compressed);
      state.screenshot1 = b64;
      // tampilkan preview
      const url = URL.createObjectURL(compressed);
      dom.previewImage.src = url;
      dom.previewContainer.style.display = 'block';
      dom.dropzone.style.display = 'none';
      toast('✅ Screenshot siap');
    } catch (e) {
      toast('❌ Gagal proses gambar', 'error');
    }
  }
  
  // Shortcut keyboard
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      analyzeNow();
    } else if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      dom.fileInput.click();
    } else if (e.ctrlKey && e.key === '1') {
      e.preventDefault();
      dom.instrumentSelect.value = 'XAUUSD';
      state.instrument = 'XAUUSD';
    } else if (e.ctrlKey && e.key === '2') {
      e.preventDefault();
      dom.instrumentSelect.value = 'BTCUSD';
      state.instrument = 'BTCUSD';
    }
  });
  
  // Copy buttons delegation
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn-copy')) {
      const btn = e.target.closest('.btn-copy');
      const val = btn.getAttribute('data-value');
      if (val && val !== '--') copyToClipboard(val);
    }
  });
  
  // Initial check API key
  const encrypted = getEncryptedKey();
  if (encrypted) {
    dom.apiStatusText.textContent = 'Tersimpan & Terenkripsi';
    dom.apiStatusText.style.color = 'var(--success)';
  }
  
  // Load threshold
  const savedThreshold = localStorage.getItem('confidence_threshold');
  if (savedThreshold) state.confidenceThreshold = parseInt(savedThreshold);
  
  // Load history
  updateHistory();
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupEventListeners();
});
