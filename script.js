const SVG_NS = "http://www.w3.org/2000/svg";

const COMPONENT_INFO = {
  nic:  { name: "NIC",           story: "我是網路大門，負責接收與送出封包。",
          engineer: "NIC (Network Interface Card)：負責乙太網路封包的收發，透過匯流排與主機板溝通，吞吐量與延遲直接影響對外服務效能。" },
  cpu:  { name: "CPU",           story: "我是伺服器的大腦，負責思考、運算所有事情。",
          engineer: "CPU：執行運算指令，時脈與核心數影響效能，過熱會自動降頻甚至關機保護。" },
  dimm: { name: "DIMM",          story: "我是大腦的短期記憶，讓 CPU 能快速存取資料。",
          engineer: "DIMM（記憶體模組）：提供揮發性儲存空間供 CPU 即時存取，多數伺服器支援多通道與 ECC 錯誤更正。" },
  pcie: { name: "PCIe Slot",     story: "我是高速公路，讓資料快速在部件之間傳輸。",
          engineer: "PCIe：提供高速匯流排介面，連接 GPU、HBA、NIC 等擴充卡，頻寬依代數與通道數決定。" },
  gpu:  { name: "GPU",           story: "我是平行運算高手，同時處理大量計算工作。",
          engineer: "GPU：內含大量平行運算核心，適合矩陣運算、AI 推論與圖形算圖，功耗與散熱需求通常高於 CPU。" },
  hba:  { name: "HBA",           story: "我是儲存資料的傳送手，把資料安全送到硬碟陣列。",
          engineer: "HBA (Host Bus Adapter)：提供伺服器與外部儲存裝置之間的資料通道，通常搭配 RAID 控制器一起運作。" },
  raid: { name: "RAID Controller", story: "我是硬碟們的指揮官，讓多顆硬碟同步合作。",
          engineer: "RAID Controller：管理多顆硬碟組成邏輯磁碟陣列（如 RAID 1/5/6/10），提供容錯與效能提升，寫入時同步操作陣列中的多顆硬碟。" },
  drive:{ name: "Drive Bay",     story: "我是長期記憶抽屜，資料放在這裡不會不見。",
          engineer: "Drive Bay：安裝硬碟或 SSD 的插槽，通常支援熱插拔，可組成 RAID 陣列以提升效能或容錯能力。" },
  psu:  { name: "PSU",           story: "我是心臟，把電力平均送到全身每個部件。",
          engineer: "PSU：將市電轉換為系統所需直流電，通常配置 N+1 或 N+N 備援，任一顆故障時系統可自動切換至另一顆維持運作。" },
  fan:  { name: "Fan",           story: "我是呼吸系統，幫大家把熱氣呼出去、保持涼爽。",
          engineer: "Fan：提供機殼氣流，將 CPU / 記憶體 / 硬碟產生的熱能排出，多顆風扇互為備援；轉速會隨全機功耗自動調整。" }
};

/* ---------------- 功耗模型（W） ---------------- */
const POWER_TABLE = {
  nic:   { idle: 5,  active: 12 },
  cpu:   { idle: 25, active: 70 },
  dimm:  { idle: 2,  active: 4  },
  pcie:  { idle: 1,  active: 9  },
  gpu:   { idle: 20, active: 160 },
  hba:   { idle: 6,  active: 12 },
  raid:  { idle: 6,  active: 10 },
  drive: { idle: 4,  active: 6  },
  fan:   { idle: 4,  active: 0  }
};
const POWER_MIN_REF = 100;   // 對應風扇「慢速」基準
const POWER_MAX_REF = 460;   // 對應風扇「全速」基準
const FAN_DURATION_SLOW = 1.6;  // 秒（轉速慢）
const FAN_DURATION_FAST = 0.32; // 秒（轉速快）

const state = {};
let workflowRunning = false;
let cancelWorkflow = false;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function makePartGroup(type, index) {
  const g = svgEl('g', { class: 'part-group' });
  g.id = `${type}${index}`;
  g.dataset.type = type;
  g.dataset.index = index;
  g.addEventListener('click', () => selectComponent(type, index, g));
  state[g.id] = { type, index, faulted: false };
  return g;
}

/* ---- Zone1: Drives ×8 ---- */
const driveGroup = document.getElementById('driveGroup');
for (let i = 0; i < 8; i++) {
  const x = 32 + i * 30, y = 55;
  const g = makePartGroup('drive', i);
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: 24, height: 350, rx: 4 }));
  g.appendChild(svgEl('circle', { class: 'led', cx: x + 12, cy: y + 16, r: 3 }));
  const t = svgEl('text', { class: 'part-label', x: x + 12, y: y + 40, 'text-anchor': 'middle' });
  t.textContent = `B${i+1}`;
  g.appendChild(t);
  driveGroup.appendChild(g);
}

/* ---- Zone2: Fans ×6 ---- */
const fanGroup = document.getElementById('fanGroup');
for (let i = 0; i < 6; i++) {
  const col = i % 2, row = Math.floor(i / 2);
  const cx = 330 + col * 80, cy = 110 + row * 105;
  const g = makePartGroup('fan', i);
  g.appendChild(svgEl('circle', { class: 'part-shape', cx, cy, r: 26 }));
  g.appendChild(svgEl('circle', { class: 'fan-hub', cx, cy, r: 6 }));
  const blade = svgEl('g', { class: 'fan-blade' });
  for (let b = 0; b < 3; b++) {
    blade.appendChild(svgEl('ellipse', { cx, cy, rx: 16, ry: 5, transform: `rotate(${b*120} ${cx} ${cy})`, fill: '#3a4763', opacity: 0.85 }));
  }
  g.appendChild(blade);
  fanGroup.appendChild(g);
}

/* ---- Zone3: Board — 左DIMM×4 / CPU / 右DIMM×4 / NIC ---- */
const boardGroup = document.getElementById('boardGroup');
for (let i = 0; i < 4; i++) {
  const x = 470, y = 55 + i * 80;
  const g = makePartGroup('dimm', i);
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: 75, height: 22, rx: 3 }));
  g.appendChild(svgEl('rect', { class: 'dimm-flow-bar', x, y: y+2, width: 15, height: 18 }));
  const t = svgEl('text', { class: 'part-label', x: x + 37, y: y + 15, 'text-anchor': 'middle' });
  t.textContent = `DIMM ${i+1}`;
  g.appendChild(t);
  boardGroup.appendChild(g);
}
{
  const g = makePartGroup('cpu', 0);
  const x = 555, y = 145, size = 90, cx = x + size/2, cy = y + size/2;
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: size, height: size, rx: 6 }));
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    g.appendChild(svgEl('circle', { cx: cx - 30 + c*12, cy: cy - 30 + r*12, r: 1.4, fill: '#4a5978' }));
  }
  const t = svgEl('text', { class: 'part-label', x: cx, y: y + size + 16, 'text-anchor': 'middle', style: 'font-size:12px;fill:var(--accent)' });
  t.textContent = 'CPU';
  g.appendChild(t);
  boardGroup.appendChild(g);
}
for (let i = 4; i < 8; i++) {
  const x = 655, y = 55 + (i-4) * 80;
  const g = makePartGroup('dimm', i);
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: 80, height: 22, rx: 3 }));
  g.appendChild(svgEl('rect', { class: 'dimm-flow-bar', x, y: y+2, width: 15, height: 18 }));
  const t = svgEl('text', { class: 'part-label', x: x + 40, y: y + 15, 'text-anchor': 'middle' });
  t.textContent = `DIMM ${i+1}`;
  g.appendChild(t);
  boardGroup.appendChild(g);
}
{
  const g = makePartGroup('nic', 0);
  const x = 555, y = 340, w = 150, h = 40;
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: w, height: h, rx: 5 }));
  g.appendChild(svgEl('circle', { class: 'packet-dot', cx: x + 14, cy: y + h/2, r: 5 }));
  const t = svgEl('text', { class: 'part-label', x: x + w/2 + 10, y: y + h/2 + 4, 'text-anchor': 'middle' });
  t.textContent = 'NIC';
  g.appendChild(t);
  boardGroup.appendChild(g);
}

/* ---- Zone4: PCIe ×4 ---- */
const pcieGroup = document.getElementById('pcieGroup');
for (let i = 0; i < 4; i++) {
  const x = 775, y = 45 + i * 50;
  const g = makePartGroup('pcie', i);
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: 150, height: 24, rx: 3 }));
  const t = svgEl('text', { class: 'part-label', x: x + 75, y: y + 16, 'text-anchor': 'middle' });
  t.textContent = `PCIe Slot ${i+1}`;
  g.appendChild(t);
  pcieGroup.appendChild(g);
}

/* ---- Zone5: 擴充卡 — GPU / HBA / RAID ---- */
const addinGroup = document.getElementById('addinGroup');
{
  const g = makePartGroup('gpu', 0);
  const x = 955, y = 45, w = 150, h = 70;
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: w, height: h, rx: 5 }));
  for (let i = 0; i < 6; i++) {
    const bar = svgEl('rect', { class: 'gpu-bar', x: x + 12 + i*22, y: y + h - 15, width: 8, height: 12 });
    bar.style.animationDelay = `${i * 0.07}s`;
    g.appendChild(bar);
  }
  const t = svgEl('text', { class: 'part-label', x: x + w/2, y: y + h/2 + 4, 'text-anchor': 'middle' });
  t.textContent = 'GPU';
  g.appendChild(t);
  addinGroup.appendChild(g);
}
{
  const g = makePartGroup('hba', 0);
  const x = 955, y = 130, w = 150, h = 70;
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: w, height: h, rx: 5 }));
  const t = svgEl('text', { class: 'part-label', x: x + w/2, y: y + h/2 + 4, 'text-anchor': 'middle' });
  t.textContent = 'HBA';
  g.appendChild(t);
  addinGroup.appendChild(g);
}
{
  const g = makePartGroup('raid', 0);
  const x = 955, y = 215, w = 150, h = 70;
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: w, height: h, rx: 5 }));
  const t = svgEl('text', { class: 'part-label', x: x + w/2, y: y + h/2 + 4, 'text-anchor': 'middle' });
  t.textContent = 'RAID Ctrl';
  g.appendChild(t);
  addinGroup.appendChild(g);
}

/* ---- Zone6: PSU ×2 ---- */
const psuGroup = document.getElementById('psuGroup');
for (let i = 0; i < 2; i++) {
  const x = 1135 + i * 75, y = 200, w = 65, h = 140;
  const g = makePartGroup('psu', i);
  g.appendChild(svgEl('rect', { class: 'part-shape', x, y, width: w, height: h, rx: 4 }));
  g.appendChild(svgEl('circle', { class: 'status-dot', cx: x + 14, cy: y + 14, r: 4 }));
  const t = svgEl('text', { class: 'part-label', x: x + w/2, y: y + 74, 'text-anchor': 'middle' });
  t.textContent = `PSU ${i+1}`;
  g.appendChild(t);
  psuGroup.appendChild(g);
}

/* ---------------- 選取與 Tooltip ---------------- */
function selectComponent(type, index, g) {
  document.querySelectorAll('.part-group.selected').forEach(p => p.classList.remove('selected'));
  g.classList.add('selected');
  renderPanel(type, index);
}
function renderPanel(type, index) {
  const info = COMPONENT_INFO[type];
  const key = `${type}${index}`;
  const s = state[key];
  const displayName = `${info.name}${(type === 'cpu' || type === 'nic' || type === 'gpu' || type === 'hba' || type === 'raid') ? '' : ' #' + (index + 1)}`;
  let statusHtml = '';
  if (type === 'drive') statusHtml = s.faulted ? `<div class="status-line fault">⚠ 硬碟故障，資料存取異常（不計入功耗）</div>` : `<div class="status-line ok">✅ 正常運作中</div>`;
  if (type === 'fan')   statusHtml = s.faulted ? `<div class="status-line fault">⚠ 風扇停轉，散熱能力下降</div>` : `<div class="status-line ok">✅ 轉速依全機功耗自動調整</div>`;
  if (type === 'psu')   statusHtml = s.faulted ? `<div class="status-line fault">⚠ PSU 故障 → 已觸發冗餘切換</div>` : `<div class="status-line ok">✅ 供電正常</div>`;

  document.getElementById('panel').innerHTML = `
    <h2>${displayName}</h2>
    <div class="sub">點選部件即時說明</div>
    <div class="block"><span class="label">🗣 一句話說明</span>${info.story}</div>
    <div class="block"><span class="label">🔧 工程師版說明</span>${info.engineer}${statusHtml}</div>
  `;
}

/* ---------------- 故障模擬 ---------------- */
function simulateFault(type) {
  const keys = Object.keys(state).filter(k => state[k].type === type && !state[k].faulted);
  if (keys.length === 0) { alert(`所有 ${type} 都已經是故障狀態囉，先按「重置」再試一次。`); return; }
  const key = keys[Math.floor(Math.random() * keys.length)];
  state[key].faulted = true;
  const g = document.getElementById(key);
  g.classList.add('fault');
  if (type === 'psu') document.querySelectorAll('[id^="psu"]').forEach(p => { if (p.id !== key) p.classList.add('active-backup'); });
  selectComponent(state[key].type, state[key].index, g);
}
function resetAll() {
  cancelWorkflow = true; workflowRunning = false;
  setWorkflowButtonState(false);
  document.getElementById('powerBus').classList.remove('boost');
  document.getElementById('workflowBanner').style.display = 'none';
  Object.keys(state).forEach(key => {
    state[key].faulted = false;
    const g = document.getElementById(key);
    g.classList.remove('fault', 'selected', 'active-backup', 'active', 'flow', 'flash', 'raid-active');
  });
  document.getElementById('panel').innerHTML = `<div class="empty-hint">👉 點選左方任一伺服器部件，這裡會顯示說明。</div>`;
}

/* ---------------- 即時功耗計算 + 風扇轉速連動 ---------------- */
function calcTotalPower() {
  let total = 0;
  Object.keys(state).forEach(key => {
    const s = state[key];
    const table = POWER_TABLE[s.type];
    if (!table) return;
    // 故障的硬碟/風扇視為離線，不貢獻功耗
    if (s.faulted) return;
    const g = document.getElementById(key);
    let isActive = false;
    if (s.type === 'dimm') isActive = g.classList.contains('flow');
    else if (s.type === 'pcie') isActive = g.classList.contains('flash');
    else if (s.type === 'drive') isActive = g.classList.contains('raid-active');
    else isActive = g.classList.contains('active');
    total += table.idle + (isActive ? table.active : 0);
  });
  return Math.round(total);
}

function updatePowerAndFans() {
  const total = calcTotalPower();
  const ratio = Math.max(0, Math.min(1, (total - POWER_MIN_REF) / (POWER_MAX_REF - POWER_MIN_REF)));
  const fanDuration = FAN_DURATION_SLOW - ratio * (FAN_DURATION_SLOW - FAN_DURATION_FAST);

  // 更新功耗表 UI
  document.getElementById('powerValue').textContent = total;
  document.getElementById('powerBarFill').style.width = `${Math.round(ratio * 100)}%`;
  document.getElementById('fanSpeedTag').textContent =
    ratio < 0.15 ? '待機（低轉速）' : ratio < 0.55 ? '一般負載（中轉速）' : ratio < 0.85 ? '高負載（高轉速）' : '滿載（全速運轉）';

  // 依總功耗即時設定每顆「未故障」風扇的旋轉週期
  document.querySelectorAll('.part-group[data-type="fan"]').forEach(fanG => {
    const blade = fanG.querySelector('.fan-blade');
    if (!blade) return;
    if (fanG.classList.contains('fault')) return; // 故障風扇維持停轉
    blade.style.animationDuration = `${fanDuration.toFixed(2)}s`;
  });
}
setInterval(updatePowerAndFans, 250);
updatePowerAndFans(); // 初始化立即跑一次

/* ---------------- 工作流程 ---------------- */
function narrate(msg) {
  const b = document.getElementById('workflowBanner');
  b.textContent = msg;
  b.style.display = 'block';
}
let activeTimeoutId = null;

const ALL_DIMM = ['dimm0','dimm1','dimm2','dimm3','dimm4','dimm5','dimm6','dimm7'];
const ALL_PCIE = ['pcie0','pcie1','pcie2','pcie3'];
const ALL_DRIVE = ['drive0','drive1','drive2','drive3','drive4','drive5','drive6','drive7'];
const ALL_PSU = ['psu0','psu1'];
/* ---------------- 4 組工作流程定義 ---------------- */
const WORKFLOWS = {
  /* 📝 封包寫入 */
  write: {
    doneMsg: '✅ 寫入流程完成：封包已處理，資料已同步落地儲存。',
    steps: [
      { ids: ['nic0'], cls: 'active', msg: '📩 封包經由 NIC 進入系統。', duration: 900 },
      { ids: ['cpu0'], cls: 'active', msg: '🧠 CPU 接收封包並執行運算指令。', duration: 900 },
      { ids: ALL_DIMM, cls: 'flow', msg: '💾 CPU 透過 DIMM 交換運算所需的資料。', duration: 900 },
      { ids: ALL_PCIE, cls: 'flash', msg: '⚡ 資料經由 PCIe 高速通道傳輸。', duration: 800 },
      { ids: ['gpu0'], cls: 'active', msg: '🎮 GPU 加速運算，處理封包內容。', duration: 1000 },
      { ids: ['hba0'], cls: 'active', msg: '🔌 資料經由 HBA 通道送往儲存子系統。', duration: 900 },
      { ids: ['raid0'], cls: 'active', msg: '🗄 RAID 控制器啟動，準備同步寫入。', duration: 500 },
      { ids: ALL_DRIVE, cls: 'raid-active', msg: '💽 多顆硬碟同步寫入資料。', duration: 1200 }
    ]
  },

  /* 📖 資料讀取回應 — 大致是寫入的逆向路徑，且不需要 GPU */
  read: {
    doneMsg: '✅ 讀取流程完成：資料已組成回應，透過 NIC 送出。',
    steps: [
      { ids: ['nic0'], cls: 'active', msg: '📩 讀取請求經由 NIC 進入系統。', duration: 700 },
      { ids: ['cpu0'], cls: 'active', msg: '🧠 CPU 解析讀取請求。', duration: 700 },
      { ids: ['raid0'], cls: 'active', msg: '🗄 RAID 控制器定位資料所在位置。', duration: 500 },
      { ids: ALL_DRIVE, cls: 'raid-active', msg: '💽 多顆硬碟同步讀取資料。', duration: 1100 },
      { ids: ['hba0'], cls: 'active', msg: '🔌 資料經由 HBA 通道送回主機板。', duration: 800 },
      { ids: ALL_PCIE, cls: 'flash', msg: '⚡ 資料經由 PCIe 高速通道傳輸。', duration: 800 },
      { ids: ALL_DIMM, cls: 'flow', msg: '💾 資料暫存於 DIMM，等待 CPU 組裝回應。', duration: 900 },
      { ids: ['cpu0'], cls: 'active', msg: '🧠 CPU 組裝回應內容。', duration: 700 },
      { ids: ['nic0'], cls: 'active', msg: '📤 回應經由 NIC 送出。', duration: 700 }
    ]
  },

  /* 🧠 AI 推論運算 — 純運算，完全不碰硬碟，GPU 是重點 */
  compute: {
    doneMsg: '✅ 推論完成：運算結果已透過 NIC 回傳。',
    steps: [
      { ids: ['nic0'], cls: 'active', msg: '📩 運算請求經由 NIC 進入系統。', duration: 700 },
      { ids: ['cpu0'], cls: 'active', msg: '🧠 CPU 準備任務並分派給 GPU。', duration: 700 },
      { ids: ALL_DIMM, cls: 'flow', msg: '💾 模型參數從 DIMM 載入。', duration: 1000 },
      { ids: ALL_PCIE, cls: 'flash', msg: '⚡ 資料經由 PCIe 傳輸至 GPU。', duration: 700 },
      { ids: ['gpu0'], cls: 'active', msg: '🎮 GPU 執行大量平行運算（推論中）。', duration: 1800 },
      { ids: ALL_PCIE, cls: 'flash', msg: '⚡ 運算結果經由 PCIe 傳回主機板。', duration: 700 },
      { ids: ['cpu0'], cls: 'active', msg: '🧠 CPU 整理最終結果。', duration: 700 },
      { ids: ['nic0'], cls: 'active', msg: '📤 結果經由 NIC 回傳給使用者。', duration: 700 }
    ]
  },

  /* 🔌 開機自檢 — 各部件依序被喚醒 */
  boot: {
    doneMsg: '✅ 開機自檢完成：系統已就緒。',
    steps: [
      { ids: ALL_PSU, cls: 'active', msg: '🔋 PSU 啟動供電，電力匯流排開始運作。', duration: 800 },
      { ids: ['cpu0'], cls: 'active', msg: '🧠 CPU 執行開機自檢（POST）。', duration: 800 },
      { ids: ALL_DIMM, cls: 'flow', msg: '💾 記憶體測試中，逐條 DIMM 檢查。', duration: 1000 },
      { ids: ALL_PCIE, cls: 'flash', msg: '⚡ PCIe 裝置列舉，偵測擴充卡。', duration: 800 },
      { ids: ALL_DRIVE, cls: 'raid-active', msg: '💽 硬碟偵測與健康檢查。', duration: 1000 },
      { ids: ['nic0'], cls: 'active', msg: '🔗 NIC 連結建立，網路埠燈號亮起。', duration: 700 }
    ]
  }
};

function toggleWorkflow() {
  if (workflowRunning) {
    stopWorkflow();
    return;
  }
  const key = document.getElementById('workflowSelect').value;
  const wf = WORKFLOWS[key];
  if (!wf) return;
  runWorkflowSteps(wf.steps, wf.doneMsg);
}

function setWorkflowButtonState(running) {
  const btn = document.getElementById('workflowBtn');
  if (running) {
    btn.textContent = '⏹ 停止工作流程';
    btn.classList.remove('primary');
    btn.classList.add('stop');
  } else {
    btn.textContent = '▶ 執行工作流程';
    btn.classList.remove('stop');
    btn.classList.add('primary');
  }
}

function runStepAt(steps, index, doneMsg) {
  if (cancelWorkflow || index >= steps.length) {
    narrate(cancelWorkflow ? '⏹ 工作流程已被中止。' : doneMsg);
    document.getElementById('powerBus').classList.remove('boost');
    workflowRunning = false;
    setWorkflowButtonState(false);
    return;
  }

  const step = steps[index];
  narrate(step.msg);
  step.ids.forEach(id => { const g = document.getElementById(id); if (g) g.classList.add(step.cls); });

  activeTimeoutId = setTimeout(() => {
    activeTimeoutId = null;
    step.ids.forEach(id => { const g = document.getElementById(id); if (g) g.classList.remove(step.cls); });
    runStepAt(steps, index + 1, doneMsg);
  }, step.duration);
}

function runWorkflowSteps(steps, doneMsg) {
  if (workflowRunning) return;
  workflowRunning = true;
  cancelWorkflow = false;
  setWorkflowButtonState(true);
  document.getElementById('powerBus').classList.add('boost');
  runStepAt(steps, 0, doneMsg);
}
function cancelActiveWait() {
  if (activeTimeoutId !== null) {
    clearTimeout(activeTimeoutId);
    activeTimeoutId = null;
  }
}
function stopWorkflow() {
  cancelWorkflow = true;
  cancelActiveWait();
  document.getElementById('powerBus').classList.remove('boost');
  workflowRunning = false;
  setWorkflowButtonState(false);
  narrate('⏹ 工作流程已被中止。');
}