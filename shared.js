
const WORKER_API = window.APP_CONFIG.WORKER_API;

let firstSearchDone = false;
let enablePrint = false;
let scanTimer;

function apiUrl(path) {
  return WORKER_API.replace(/\/$/, "") + path;
}

async function apiJson(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiText(path, options = {}) {
  const res = await fetch(apiUrl(path), options);
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth <= 768;
}

function safeEl(id) {
  return document.getElementById(id);
}

function setDisplay(id, value) {
  const el = safeEl(id);
  if (el) el.style.display = value;
}

function setText(id, text, isHTML = false) {
  const el = safeEl(id);
  if (!el) return;
  if (isHTML) el.innerHTML = text;
  else el.textContent = text;
}

function blockUI(state) {
  const blocker = safeEl("uiBlocker");
  if (blocker) blocker.style.display = state ? "block" : "none";
}

function showLoader() {
  const spinner = safeEl("globalSpinner");
  if (spinner) spinner.style.display = "flex";
  blockUI(true);
}

function hideLoader() {
  const spinner = safeEl("globalSpinner");
  if (spinner) spinner.style.display = "none";
  blockUI(false);
}

function setAllButtonsDisabled(state) {
  document.querySelectorAll("button, input[type=button]").forEach(btn => {
    btn.disabled = state;
  });
}

function getActiveSearchInput() {
  const inputs = document.querySelectorAll("#searchTerm");
  for (const input of inputs) {
    if (input.offsetParent !== null) return input;
  }
  return safeEl("searchTerm");
}

function updatePlaceholder() {
  const option = safeEl("searchOption")?.value || "DEFAULT";
  const input = safeEl("searchTerm");
  if (!input) return;

  const map = {
    A: "Enter Team Name",
    E: "Enter full email",
    F: "Enter BIB number",
    G: "Reg ID, MyKad, Name, Bib"
  };
  input.placeholder = map[option] || "Reg ID, MyKad or Name";
}

function handleEnter(event) {
  if (event.key === "Enter") {
    if (!isMobileDevice()) return;
    event.preventDefault();
    search();
  }
}

async function search(customValue) {
  const input = getActiveSearchInput();
  if (!input) return;
  input.blur();

  const searchTerm = customValue || input.value.trim();
  const searchOption = safeEl("searchOption")?.value || "DEFAULT";
  const searchButton = safeEl("searchButton");

  if (searchTerm === "") {
    setText("result", "<span style='color:red;'>Please enter something to search.</span>", true);
    setDisplay("clearButtonContainer", "none");
    setDisplay("collectBoxes", "none");
    return;
  }

  showLoader();
  setAllButtonsDisabled(true);
  if (searchButton) searchButton.innerHTML = '<i class="bi bi-arrow-repeat spin" style="font-size:25px"></i>';

  try {
    const html = await apiText(`/search?ic=${encodeURIComponent(searchTerm)}&mode=${encodeURIComponent(searchOption)}`);
    showResult(html);
    firstSearchDone = true;
  } catch (err) {
    console.error(err);
    setText("result", "<span style='color:red;'>Server error / CORS error</span>", true);
  } finally {
    hideLoader();
    setAllButtonsDisabled(false);
    if (searchButton) searchButton.innerHTML = '<i class="bi bi-search"></i>';
    syncCollectButton();
  }
}

function showResult(result) {
  setText("result", result, true);

  document.querySelectorAll(".result-item.selectable").forEach(card => {
    card.addEventListener("click", function () {
      this.classList.toggle("selected");
    });
  });

  const count = document.getElementsByClassName("result-item").length;
  setText("resultCount", "Find: " + count);

  const selectAllBtn = safeEl("selectAllBtn");
  const searchOption = safeEl("searchOption")?.value || "DEFAULT";

  if (count > 0 && searchOption !== "G") {
    if (selectAllBtn) selectAllBtn.style.display = "flex";
    setDisplay("collectBoxes", "block");
    setDisplay("collectButton", "inline-block");
    setDisplay("holdButton", "inline-block");
  } else {
    if (selectAllBtn) selectAllBtn.style.display = "none";
    setDisplay("collectBoxes", "none");
    setDisplay("collectButton", "none");
    setDisplay("holdButton", "none");
  }

  setDisplay("clearButtonContainer", result ? "block" : "none");
}

function clearSearch() {
  const input = safeEl("searchTerm");
  if (input) input.value = "";
  setText("result", "", true);
  setText("resultCount", "");
  const c1 = safeEl("collectBy1");
  const c2 = safeEl("collectBy2");
  if (c1) c1.value = "";
  if (c2) c2.value = "";
  setDisplay("collectBoxes", "none");
  setDisplay("collectButton", "none");
  setDisplay("holdButton", "none");
  setDisplay("selectAllBtn", "none");
  setDisplay("clearButtonContainer", "none");
  const msg = safeEl("message");
  if (msg) {
    msg.innerHTML = "";
    msg.style.display = "none";
  }
  hideLoader();
  firstSearchDone = false;
}

function getCollectByText(a, b) {
  a = (a || "").trim();
  b = (b || "").trim();
  if (a && b) return `${a} (${b})`;
  return a || b || "";
}

function normalizeCollectRows(rows) {
  return rows.map(r => ({
    row: r.row,
    user: (r.user || r.userProfile || localStorage.getItem("userProfile") || "SYSTEM").toUpperCase(),
    collectBy: r.collectBy || getCollectByText(r.collectBy1, r.collectBy2)
  }));
}

// GET PRINT DATA FROM COLLECT FOR SIZE
function getSelectedPrintData(selectedCards) {
  return Array.from(selectedCards).map(card => ({
    valueBIB: card.querySelector(".bib-number")?.textContent?.trim() || "",
    valueSIZE: (card.querySelector(".bib-size")?.textContent || "").replace(/^\s*\/\s*/, "").trim()
  }));
}

// GET PRINT DATA FROM COLLECTHOLD FOR SIZE
function getHoldPrintData(container) {
  return Array.from(container.querySelectorAll(".hold-item")).map(item => ({
    valueBIB: item.querySelector(".hold-bib")?.textContent?.trim() || "",
    valueSIZE: item.querySelector(".hold-size")?.textContent?.trim() || ""
  }));
}

async function collectRows(markedRows) {
  return apiJson("/collect", {
    method: "POST",
    body: JSON.stringify({ rows: normalizeCollectRows(markedRows) })
  });
}

async function collect() {
  if (hasHold()) {
    const warnSound = safeEl("warnSound");
    if (warnSound) {
      warnSound.currentTime = 0;
      warnSound.play();
    }
    const msg = safeEl("message");
    if (msg) {
      msg.innerHTML = `<div style="padding:12px;border:2px solid red;background:#fff;color:red;font-weight:bold;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);">⚠️ YOU HAVE HOLD DATA</div>`;
      msg.style.display = "block";
      setTimeout(() => {
        msg.innerHTML = "";
        msg.style.display = "none";
      }, 3000);
    }
    return;
  }

  const collectButton = safeEl("collectButton");
  const selected = document.querySelectorAll(".result-item.selected");
  const collectBy1 = safeEl("collectBy1")?.value.trim() || "";
  const collectBy2 = safeEl("collectBy2")?.value.trim() || "";
  const markSound = safeEl("markSound");
  const warnSound = safeEl("warnSound");
  const userProfile = localStorage.getItem("userProfile") || "";
  const resultContainer = safeEl("result");
  const messageContainer = safeEl("message");

  if ((collectBy1 && !collectBy2) || (!collectBy1 && collectBy2)) {
    if (messageContainer) {
      messageContainer.innerHTML = '<div style="padding:10px; border:1px solid red; color:red; font-weight:bold; background:white; box-shadow:0 4px 12px rgba(0,0,0,0.2);">User ERROR woi!</div>';
      messageContainer.style.display = "block";
    }
    if (warnSound) warnSound.play();
    if (collectButton) collectButton.value = "Collect";
    setAllButtonsDisabled(false);
    return;
  } else if (messageContainer) {
    messageContainer.innerHTML = "";
  }

  const markedRows = Array.from(selected).map(el => ({
    row: el.dataset.row,
    collectBy1,
    collectBy2,
    userProfile
  }));

  if (!markedRows.length) return;

  const printData = getSelectedPrintData(selected);

  setAllButtonsDisabled(true);
  if (collectButton) collectButton.value = "Collecting...";

  try {
    const res = await collectRows(markedRows);
    if (!res.success && res.error) throw new Error(res.error);
// new data line pass to collect result card
    const printData = getSelectedPrintData(selected);
    
    const collectSummary = printData.map(item =>
      `${item.valueBIB} ${item.valueSIZE ? "(" + item.valueSIZE + ")" : ""}`.trim()
    );
// new data end
    if (resultContainer) {
      resultContainer.innerHTML = '<div style="padding:10px; border:1px solid green; color:green; font-weight:bold;">✅ SUCCESSFULL</div>';
    }

    if (!isMobileDevice() && enablePrint) {
      const htmlContent = `
        <html><body style="font-size:18px;">
          <ul style="padding-left:20px; font-family:Arial;">
            ${printData.map(item => `<li>${item.valueBIB} (${item.valueSIZE})</li>`).join("")}
          </ul>
          <div style="margin-top:15px; font-size:14px;">${userProfile.toUpperCase()}</div>
          <div>----------</div>
        </body></html>`;
      const printWindow = window.open("", "", "width=300,height=400");
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.print();
      printWindow.close();
    }

    if (markSound) markSound.play();
 //   setTimeout(() => {
 //     clearSearch();
 //     loadSummaryCard();
//    }, 5000);
    showCollectSuccessCard(collectSummary, () => {
      clearSearch();
      loadSummaryCard();
    });
  } catch (err) {
    console.error(err);
    if (resultContainer) resultContainer.innerHTML = '<div style="padding:10px; border:1px solid red; color:red; font-weight:bold;">❌ Collect failed</div>';
  } finally {
    if (collectButton) collectButton.value = "Collect";
    setAllButtonsDisabled(false);
  }
}

// AFTER COLLECT RESULT CARD
function showCollectSuccessCard(dataList, onDismiss) {
  const resultContainer = safeEl("result");
  if (!resultContainer) return;

  const sizeMap = {};

  const items = (dataList || []).map(item => {
    let bib = "";
    let size = "";

    const match = item.match(/\((.*?)\)/);
    if (match) size = (match[1] || "").trim();

    const cleaned = item.replace(/\(.*?\)/g, "").trim();
    bib = cleaned;

    const s = size.toLowerCase();

    // COUNT SIZE (ignore invalid)
if (size) {
  const raw = size.toLowerCase().trim();

  if (!["na", "n/a", "nil", "-"].includes(raw)) {
    const normalized = normalizeSize(size);
    sizeMap[normalized] = (sizeMap[normalized] || 0) + 1;
  }
}

    return `
      <div style="
        display:flex;
        justify-content:space-between;
        padding:6px 0;
        border-bottom:1px solid rgba(0,0,0,0.06);
        font-size:15px;
        font-weight:600;
      ">
        <span>${bib}</span>
        <span style="opacity:0.7;">${size || "-"}</span>
      </div>
    `;
  }).join("");

  // SORT SIZE (AUTO SMART)
  const sizeKeys = Object.keys(sizeMap)
    .filter(k => k && !["na", "n/a", "nil", "-"].includes(k.toLowerCase()))
    .sort((a, b) => getSizeValue(a) - getSizeValue(b));

  let summaryText = "";

  if (sizeKeys.length > 1) {
    summaryText = sizeKeys
      .map(k => `${k} (${sizeMap[k]})`)
      .join(" / ");
  }

  resultContainer.innerHTML = `
    <div id="collectSuccessCard" style="
      padding:15px;
      border:1px solid #28a745;
      background:#eaffea;
      color:#1b5e20;
      border-radius:10px;
      box-shadow:0 6px 18px rgba(0,0,0,0.15);
      margin-top:10px;
      cursor:pointer;
    ">

      <div style="
        font-size:18px;
        margin-bottom:10px;
        text-align:center;
        font-weight:bold;
      ">
        SUCCESSFULLY COLLECTED
      </div>

      <div style="
        background:#ffffffaa;
        padding:10px;
        border-radius:8px;
      ">
        ${items}

        <div style="
          margin-top:10px;
          text-align:right;
          font-size:13px;
          font-weight:700;
          opacity:0.85;
        ">
          ${summaryText ? summaryText : ""}
        </div>
      </div>

<div class="dismiss-btn" style="
  font-size:11px;
  text-align:right;
  opacity:0.7;
  margin-top:6px;
  cursor:pointer;
">
  dismiss
</div>

    </div>
  `;

  const card = document.getElementById("collectSuccessCard");

const dismiss = () => onDismiss?.();

// remove global click (IMPORTANT)
card.onclick = null;

// only dismiss button clickable
const dismissBtn = card.querySelector(".dismiss-btn");

if (dismissBtn) {
  dismissBtn.onclick = (e) => {
    e.stopPropagation();
    dismiss();
  };
}
}

function getSizeValue(size) {
  if (!size) return 999;

  let s = size.toUpperCase().replace(/\s+/g, "");

  // =========================
  // 1. HANDLE NUMERIC FORMAT (3XL, 4XL, 2XS)
  // =========================
  const numXL = s.match(/^(\d+)XL$/);
  if (numXL) {
    return 7 + (parseInt(numXL[1], 10) - 1);
  }

  const numXS = s.match(/^(\d+)XS$/);
  if (numXS) {
    return 3 - parseInt(numXS[1], 10);
  }

  // =========================
  // 2. STANDARD SIZES
  // =========================
  const base = {
    "XXXS": 1,
    "XXS": 2,
    "XS": 3,
    "S": 4,
    "M": 5,
    "L": 6,
    "XL": 7,
    "XXL": 8,
    "XXXL": 9,
    "XXXXL": 10,
    "XXXXXL": 11,
    "XXXXXXL": 12,
    "XXXXXXXL": 13,
    "XXXXXXXXL": 14
  };

  if (base[s]) return base[s];

  // =========================
  // 3. FALLBACK (UNKNOWN SIZE)
  // =========================
  return 1000;
}

function normalizeSize(size) {
  if (!size) return "";

  let s = size.toUpperCase().replace(/\s+/g, "");

  // =========================
  // KEEP XS & XL (NO NUMBER)
  // =========================
  if (s === "XS" || s === "XL") return s;

  // =========================
  // XXXL → 3XL
  // =========================
  const xxlMatch = s.match(/^(X+)L$/);
  if (xxlMatch) {
    const count = xxlMatch[1].length;

    if (count === 1) return "XL"; // prevent 1XL
    return count + "XL";
  }

  // =========================
  // XXS → 2XS
  // =========================
  const xxsMatch = s.match(/^(X+)S$/);
  if (xxsMatch) {
    const count = xxsMatch[1].length;

    if (count === 1) return "XS"; // prevent 1XS
    return count + "XS";
  }

  // already numeric (3XL, 2XS)
  return s;
}


function togglePrint() {
  enablePrint = !enablePrint;
  const button = safeEl("printToggle");
  if (!button) return;

  if (enablePrint) {
    button.classList.remove("off");
    button.innerHTML = '<i id="printIcon" class="bi bi-toggle-on"></i> Print: <b>ON</b>';
  } else {
    button.classList.add("off");
    button.innerHTML = '<i id="printIcon" class="bi bi-toggle-off"></i> Print: <b>OFF</b>';
  }
}

function getHoldData() {
  try {
    const raw = JSON.parse(localStorage.getItem("holdData") || "null");
    if (!raw || Array.isArray(raw)) return { rows: [], collectBy1: "", collectBy2: "" };
    raw.rows = raw.rows || [];
    return raw;
  } catch {
    return { rows: [], collectBy1: "", collectBy2: "" };
  }
}

function setHoldData(data) {
  localStorage.setItem("holdData", JSON.stringify(data));
}

function hasHold() {
  const hold = getHoldData();
  return !!(hold && hold.rows && hold.rows.length > 0);
}

function holdSelection() {
  const selected = document.querySelectorAll(".result-item.selected");
  const holdData = getHoldData();

  if (selected.length === 0) {
    if (holdData.rows.length > 0) openHoldModal();
    return;
  }

  const collectBy1 = safeEl("collectBy1")?.value.trim() || "";
  const collectBy2 = safeEl("collectBy2")?.value.trim() || "";
  const existingRowIds = new Set(holdData.rows.map(r => r.row));

  selected.forEach(el => {
    if (!existingRowIds.has(el.dataset.row)) holdData.rows.push({ row: el.dataset.row });
  });

  holdData.collectBy1 = collectBy1 || holdData.collectBy1;
  holdData.collectBy2 = collectBy2 || holdData.collectBy2;
  setHoldData(holdData);

  if (safeEl("collectBy1")) safeEl("collectBy1").value = "";
  if (safeEl("collectBy2")) safeEl("collectBy2").value = "";
  if (safeEl("holdButton")) safeEl("holdButton").value = `Hold (${holdData.rows.length})`;
  syncCollectButton();
  updateOnHoldButton();
}

function updateOnHoldButton() {
  const holdData = getHoldData();
  const container = safeEl("onHoldContainer");
  const btn = safeEl("onHoldButton");
  if (!container || !btn) return;

  if (!holdData.rows.length) {
    container.style.display = "none";
    return;
  }
  btn.innerText = `${holdData.rows.length}`;
  container.style.display = "block";
}

const originalUpdateOnHoldButton = updateOnHoldButton;

updateOnHoldButton = function () {
  // call function asal dulu
  originalUpdateOnHoldButton();

  // lepas tu inject behavior baru (page ini sahaja)
  const btn = document.getElementById("onHoldButton");
  const input = document.getElementById("searchTerm");
  const container = document.getElementById("onHoldContainer");

  if (!btn || !input || !container) return;

  const visible = container.style.display !== "none";

  // show/hide button ikut container
  btn.style.display = visible ? "flex" : "none";

  // adjust input padding
  input.classList.toggle("with-hold", visible);
};


function syncCollectButton() {
  const btn = safeEl("collectButton");
  const msg = safeEl("message");
  if (!btn) return;

  if (hasHold()) {
    btn.disabled = true;
    if (msg) msg.innerHTML = '<div style="color:red;font-weight:bold;">❌ CLEAR HOLD FIRST</div>';
  } else {
    btn.disabled = false;
    if (msg) msg.innerHTML = "";
  }
}

async function openHoldModal() {
  const holdData = getHoldData();
  if (!holdData.rows.length) return;

  const rows = holdData.rows.map(d => d.row);
  showLoader();
  try {
    const resultHtml = await apiText("/hold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows })
    });

    const holdListEl = safeEl("holdList");
    if (!holdListEl) return;
    holdListEl.innerHTML = "";

    const temp = document.createElement("div");
    temp.innerHTML = String(resultHtml);

    if (holdData.rows.length > 1) {
      Array.from(temp.querySelectorAll(".hold-item")).forEach((item, index) => {
        const rowId = holdData.rows[index]?.row;
        const wrapper = document.createElement("div");
        wrapper.style.position = "relative";
        const closeBtn = document.createElement("button");
        closeBtn.innerHTML = "&times;";
        closeBtn.style = "position:absolute;top:5px;right:5px;border:none;background:transparent;color:#999;font-size:16px;cursor:pointer;";
        closeBtn.onclick = () => removeSingleHold(rowId);
        wrapper.appendChild(closeBtn);
        wrapper.appendChild(item);
        holdListEl.appendChild(wrapper);
      });
    } else {
      holdListEl.innerHTML = String(resultHtml);
    }

    if (holdData.collectBy1 || holdData.collectBy2) {
      const collectBox = document.createElement("div");
      collectBox.style = "margin-top:10px;padding:8px;background:#f5f5f5;border:1px dashed #ccc;border-radius:5px;font-size:13px;";
      collectBox.innerHTML = `Collect by: <b>${holdData.collectBy1 || "—"}</b> ${holdData.collectBy2 ? `(${holdData.collectBy2})` : ""}`;
      holdListEl.appendChild(collectBox);
    }

    setDisplay("holdModal", "block");
  } catch (err) {
    console.error(err);
    alert("Failed to load hold data");
  } finally {
    hideLoader();
  }
}

function removeHold() {
  localStorage.removeItem("holdData");
  setDisplay("holdModal", "none");
  if (safeEl("holdButton")) safeEl("holdButton").value = "Hold";
  updateOnHoldButton();
  syncCollectButton();
}

function removeSingleHold(rowId) {
  const holdData = getHoldData();
  holdData.rows = holdData.rows.filter(r => r.row !== rowId);

  if (!holdData.rows.length) {
    localStorage.removeItem("holdData");
    closeHoldModal();
  } else {
    setHoldData(holdData);
    openHoldModal();
  }

  if (safeEl("holdButton")) safeEl("holdButton").value = holdData.rows.length ? `Hold (${holdData.rows.length})` : "Hold";
  updateOnHoldButton();
  syncCollectButton();
}



async function collectHold() {
  const holdData = getHoldData();
  if (!holdData.rows.length) return;

  const userProfile = localStorage.getItem("userProfile") || "";
  const markSound = safeEl("markSound");

  const markedRows = holdData.rows.map(d => ({
    row: d.row,
    collectBy1: holdData.collectBy1 || "",
    collectBy2: holdData.collectBy2 || "",
    userProfile
  }));

  showLoader();

  try {
    const res = await collectRows(markedRows);
    if (!res.success && res.error) throw new Error(res.error);

    if (markSound) markSound.play();

// =========================
// 3. BUILD SUMMARY LIKE NORMAL COLLECT
// =========================
const holdList = safeEl("holdList");

let sizeMap = {};
let collectSummary = [];

if (holdList) {
  const items = holdList.querySelectorAll(".hold-item");

  items.forEach(item => {
    const bib = item.querySelector(".hold-bib")?.textContent?.trim() || "";
    const size = item.querySelector(".hold-size")?.textContent?.trim() || "";

    // ONLY item list
    collectSummary.push(
      `${bib} ${size ? "(" + size + ")" : ""}`.trim()
    );

    // size aggregation ONLY
    if (size) {
  const normalized = normalizeSize(size);
  sizeMap[normalized] = (sizeMap[normalized] || 0) + 1;
}
  });
}

// clean sort (natural safe)
const sizeSummary = Object.entries(sizeMap)
  .sort((a, b) => getSizeValue(a[0]) - getSizeValue(b[0]))
  .map(([k, v]) => `${k} (${v})`)
  .join(" / ");

// =========================
// 4. CLOSE MODAL CLEAN
// =========================
const modal = safeEl("holdModal");
if (modal) modal.style.display = "none";

setDisplay("modalRemoveBtn", "inline-block");
setDisplay("modalCollectBtn", "inline-block");

// =========================
// 5. CLEAR HOLD DATA FIRST
// =========================
removeHold();

// =========================
// 6. SHOW NORMAL COLLECT SUCCESS CARD
// =========================
showCollectSuccessCard(collectSummary, () => {
  clearSearch();
  loadSummaryCard();
});

  } catch (err) {
    console.error(err);
    alert("Collect hold failed");
  } finally {
    hideLoader();
  }
}





// new hold data collect for size
function loadHoldSummaryIntoModal(data) {
  const box = safeEl("holdSummaryBox");
  if (!box) return;

  box.innerHTML = `
    <div style="
      margin-top:10px;
      padding:10px;
      border:1px solid #2196f3;
      background:#e3f2fd;
      border-radius:6px;
      font-size:14px;
    ">
      <div><b>Total:</b> ${data.total || 0}</div>
      <div><b>Collected:</b> ${data.collected || 0}</div>
      <div><b>Balance:</b> ${data.balance || 0}</div>
    </div>
  `;
}



function closeHoldModal() {
  setDisplay("holdModal", "none");
}

async function showCollectedStatus() {
  const showCollected = safeEl("showCollected");
  const icon = safeEl("showCollectedIcon");
  if (icon) icon.className = "bi bi-arrow-repeat spin";

  clearSearch();
  if (showCollected) showCollected.disabled = true;

  try {
    const statusMessage = await apiText("/status");
    displayStatus(statusMessage);
  } catch (err) {
    console.error(err);
    displayStatus("<span style='color:red;'>Failed to load status</span>");
  } finally {
    if (showCollected) showCollected.disabled = false;
    if (icon) icon.className = "bi bi-journal-text";
  }
}

function displayStatus(statusMessage) {
  const container = safeEl("collectedStatusContainer");
  const status = safeEl("collectedStatus");
  if (!container || !status) return;
  status.innerHTML = statusMessage;
  status.style.height = "auto";
  status.style.maxHeight = "80vh";
  status.style.overflowY = "auto";
  container.style.display = "block";
}

function dismissCollectedStatus() {
  setDisplay("collectedStatusContainer", "none");
  setText("collectedStatus", "", true);
}

async function loadWalkinCategories() {
  const select = safeEl("walkinDistance");
  const submitBtn = safeEl("walkinSubmitBtn");
  if (!select || !submitBtn) return;

  select.innerHTML = `<option>Updating...</option>`;
  submitBtn.disabled = true;

  try {
    const res = await apiJson("/walkin-categories");
    if (!res.enabled || !res.categories || !res.categories.length) {
      select.innerHTML = `<option>NOT AVAILABLE</option>`;
      submitBtn.disabled = true;
      return;
    }

    select.innerHTML = "";
    res.categories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.value;
      opt.textContent = cat.label;
      if (cat.disabled) opt.disabled = true;
      select.appendChild(opt);
    });
    submitBtn.disabled = res.categories.every(c => c.disabled);
  } catch (err) {
    console.error(err);
    select.innerHTML = `<option>ERROR</option>`;
    submitBtn.disabled = true;
  }
}

let confirmMode = false;

function openWalkinForm() {
  setDisplay("walkinFormBox", "block");
  loadWalkinCategories();
}

function closeWalkinForm() {
  setDisplay("walkinFormBox", "none");
  const ids = ["walkinIC", "walkinName", "walkinBib", "walkinChip", "walkinContact", "walkinEmer"];
  ids.forEach(id => { const el = safeEl(id); if (el) el.value = ""; });
  const select = safeEl("walkinDistance");
  if (select) select.innerHTML = `<option>Loading...</option>`;
  confirmMode = false;
  setText("walkinError", "");
  setDisplay("walkinError", "none");
  setDisplay("confirmPreview", "none");
  setDisplay("walkinFields", "block");
  if (safeEl("walkinSubmitBtn")) safeEl("walkinSubmitBtn").innerText = "SUBMIT";
}

function submitWalkinForm() {
  const name = safeEl("walkinName")?.value.trim().toUpperCase() || "";
  const bib = safeEl("walkinBib")?.value.trim().toUpperCase() || "";
  const errorBox = safeEl("walkinError");
  const warnSound = safeEl("warnSound");
  const btn = safeEl("walkinSubmitBtn");

  if (!confirmMode) {
    if (!name || !bib) {
      if (errorBox) {
        errorBox.style.display = "block";
        errorBox.innerText = "Name & BIB required";
      }
      if (warnSound) { warnSound.currentTime = 0; warnSound.play(); }
      return;
    }

    if (errorBox) errorBox.style.display = "none";
    setDisplay("walkinFields", "none");
    const qr = safeEl("walkinQR");
    if (qr) qr.style.display = "none";
    setText("previewName", name);
    setText("previewBib", bib);
    setDisplay("confirmPreview", "block");
    if (btn) btn.innerText = "CONFIRM";
    confirmMode = true;
    return;
  }

  confirmWalkin();
}

async function confirmWalkin() {
  const ic = safeEl("walkinIC")?.value.trim() || "";
  const name = safeEl("walkinName")?.value.trim().toUpperCase() || "";
  const bib = safeEl("walkinBib")?.value.trim().toUpperCase() || "";
  const chip = safeEl("walkinChip")?.value.trim() || "";
  const contact = safeEl("walkinContact")?.value.trim() || "";
  const emergency = safeEl("walkinEmer")?.value.trim().toUpperCase() || "";
  const userProfile = localStorage.getItem("userProfile") || "";
  const distance = safeEl("walkinDistance")?.value || "5KM";
  const btn = safeEl("walkinSubmitBtn");
  const loader = safeEl("walkinLoader");
  const qr = safeEl("walkinQR");

  if (btn) btn.disabled = true;
  if (qr) qr.style.display = "none";
  if (loader) loader.style.display = "block";

  try {
    const res = await apiJson("/walkin", {
      method: "POST",
      body: JSON.stringify({ ic, name, bib, chip, contact, emergency, userProfile, distance })
    });
    if (!res.success && res.error) throw new Error(res.error);

    confirmMode = false;
    if (btn) btn.innerText = "SUBMIT";
    setDisplay("confirmPreview", "none");
    setDisplay("walkinFields", "block");
    showSuccessBox(bib, name);
    closeWalkinForm();
  } catch (err) {
    console.error(err);
    alert("Walk-in failed");
    confirmMode = false;
    if (btn) btn.innerText = "SUBMIT";
    setDisplay("confirmPreview", "none");
    setDisplay("walkinFields", "block");
  } finally {
    if (btn) btn.disabled = false;
    if (qr) qr.style.display = "block";
    if (loader) loader.style.display = "none";
  }
}

function handleCancel() {
  const btn = safeEl("walkinSubmitBtn");
  if (confirmMode) {
    setDisplay("walkinFields", "block");
    const qr = safeEl("walkinQR");
    if (qr) qr.style.display = "block";
    confirmMode = false;
    if (btn) btn.innerText = "SUBMIT";
    setDisplay("confirmPreview", "none");
    return;
  }
  closeWalkinForm();
}

function showSuccessBox(bib, name) {
  setText("successBib", bib);
  setText("successName", name);
  setDisplay("successBox", "block");
  const successSound = safeEl("successSound");
  if (successSound) {
    successSound.currentTime = 0;
    successSound.play();
  }
}

function closeSuccessBox() {
  setDisplay("successBox", "none");
  ["walkinIC", "walkinName", "walkinBib", "walkinChip", "walkinContact", "walkinEmer"].forEach(id => {
    const el = safeEl(id); if (el) el.value = "";
  });
  const select = safeEl("walkinDistance");
  if (select) select.innerHTML = `<option>Loading...</option>`;
}

function loadLogin() {
  window.location.href = "index.html";
}

async function logout() {
  setAllButtonsDisabled(true);
  const logoutBtn = safeEl("logoutBtn");
  if (logoutBtn) {
    logoutBtn.style.width = logoutBtn.offsetWidth + "px";
    logoutBtn.innerHTML = '<i class="bi bi-arrow-repeat spin" style="font-size:20px;"></i>';
  }
  const token = localStorage.getItem("sessionToken");
  try {
    if (token) await apiJson("/logout", { method: "POST", body: JSON.stringify({ token }) });
  } catch (err) {
    console.error(err);
  } finally {
    localStorage.removeItem("sessionToken");
    localStorage.removeItem("userProfile");
    loadLogin();
  }
}

function handleLogoutClick() {
  const role = (localStorage.getItem("userProfile") || "").toLowerCase();
  if (role === "admin" || role === "mod") openLogoutMenu();
  else logout();
}

function openLogoutMenu() {
  const menu = safeEl("logoutMenu");
  if (menu) menu.style.display = menu.style.display === "block" ? "none" : "block";
}

function goMonitor() {
  window.location.href = "monitor.html";
}

function goAdmin() {
  window.location.href = "admin.html";
}

function logoutFromMenu() {
  logout();
}

async function validateProtectedPage() {
  const cachedProfile = localStorage.getItem("userProfile");
  const token = localStorage.getItem("sessionToken");
  if (!safeEl("userProfile")) return;

  if (cachedProfile && token) {
    setText("userProfile", cachedProfile.toUpperCase());
    try {
      const res = await apiJson("/validate", { method: "POST", body: JSON.stringify({ token }) });
      if (!res.valid) {
        alert("Session expired or logged in on another device");
        localStorage.removeItem("sessionToken");
        localStorage.removeItem("userProfile");
        loadLogin();
      }
    } catch (err) {
      console.error(err);
      alert("Cannot validate session. Check Worker URL / CORS.");
    }
  } else {
    loadLogin();
  }

  updateOnHoldButton();
  syncCollectButton();
}

// Override Apps Script page onload before it fires.
window.onload = null;
loadSummaryCard();
window.addEventListener("load", validateProtectedPage);

window.addEventListener("storage", function(e) {
  if (e.key === "sessionToken" && !e.newValue) loadLogin();
});

document.addEventListener("DOMContentLoaded", function () {
    const secretTitle = safeEl("secretSummaryTap");
  let secretSummaryTapCount = 0;
  let secretSummaryTapTimer = null;

  if (secretTitle) {
    secretTitle.addEventListener("click", function () {
      secretSummaryTapCount++;

      clearTimeout(secretSummaryTapTimer);
      secretSummaryTapTimer = setTimeout(() => {
        secretSummaryTapCount = 0;
      }, 2000);

      if (secretSummaryTapCount >= 7) {
        secretSummaryTapCount = 0;
        clearTimeout(secretSummaryTapTimer);
        loadSummaryCard();
      }
    });
  }
  
  const btn = safeEl("selectAllBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      const cards = document.querySelectorAll(".result-item.selectable");
      const selected = document.querySelectorAll(".result-item.selected");
      const allSelected = cards.length === selected.length;
      cards.forEach(card => card.classList.toggle("selected", !allSelected));
      this.textContent = allSelected ? "Select All" : "Unselect All";
    });
  }

  if (!isMobileDevice()) getActiveSearchInput()?.focus();

  const holdData = getHoldData();
  if (holdData.rows.length > 0) {
    if (safeEl("holdButton")) safeEl("holdButton").value = `Hold (${holdData.rows.length})`;
    if (safeEl("collectButton")) safeEl("collectButton").disabled = true;
    updateOnHoldButton();
  }
});

document.addEventListener("click", function(e) {
  const menu = safeEl("logoutMenu");
  const btn = safeEl("logoutBtn");
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) menu.style.display = "none";

  if (isMobileDevice()) return;
  const tag = e.target.tagName;
  const isFormElement = ["INPUT", "TEXTAREA", "SELECT", "OPTION", "BUTTON"].includes(tag);
  if (!isFormElement) getActiveSearchInput()?.focus();
});

document.addEventListener("keydown", function(e) {
  if (isMobileDevice()) return;
  if (e.key === "Enter") {
    const input = getActiveSearchInput();
    if (!input) return;
    e.preventDefault();
    let val = input.value;
    if (val && !val.endsWith(", ")) input.value = val + ", ";
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const cleanValue = input.value.replace(/,\s*$/, "");
      search(cleanValue);
    }, 300);
  }
});

function loadSummaryCard() {

 fetch(`${WORKER_API}/summary`)
  .then(r=>r.json())
  .then(data=>{

    document.getElementById('result').innerHTML = `
      <div class="summary-card">

        <div class="card-item">
          <div class="label">TOTAL PARTICIPANT</div>
          <div class="value">${data.total}</div>
        </div>

        <div class="card-item collected">
          <div class="label">COLLECTED</div>
          <div class="value">${data.collected}</div>
        </div>

        <div class="card-item uncollected">
          <div class="label">BALANCE</div>
          <div class="value">${data.balance}</div>
        </div>

      </div>
    `

  })

}
