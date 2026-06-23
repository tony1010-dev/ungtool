const { PDFDocument } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const themeButtons = document.querySelectorAll(".theme-button");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const weatherText = document.querySelector("#weather-text");
const weatherPill = document.querySelector("#weather-pill");
const usdText = document.querySelector("#usd-text");
const usdPill = document.querySelector("#usd-pill");

function applyTheme(mode, save = true) {
  const resolved = mode === "system" ? (systemTheme.matches ? "dark" : "light") : mode;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
  themeColorMeta.content = resolved === "dark" ? "#171717" : "#f8f7f3";

  themeButtons.forEach((button) => {
    const active = button.dataset.themeChoice === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (save) localStorage.setItem("woongtoolTheme", mode);
}

themeButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
});

systemTheme.addEventListener("change", () => {
  if (document.documentElement.dataset.themeMode === "system") applyTheme("system", false);
});

applyTheme(document.documentElement.dataset.themeMode || "light", false);

function weatherIconForCode(code) {
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "🌤️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "⛅";
}

async function loadHeaderMetrics() {
  if (weatherText && weatherPill) {
    try {
      const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
      weatherUrl.searchParams.set("latitude", "37.41");
      weatherUrl.searchParams.set("longitude", "127.26");
      weatherUrl.searchParams.set("current", "temperature_2m,weather_code");
      weatherUrl.searchParams.set("timezone", "Asia/Seoul");
      const weatherResponse = await fetch(weatherUrl);
      if (!weatherResponse.ok) throw new Error("weather");
      const weatherData = await weatherResponse.json();
      const current = weatherData.current || {};
      const icon = weatherIconForCode(Number(current.weather_code));
      const temp = Number(current.temperature_2m);
      weatherPill.querySelector(".metric-icon").textContent = icon;
      weatherText.textContent = Number.isFinite(temp) ? `${current.temperature_2m}°C` : "날씨";
      weatherPill.title = "현재 날씨";
    } catch {
      weatherPill.querySelector(".metric-icon").textContent = "⛅";
      weatherText.textContent = "날씨";
    }
  }

  if (usdText && usdPill) {
    try {
      const rateResponse = await fetch("https://open.er-api.com/v6/latest/USD");
      if (!rateResponse.ok) throw new Error("rate");
      const rateData = await rateResponse.json();
      const krw = Number(rateData?.rates?.KRW);
      const formatted = Number.isFinite(krw)
        ? new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(krw)
        : null;
      usdText.textContent = formatted ? `₩${formatted}` : "₩1,531";
      usdPill.title = "환율";
    } catch {
      usdText.textContent = "₩1,531";
    }
  }
}

loadHeaderMetrics();

const dom = {
  dropZone: document.querySelector("#drop-zone"),
  zipInput: document.querySelector("#zip-input"),
  selectButton: document.querySelector("#select-button"),
  workspace: document.querySelector("#workspace"),
  selectedFile: document.querySelector("#workspace .selected-file"),
  fileType: document.querySelector("#merge-file-type"),
  zipName: document.querySelector("#zip-name"),
  zipSize: document.querySelector("#zip-size"),
  resetButton: document.querySelector("#reset-button"),
  fileCount: document.querySelector("#file-count"),
  pdfList: document.querySelector("#pdf-list"),
  outputName: document.querySelector("#output-name"),
  mergeButton: document.querySelector("#merge-button"),
  progressWrap: document.querySelector("#progress-wrap"),
  progressLabel: document.querySelector("#progress-label"),
  progressPercent: document.querySelector("#progress-percent"),
  progressBar: document.querySelector("#progress-bar"),
  message: document.querySelector("#message"),
};

let mergeInputLoaded = false;
let pdfEntries = [];
let upsFile = null;
let upsBytes = null;
let upsPages = [];

const naturalCollator = new Intl.Collator("ko", {
  numeric: true,
  sensitivity: "base",
});

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function safeBaseName(name) {
  return name
    .replace(/\.zip$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .trim();
}

function downloadPdf(bytes, name) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function downloadFile(bytes, name, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function safeOutputBaseName(input, fallback) {
  return safeBaseName(input?.value ?? "") || fallback;
}

function dashboardFileBase() {
  return `웅툴_대시보드_${seoulDateString()}`;
}

function dashboardCellText(cell) {
  return String(gvizCellValue(cell ?? null) ?? "").trim();
}

function dashboardRowsFromTable(table, mapRow) {
  return (table?.rows || []).map((row, index) => mapRow(row?.c || [], index)).filter(Boolean);
}

function setIfPresent(input, value) {
  if (input) input.value = value;
}

const labelDom = {
  company: document.querySelector("#label-company"),
  invoice: document.querySelector("#label-invoice"),
  boxCount: document.querySelector("#label-box-count"),
  copyCount: document.querySelector("#label-copy-count"),
  unitButtons: document.querySelectorAll(".unit-button"),
  outputName: document.querySelector("#label-output-name"),
  previewCompany: document.querySelector("#label-preview-company"),
  previewInvoice: document.querySelector("#label-preview-invoice"),
  previewBox: document.querySelector("#label-preview-box"),
  downloadButton: document.querySelector("#label-download-button"),
  message: document.querySelector("#label-message"),
};

const dashboardDom = {
  excelButton: document.querySelector("#dashboard-excel-button"),
  pdfButton: document.querySelector("#dashboard-pdf-button"),
  passwordGate: document.querySelector("#dashboard-password-gate"),
  passwordForm: document.querySelector("#dashboard-password-form"),
  password: document.querySelector("#dashboard-password"),
  passwordError: document.querySelector("#dashboard-password-error"),
  content: document.querySelector("#dashboard-content"),
};

let labelUnit = "BOX";
const DASHBOARD_UNLOCK_KEY = "ungtool.dashboard.unlocked";

function getStoredDashboardUnlock() {
  try {
    return localStorage.getItem(DASHBOARD_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

let dashboardUnlocked = getStoredDashboardUnlock();

const dashboardState = {
  incoming: null,
  shippingQueue: null,
  outgoing: null,
  personnel: null,
  materials: null,
};

function labelValues() {
  return {
    company: labelDom.company.value.trim() || "House of Kpop Pte Ltd",
    invoice: labelDom.invoice.value.trim().replace(/^#\s*/, "") || "IN00443990",
    boxes: Math.max(1, Number(labelDom.boxCount.value) || 1),
    copies: Math.min(200, Math.max(1, Number(labelDom.copyCount.value) || 1)),
    unit: labelUnit,
  };
}

function setLabelUnit(unit) {
  labelUnit = unit === "PLT" ? "PLT" : "BOX";
  labelDom.unitButtons.forEach((button) => {
    const active = button.dataset.unit === labelUnit;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateLabelPreview();
}

function updateLabelPreview() {
  const values = labelValues();
  labelDom.previewCompany.textContent = values.company;
  labelDom.previewInvoice.textContent = `# ${values.invoice}`;
  labelDom.previewBox.textContent = `${values.boxes} ${values.unit}`;
}

function showLabelMessage(text, isError = false) {
  labelDom.message.textContent = text;
  labelDom.message.classList.toggle("error", isError);
  labelDom.message.hidden = !text;
}

function fitCanvasFont(ctx, text, maxWidth, startSize, minSize = 42) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function createLabelCanvas(values) {
  const canvas = document.createElement("canvas");
  canvas.width = 1500;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const companySize = fitCanvasFont(ctx, values.company, 1400, 150, 62);
  ctx.font = `700 ${companySize}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.fillText(values.company, 750, 305);

  const invoiceText = `# ${values.invoice}`;
  const invoiceSize = fitCanvasFont(ctx, invoiceText, 1400, 150, 62);
  ctx.font = `700 ${invoiceSize}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.fillText(invoiceText, 750, 515);

  const boxText = `${values.boxes} ${values.unit}`;
  const boxSize = fitCanvasFont(ctx, boxText, 1400, 200, 82);
  ctx.font = `700 ${boxSize}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.fillText(boxText, 750, 755);
  return canvas;
}

async function downloadLabelPdf() {
  labelDom.downloadButton.disabled = true;
  showLabelMessage("");
  try {
    const values = labelValues();
    const canvas = createLabelCanvas(values);
    const imageBytes = canvas.toDataURL("image/png");
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(imageBytes);
    const pageWidth = (150 / 25.4) * 72;
    const pageHeight = (100 / 25.4) * 72;

    for (let index = 0; index < values.copies; index += 1) {
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }

    const output = await pdf.save({ useObjectStreams: true });
    const outputName = safeOutputBaseName(labelDom.outputName, "LABEL");
    downloadPdf(output, outputName);
    showLabelMessage(`15×10cm 라벨 PDF ${values.copies}장을 저장했어요.`);
  } catch (error) {
    showLabelMessage(error.message || "라벨 PDF 생성 중 문제가 발생했습니다.", true);
  } finally {
    labelDom.downloadButton.disabled = false;
  }
}

[labelDom.company, labelDom.invoice, labelDom.boxCount].forEach((input) => {
  input.addEventListener("input", updateLabelPreview);
});
labelDom.unitButtons.forEach((button) => {
  button.addEventListener("click", () => setLabelUnit(button.dataset.unit));
});
setLabelUnit("BOX");
labelDom.downloadButton.addEventListener("click", downloadLabelPdf);

const customLabelDom = {
  preview: document.querySelector("#custom-label-preview"),
  fontSize: document.querySelector("#custom-label-font-size"),
  fontSizeValue: document.querySelector("#custom-label-font-size-value"),
  copyCount: document.querySelector("#custom-label-copy-count"),
  outputName: document.querySelector("#custom-label-output-name"),
  downloadButton: document.querySelector("#custom-label-download-button"),
  message: document.querySelector("#custom-label-message"),
};

const customLabelAlign = "center";

function customLabelText() {
  return customLabelDom.preview.innerText
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function updateCustomLabelState() {
  const empty = !customLabelText();
  customLabelDom.preview.classList.toggle("is-empty", empty);
  customLabelDom.fontSizeValue.value = customLabelDom.fontSize.value;
  customLabelDom.preview.style.fontSize = `${customLabelDom.fontSize.value}px`;
  customLabelDom.preview.style.textAlign = customLabelAlign;
}

function showCustomLabelMessage(text, isError = false) {
  customLabelDom.message.textContent = text;
  customLabelDom.message.classList.toggle("error", isError);
  customLabelDom.message.hidden = !text;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const sourceLines = text.split(/\r?\n/);
  const lines = [];

  sourceLines.forEach((sourceLine) => {
    if (!sourceLine) {
      lines.push("");
      return;
    }

    let current = "";
    Array.from(sourceLine).forEach((character) => {
      const candidate = current + character;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current.trimEnd());
        current = character.trimStart();
      } else {
        current = candidate;
      }
    });
    lines.push(current);
  });

  return lines.slice(0, 8);
}

function createCustomLabelCanvas(text, fontSize, alignment) {
  const canvas = document.createElement("canvas");
  canvas.width = 1500;
  canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  const canvasFontSize = Math.round(fontSize * 2.55);
  const padding = 90;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.font = `700 ${canvasFontSize}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = alignment;

  const lines = wrapCanvasText(ctx, text, canvas.width - padding * 2);
  const lineHeight = canvasFontSize * 1.18;
  const totalHeight = lineHeight * lines.length;
  const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;
  const x = alignment === "left" ? padding : alignment === "right" ? canvas.width - padding : canvas.width / 2;

  lines.forEach((line, index) => {
    ctx.fillText(line, x, startY + index * lineHeight);
  });
  return canvas;
}

async function downloadCustomLabelPdf() {
  const text = customLabelText();
  if (!text) {
    showCustomLabelMessage("미리보기 안에 출력할 문구를 입력해 주세요.", true);
    customLabelDom.preview.focus();
    return;
  }

  customLabelDom.downloadButton.disabled = true;
  showCustomLabelMessage("");
  try {
    const copies = Math.min(200, Math.max(1, Number(customLabelDom.copyCount.value) || 1));
    const fontSize = Number(customLabelDom.fontSize.value) || 48;
    const canvas = createCustomLabelCanvas(text, fontSize, customLabelAlign);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(canvas.toDataURL("image/png"));
    const pageWidth = (150 / 25.4) * 72;
    const pageHeight = (100 / 25.4) * 72;

    for (let index = 0; index < copies; index += 1) {
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }

    const output = await pdf.save({ useObjectStreams: true });
    const outputName = safeOutputBaseName(customLabelDom.outputName, "CUSTOM_LABEL");
    downloadPdf(output, outputName);
    showCustomLabelMessage(`직접 편집 라벨 PDF ${copies}장을 저장했어요.`);
  } catch (error) {
    showCustomLabelMessage(error.message || "직접 편집 라벨 생성 중 문제가 발생했습니다.", true);
  } finally {
    customLabelDom.downloadButton.disabled = false;
  }
}

customLabelDom.preview.addEventListener("input", () => {
  showCustomLabelMessage("");
  updateCustomLabelState();
});
customLabelDom.preview.addEventListener("focus", () => {
  if (customLabelText()) return;
  customLabelDom.preview.classList.add("is-empty");
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(customLabelDom.preview);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
});
customLabelDom.preview.addEventListener("blur", updateCustomLabelState);
customLabelDom.fontSize.addEventListener("input", updateCustomLabelState);
customLabelDom.downloadButton.addEventListener("click", downloadCustomLabelPdf);
updateCustomLabelState();

const DEFAULT_HOME_NOTICE = `2026.06.22 | New Release

• Label Print: PLT 출력 전환 지원
• Export Permit: DHL 면허 다운로드 추가
• Location Sync: 재고와 로케이션 비교 기능 추가
• Dashboard: 입고 · 출고 · 자재 현황 추가

2026.06.21 | Feature Update

• Label Print: 폰트 크기 조절기능 추가
• PDF Merge: 기능통합
• Picking List: 기본 출력 · 로케이션 정렬순 출력 기능 추가
• UNGTOOL AI: Qwen3 32B 기반 AI 기능 추가
• 화면 개선: 상단 메뉴 글자 크기 확대

2026.06.19 | Genesis Release

• Label Print: 업체명 · Invoice No. · Box Qty PDF 자동 생성
• PDF Merge (ZIP): ZIP 내 PDF 자동 병합
• UPS Print: 10×15cm Thermal Label 변환
• Picking List: SKU · Location 매핑 Excel / PDF 생성
• Location Sync: 재고 데이터와 DB 비교 검증`;
const homePanel = document.querySelector("#home-panel");
const homeNoticeText = document.querySelector("#home-notice-text");
const homeNoticePrev = document.querySelector("#notice-prev");
const homeNoticeNext = document.querySelector("#notice-next");
const homeNoticeIndicator = document.querySelector("#notice-page-indicator");
const brandHome = document.querySelector("#brand-home");
const HOME_NOTICE_PAGE_SIZE = 2;
let homeNoticePages = [];
let homeNoticePageIndex = 0;

function parseHomeNoticeSections(notice) {
  const lines = String(notice).split(/\r?\n/);
  const sections = [];
  let currentSection = null;
  let sectionIndex = 0;

  lines.forEach((line) => {
    const cleanLine = line.trim();
    if (!cleanLine) return;
    if (/^\d{4}\.\d{2}\.\d{2}\s*\|/.test(cleanLine)) {
      currentSection = { title: cleanLine, details: [], index: sectionIndex += 1 };
      sections.push(currentSection);
      return;
    }
    if (!currentSection) {
      currentSection = { title: "", details: [] };
      sections.push(currentSection);
    }
    currentSection.details.push(cleanLine);
  });

  return sections.sort((a, b) => {
    const aDate = a.title.match(/^(\d{4}\.\d{2}\.\d{2})/)?.[1] ?? "";
    const bDate = b.title.match(/^(\d{4}\.\d{2}\.\d{2})/)?.[1] ?? "";
    const aNum = Number(aDate.replace(/\./g, ""));
    const bNum = Number(bDate.replace(/\./g, ""));
    if (aNum !== bNum) return bNum - aNum;
    return a.index - b.index;
  });
}

function renderHomeNoticePage() {
  const page = homeNoticePages[homeNoticePageIndex] || [];
  homeNoticeText.replaceChildren();

  page.forEach((section) => {
    const sectionElement = document.createElement("section");
    sectionElement.className = "notice-history-item";
    const titleElement = document.createElement("div");
    titleElement.className = "notice-version";
    titleElement.textContent = section.title;
    sectionElement.append(titleElement);

    const list = document.createElement("ul");
    list.className = "notice-feature-list";
    section.details.forEach((line) => {
      const item = document.createElement("li");
      const cleanLine = line.replace(/^[•·\-]\s*/, "");
      const separator = cleanLine.indexOf(":");
      if (separator > 0) {
        const name = document.createElement("strong");
        name.textContent = cleanLine.slice(0, separator);
        item.append(name, document.createTextNode(cleanLine.slice(separator)));
      } else {
        item.textContent = cleanLine;
      }
      list.append(item);
    });
    sectionElement.append(list);
    homeNoticeText.append(sectionElement);
  });

  const totalPages = Math.max(1, homeNoticePages.length);
  homeNoticeIndicator.textContent = `${homeNoticePageIndex + 1} / ${totalPages}`;
  homeNoticePrev.disabled = homeNoticePageIndex <= 0;
  homeNoticeNext.disabled = homeNoticePageIndex >= totalPages - 1;
}

function loadHomeNotice() {
  const sections = parseHomeNoticeSections(DEFAULT_HOME_NOTICE);
  homeNoticePages = [];
  for (let i = 0; i < sections.length; i += HOME_NOTICE_PAGE_SIZE) {
    homeNoticePages.push(sections.slice(i, i + HOME_NOTICE_PAGE_SIZE));
  }
  homeNoticePageIndex = 0;
  renderHomeNoticePage();
  return DEFAULT_HOME_NOTICE;
}

homeNoticePrev.addEventListener("click", () => {
  homeNoticePageIndex = Math.max(0, homeNoticePageIndex - 1);
  renderHomeNoticePage();
});

homeNoticeNext.addEventListener("click", () => {
  homeNoticePageIndex = Math.min(homeNoticePages.length - 1, homeNoticePageIndex + 1);
  renderHomeNoticePage();
});

loadHomeNotice();

function showHome() {
  document.querySelectorAll(".tool-tab").forEach((tab) => {
    tab.classList.remove("is-active");
    tab.setAttribute("aria-selected", "false");
  });
  Object.values(upsDom.panels).forEach((panel) => {
    panel.hidden = true;
  });
  loadHomeNotice();
  homePanel.hidden = false;
}

function showMessage(text, isError = false) {
  dom.message.textContent = text;
  dom.message.classList.toggle("error", isError);
  dom.message.hidden = !text;
}

function setProgress(value, label) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  dom.progressBar.style.width = `${percent}%`;
  dom.progressPercent.textContent = `${percent}%`;
  if (label) dom.progressLabel.textContent = label;
}

function resetTool() {
  mergeInputLoaded = false;
  pdfEntries = [];
  dom.zipInput.value = "";
  dom.workspace.hidden = false;
  dom.selectedFile.hidden = true;
  dom.dropZone.hidden = false;
  dom.pdfList.replaceChildren();
  dom.fileCount.textContent = "0개";
  setIfPresent(dom.outputName, "");
  dom.progressWrap.hidden = true;
  setProgress(0, "PDF를 병합하고 있어요");
  showMessage("");
}

function renderPdfList() {
  const fragment = document.createDocumentFragment();

  pdfEntries.forEach(({ name }) => {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    const fileName = document.createElement("span");

    icon.className = "pdf-icon";
    icon.textContent = "PDF";
    fileName.className = "pdf-name";
    fileName.textContent = name;
    fileName.title = name;

    item.append(icon, fileName);
    fragment.append(item);
  });

  dom.pdfList.replaceChildren(fragment);
  dom.fileCount.textContent = `${pdfEntries.length}개`;
}

async function loadMergeFiles(fileList) {
  showMessage("");
  const files = Array.from(fileList || []);
  const zipFiles = files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
  const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith(".pdf"));

  if (!files.length || zipFiles.length + pdfFiles.length !== files.length) {
    showMessage("ZIP/PDF only.", true);
    return;
  }

  if (zipFiles.length && (zipFiles.length > 1 || pdfFiles.length)) {
    showMessage("Use ZIP or PDFs.", true);
    return;
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 500 * 1024 * 1024) {
    showMessage("전체 파일이 500MB보다 크면 브라우저 메모리 부족으로 실패할 수 있어요.", true);
  }

  dom.selectButton.disabled = true;
  dom.selectButton.textContent = "확인 중…";

  try {
    if (zipFiles.length) {
      const zipFile = zipFiles[0];
      const archive = await JSZip.loadAsync(zipFile);
      pdfEntries = Object.values(archive.files)
        .filter(
          (entry) =>
            !entry.dir &&
            entry.name.toLowerCase().endsWith(".pdf") &&
            !entry.name.includes("__MACOSX/") &&
            !entry.name.split("/").at(-1).startsWith("._"),
        )
        .map((entry) => ({
          name: entry.name,
          getBytes: () => entry.async("uint8array"),
        }))
        .sort((a, b) => naturalCollator.compare(a.name, b.name));

      if (!pdfEntries.length) {
        throw new Error("ZIP 파일 안에서 PDF를 찾지 못했어요.");
      }

      dom.fileType.textContent = "ZIP";
      dom.zipName.textContent = zipFile.name;
      dom.zipSize.textContent = `${formatBytes(zipFile.size)} · PDF ${pdfEntries.length}개`;
      setIfPresent(dom.outputName, `${safeBaseName(zipFile.name)}_병합`);
    } else {
      pdfEntries = pdfFiles
        .map((file) => ({
          name: file.name,
          getBytes: async () => new Uint8Array(await file.arrayBuffer()),
        }))
        .sort((a, b) => naturalCollator.compare(a.name, b.name));

      dom.fileType.textContent = "PDF";
      dom.zipName.textContent = `PDF ${pdfEntries.length}개`;
      dom.zipSize.textContent = `${formatBytes(totalSize)} · 파일명 순서로 정렬`;
      const firstName = pdfEntries[0].name.replace(/\.pdf$/i, "");
      setIfPresent(dom.outputName, `${safeBaseName(firstName)}_병합`);
    }

    mergeInputLoaded = true;
    renderPdfList();
    dom.dropZone.hidden = true;
    dom.workspace.hidden = false;
    dom.selectedFile.hidden = false;
  } catch (error) {
    mergeInputLoaded = false;
    pdfEntries = [];
    showMessage(error.message || "파일을 열 수 없어요. 파일을 다시 확인해 주세요.", true);
  } finally {
    dom.selectButton.disabled = false;
    dom.selectButton.textContent = "Choose";
  }
}

async function mergePdfs() {
  if (!mergeInputLoaded || !pdfEntries.length) {
    showMessage("Add files first.", true);
    return;
  }

  dom.mergeButton.disabled = true;
  dom.resetButton.disabled = true;
  dom.progressWrap.hidden = false;
  showMessage("");
  setProgress(3, "병합 파일을 준비하고 있어요");

  try {
    const merged = await PDFDocument.create();

    for (let index = 0; index < pdfEntries.length; index += 1) {
      const entry = pdfEntries[index];
      setProgress(
        5 + (index / pdfEntries.length) * 82,
        `${index + 1}/${pdfEntries.length} · ${entry.name.split("/").at(-1)}`,
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      const bytes = await entry.getBytes();
      let source;

      try {
        source = await PDFDocument.load(bytes, {
          ignoreEncryption: false,
          updateMetadata: false,
        });
      } catch {
        throw new Error(`“${entry.name}” 파일을 읽을 수 없어요. 암호 설정 또는 파일 손상을 확인해 주세요.`);
      }

      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }

    setProgress(92, "완성된 PDF를 저장하고 있어요");
    const result = await merged.save({ useObjectStreams: true });
    const outputName = safeOutputBaseName(dom.outputName, "웅툴_병합");
    downloadPdf(result, outputName);

    setProgress(100, "병합이 완료됐어요");
    showMessage(`PDF ${pdfEntries.length}개를 “${outputName}.pdf”로 저장했어요.`);
  } catch (error) {
    setProgress(0, "병합하지 못했어요");
    showMessage(error.message || "PDF 병합 중 문제가 발생했어요.", true);
  } finally {
    dom.mergeButton.disabled = false;
    dom.resetButton.disabled = false;
  }
}

dom.selectButton.addEventListener("click", () => dom.zipInput.click());
dom.zipInput.addEventListener("change", () => loadMergeFiles(dom.zipInput.files));
dom.resetButton.addEventListener("click", resetTool);
dom.mergeButton.addEventListener("click", mergePdfs);

["dragenter", "dragover"].forEach((eventName) => {
  dom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropZone.classList.remove("is-dragging");
  });
});

dom.dropZone.addEventListener("drop", (event) => {
  loadMergeFiles(event.dataTransfer.files);
});

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

const upsDom = {
  tabs: document.querySelectorAll(".tool-tab"),
  panels: {
    label: document.querySelector("#label-tool"),
    zip: document.querySelector("#zip-tool"),
    ups: document.querySelector("#ups-tool"),
    picking: document.querySelector("#picking-tool"),
    sync: document.querySelector("#sync-tool"),
    license: document.querySelector("#license-tool"),
    business: document.querySelector("#business-tool"),
    dashboard: document.querySelector("#dashboard-tool"),
    admin: document.querySelector("#admin-tool"),
  },
  dropZone: document.querySelector("#ups-drop-zone"),
  input: document.querySelector("#ups-input"),
  selectButton: document.querySelector("#ups-select-button"),
  workspace: document.querySelector("#ups-workspace"),
  selectedFile: document.querySelector("#ups-workspace .selected-file"),
  fileName: document.querySelector("#ups-file-name"),
  fileInfo: document.querySelector("#ups-file-info"),
  resetButton: document.querySelector("#ups-reset-button"),
  totalPages: document.querySelector("#ups-total-pages"),
  labelPages: document.querySelector("#ups-label-pages"),
  skipBackup: document.querySelector("#skip-backup"),
  outputName: document.querySelector("#ups-output-name"),
  convertButton: document.querySelector("#ups-convert-button"),
  progressWrap: document.querySelector("#ups-progress-wrap"),
  progressLabel: document.querySelector("#ups-progress-label"),
  progressPercent: document.querySelector("#ups-progress-percent"),
  progressBar: document.querySelector("#ups-progress-bar"),
  message: document.querySelector("#ups-message"),
};

const googleToolRefreshing = new Set();

function currentToolName() {
  return document.querySelector(".tool-tab.is-active")?.dataset.tool || "";
}

function selectTool(name) {
  upsDom.tabs.forEach((tab) => {
    const selected = tab.dataset.tool === name;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });

  Object.entries(upsDom.panels).forEach(([panelName, panel]) => {
    panel.hidden = panelName !== name;
  });
  homePanel.hidden = true;

  refreshGoogleBackedTool(name);
  if (name === "dashboard") updateDashboardLock(true);
  if (name === "admin") updateAdminLock();
}

async function refreshGoogleBackedTool(name) {
  if (!["picking", "sync", "license"].includes(name)) return;
  if (googleToolRefreshing.has(name)) return;
  googleToolRefreshing.add(name);
  try {
    if (name === "picking") {
      await loadGoogleDb(true);
      if (pickingFile) await inspectPickingFile(pickingFile);
      return;
    }
    if (name === "sync") {
      await loadGoogleDb(true);
      if (syncFile) await inspectSyncFile(syncFile);
      return;
    }
    if (name === "license") {
      await loadLicenseRows(true);
    }
  } catch (error) {
    if (name === "picking") showPickingMessage(error.message, true);
    if (name === "sync") showSyncMessage(error.message, true);
    if (name === "license") showLicenseMessage(error.message, true);
  } finally {
    googleToolRefreshing.delete(name);
  }
}

function showUpsMessage(text, isError = false) {
  upsDom.message.textContent = text;
  upsDom.message.classList.toggle("error", isError);
  upsDom.message.hidden = !text;
}

function setUpsProgress(value, label) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  upsDom.progressBar.style.width = `${percent}%`;
  upsDom.progressPercent.textContent = `${percent}%`;
  if (label) upsDom.progressLabel.textContent = label;
}

function selectedUpsPages() {
  return upsPages.filter((page) => !upsDom.skipBackup.checked || !page.isBackup);
}

function updateUpsCount() {
  upsDom.totalPages.textContent = String(upsPages.length || "-");
  upsDom.labelPages.textContent = String(selectedUpsPages().length || "-");
}

function resetUpsTool() {
  upsFile = null;
  upsBytes = null;
  upsPages = [];
  upsDom.input.value = "";
  upsDom.workspace.hidden = false;
  upsDom.selectedFile.hidden = true;
  upsDom.dropZone.hidden = false;
  upsDom.totalPages.textContent = "-";
  upsDom.labelPages.textContent = "-";
  setIfPresent(upsDom.outputName, "");
  upsDom.progressWrap.hidden = true;
  setUpsProgress(0, "라벨을 변환하고 있어요");
  showUpsMessage("");
}

async function inspectUpsPdf(file) {
  showUpsMessage("");

  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    showUpsMessage("Choose PDF.", true);
    return;
  }

  upsDom.selectButton.disabled = true;
  upsDom.selectButton.textContent = "확인 중…";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");
      pages.push({
        index: pageNumber - 1,
        isBackup: /backup\s*document|please\s*place\s*on\s*package/i.test(text),
      });
    }

    const labelCount = pages.filter((page) => !page.isBackup).length;
    if (!labelCount) {
      throw new Error("배송 라벨 페이지를 찾지 못했어요.");
    }

    upsFile = file;
    upsBytes = bytes;
    upsPages = pages;
    upsDom.fileName.textContent = file.name;
    upsDom.fileInfo.textContent = `${formatBytes(file.size)} · UPS 문서 분석 완료`;
    setIfPresent(upsDom.outputName, `${safeBaseName(file.name)}_10x15`);
    updateUpsCount();
    upsDom.dropZone.hidden = true;
    upsDom.workspace.hidden = false;
    upsDom.selectedFile.hidden = false;

    const backupCount = pages.filter((page) => page.isBackup).length;
    if (backupCount) {
      showUpsMessage(`Backup Document ${backupCount}페이지를 찾아 자동으로 제외했어요.`);
    }
  } catch (error) {
    resetUpsTool();
    showUpsMessage(error.message || "PDF 파일을 분석할 수 없어요.", true);
  } finally {
    upsDom.selectButton.disabled = false;
    upsDom.selectButton.textContent = "Choose";
  }
}

async function convertUpsPdf() {
  const pagesToConvert = selectedUpsPages();
  if (!upsBytes || !pagesToConvert.length) {
    showUpsMessage("출력할 배송 라벨 페이지가 없습니다.", true);
    return;
  }

  upsDom.convertButton.disabled = true;
  upsDom.resetButton.disabled = true;
  upsDom.progressWrap.hidden = false;
  showUpsMessage("");
  setUpsProgress(5, "UPS 라벨을 준비하고 있어요");

  try {
    const source = await PDFDocument.load(upsBytes.slice(), {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    const output = await PDFDocument.create();
    const targetWidth = (100 / 25.4) * 72;
    const targetHeight = (150 / 25.4) * 72;

    for (let order = 0; order < pagesToConvert.length; order += 1) {
      const pageInfo = pagesToConvert[order];
      const sourcePage = source.getPage(pageInfo.index);
      const { width, height } = sourcePage.getSize();
      const cropWidth = Math.min(288, width);
      const cropHeight = Math.min(432, height);
      const embedded = await output.embedPage(sourcePage, {
        left: 0,
        bottom: height - cropHeight,
        right: cropWidth,
        top: height,
      });
      const targetPage = output.addPage([targetWidth, targetHeight]);
      targetPage.drawPage(embedded, {
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetHeight,
      });

      setUpsProgress(
        10 + ((order + 1) / pagesToConvert.length) * 80,
        `${order + 1}/${pagesToConvert.length} 라벨 변환 중`,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    const result = await output.save({ useObjectStreams: true });
    const outputName = safeOutputBaseName(upsDom.outputName, "웅툴_UPS_10x15");
    downloadPdf(result, outputName);
    setUpsProgress(100, "10×15cm 라벨이 완성됐어요");
    showUpsMessage(`배송 라벨 ${pagesToConvert.length}장을 “${outputName}.pdf”로 저장했어요.`);
  } catch (error) {
    setUpsProgress(0, "변환하지 못했어요");
    showUpsMessage(error.message || "UPS 라벨 변환 중 문제가 발생했어요.", true);
  } finally {
    upsDom.convertButton.disabled = false;
    upsDom.resetButton.disabled = false;
  }
}

upsDom.tabs.forEach((tab) => {
  tab.addEventListener("click", () => selectTool(tab.dataset.tool));
});
upsDom.selectButton.addEventListener("click", () => upsDom.input.click());
upsDom.input.addEventListener("change", () => inspectUpsPdf(upsDom.input.files[0]));
upsDom.resetButton.addEventListener("click", resetUpsTool);
upsDom.skipBackup.addEventListener("change", updateUpsCount);
upsDom.convertButton.addEventListener("click", convertUpsPdf);

["dragenter", "dragover"].forEach((eventName) => {
  upsDom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    upsDom.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  upsDom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    upsDom.dropZone.classList.remove("is-dragging");
  });
});

upsDom.dropZone.addEventListener("drop", (event) => {
  inspectUpsPdf(event.dataTransfer.files[0]);
});

const GOOGLE_SHEET_ID = "1RLA7Qs9hYDiBaSL9CScATVPRjwnwIjznDdRNJGGbg1k";
const DASH_SHEET_ID = "1og02r9A53W9PUo866w310lCIKuul1KiY0zuefo0YKzA";
const GOOGLE_DB_GID = "1060200137";
const GOOGLE_LICENSE_GID = "820278293";
const PICKING_PASSWORD_HASH = "75992a5ac67ff644d3063976c2effd10bdd93fcc109798e3d5c1acf2e530d01a";
const DASHBOARD_PASSWORD_HASH = "03aaef0fd45d47ee37afee60b41f0a80010f58f95d3d34e9b7dc253c8558bf2a";

const pickingDom = {
  content: document.querySelector("#picking-content"),
  dbStatus: document.querySelector("#db-status"),
  dropZone: document.querySelector("#picking-drop-zone"),
  input: document.querySelector("#picking-input"),
  selectButton: document.querySelector("#picking-select-button"),
  workspace: document.querySelector("#picking-workspace"),
  selectedFile: document.querySelector("#picking-workspace .selected-file"),
  fileName: document.querySelector("#picking-file-name"),
  fileInfo: document.querySelector("#picking-file-info"),
  resetButton: document.querySelector("#picking-reset-button"),
  total: document.querySelector("#picking-total"),
  matched: document.querySelector("#picking-matched"),
  missing: document.querySelector("#picking-missing"),
  missingList: document.querySelector("#missing-list"),
  missingSkus: document.querySelector("#missing-skus"),
  outputName: document.querySelector("#picking-output-name"),
  excelButton: document.querySelector("#picking-excel-button"),
  pdfButton: document.querySelector("#picking-pdf-button"),
  locationExcelButton: document.querySelector("#picking-location-excel-button"),
  locationPdfButton: document.querySelector("#picking-location-pdf-button"),
  message: document.querySelector("#picking-message"),
};

let locationDb = null;
let licenseRows = null;
let pickingWorkbook = null;
let pickingSheet = null;
let pickingRows = [];
let pickingColumns = null;
let pickingFile = null;
let pickingData = null;
const pickingOrientation = "portrait";

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function showPickingMessage(text, isError = false) {
  pickingDom.message.textContent = text;
  pickingDom.message.classList.toggle("error", isError);
  pickingDom.message.hidden = !text;
}

function setDbStatus(state, text) {
  [pickingDom.dbStatus, document.querySelector("#sync-db-status")].filter(Boolean).forEach((element) => {
    element.className = `sheet-badge ${state ? `is-${state}` : ""}`;
    element.innerHTML = `<span class="status-dot"></span>${text}`;
  });
}

function gvizCellValue(cell) {
  if (!cell) return "";
  return cell.v ?? cell.f ?? "";
}

let barcodeDb = null; // barcode (col B) → location (col D)

function makeLocationMap(response) {
  if (!response || response.status === "error" || !response.table) {
    throw new Error("Google DB 내용을 읽을 수 없습니다.");
  }

  const table = response.table;
  const map = new Map();
  const bcMap = new Map();
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const cells = table.rows[rowIndex].c || [];
    const sku = normalizeSku(gvizCellValue(cells[0]));
    const barcode = String(gvizCellValue(cells[1]) ?? "").trim();
    const location = String(gvizCellValue(cells[3]) ?? "").trim();
    if (sku === "상품코드" || sku === "SKU") continue;
    if (sku) map.set(sku, location);
    if (barcode) bcMap.set(barcode, location);
  }

  if (!map.size) throw new Error("DB 탭 A열 상품코드 데이터를 찾지 못했습니다.");
  barcodeDb = bcMap;
  return map;
}

function loadGoogleDb(force = false) {
  if (locationDb && !force) return Promise.resolve(locationDb);

  setDbStatus("loading", "DB 불러오는 중");
  return new Promise((resolve, reject) => {
    const callbackName = `woongtoolDb_${Date.now()}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      setDbStatus("error", "DB 연결 실패");
      reject(new Error("Google DB 연결 시간이 초과됐습니다. 공유 설정을 확인해 주세요."));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (response) => {
      try {
        locationDb = makeLocationMap(response);
        setDbStatus("ready", `DB ${locationDb.size.toLocaleString()}개 연결`);
        cleanup();
        resolve(locationDb);
      } catch (error) {
        setDbStatus("error", "DB 확인 필요");
        cleanup();
        reject(error);
      }
    };

    const tqx = encodeURIComponent(`out:json;responseHandler:${callbackName}`);
    script.src =
      `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq` +
      `?gid=${GOOGLE_DB_GID}&tqx=${tqx}&range=A:D&t=${Date.now()}`;
    script.onerror = () => {
      cleanup();
      setDbStatus("error", "DB 연결 실패");
      reject(new Error("Google DB를 불러오지 못했습니다. 인터넷 연결과 공유 설정을 확인해 주세요."));
    };
    document.head.append(script);
  });
}

const LICENSE_HEADERS = [
  "운송장번호",
  "거래구분",
  "Incoterms",
  "사업자번호(수출자)",
  "사업자번호(제조자)",
  "환급여부",
  "환급신청인",
  "구매자(BILL TO)",
  "주문번호(Invoice 번호)",
  "란신고품명",
  "결재방법",
  "상품명",
  "신고구분",
  "기타",
  "작업구분",
  "BOX",
];

const licenseDom = {
  status: document.querySelector("#license-sheet-status"),
  summary: document.querySelector("#license-summary"),
  downloadButton: document.querySelector("#license-download-button"),
  message: document.querySelector("#license-message"),
  deliveryCopy: document.querySelector("#license-delivery-copy"),
  deliveryText: document.querySelector("#license-delivery-text"),
  copyButton: document.querySelector("#license-copy-button"),
  mailPreview: document.querySelector("#license-mail-preview"),
  mailSubject: document.querySelector("#license-mail-subject"),
  mailTo: document.querySelector("#license-mail-to"),
  mailCc: document.querySelector("#license-mail-cc"),
  fieldCopyButtons: document.querySelectorAll(".license-field-copy"),
};

const LICENSE_MAIL_TO = '"MinJi Ryu (DHL KR)" <minji.ryu@dhl.com>';
const LICENSE_MAIL_CC =
  '"Jongbeom Lim (DHL KR)" <jongbeom.lim@dhl.com>, SELSWSC@DHL.COM, selsnmstn@dhl.com, EXPKROPS-SWSVC@DHL.COM, 이웅장 <tony@siliconii.net>, 홍은선 <sunny77@siliconii.net>';

function setLicenseStatus(state, text) {
  licenseDom.status.className = `sheet-badge ${state ? `is-${state}` : ""}`;
  licenseDom.status.innerHTML = `<span class="status-dot"></span>${text}`;
}

function showLicenseMessage(text, isError = false) {
  licenseDom.message.textContent = text;
  licenseDom.message.classList.toggle("error", isError);
  licenseDom.message.hidden = !text;
}

function makeLicenseRows(response) {
  if (!response || response.status === "error" || !response.table) {
    throw new Error("면허 탭 내용을 읽을 수 없습니다.");
  }

  const rows = response.table.rows
    .map((row) => {
      const cells = row.c || [];
      const values = Array.from({ length: 17 }, (_, index) => gvizCellValue(cells[index]));
      return {
        values: values.slice(0, 16),
        batteryNote: String(values[16] ?? "").trim(),
      };
    })
    .filter((row) => {
      const first = String(row.values[0] ?? "").trim();
      if (!first || first === "운송장번호") return false;
      return row.values.some((value) => String(value ?? "").trim());
    });

  if (!rows.length) throw new Error("면허 탭에서 출력할 데이터를 찾지 못했습니다.");
  return rows;
}

function licenseNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function getLicenseStats(rows) {
  const batteryRows = rows.filter((row) => row.batteryNote);
  return {
    b2bCount: rows.length,
    b2cCount: 0,
    totalBoxes: rows.reduce((sum, row) => sum + licenseNumber(row.values[15]), 0),
    batteryCount: batteryRows.length,
    batteryBoxes: batteryRows.length,
  };
}

function makeLicenseDeliveryText(rows) {
  const stats = getLicenseStats(rows);
  const lines = [
    "안녕하세요, 실리콘투 음반팀 주희영입니다.",
    "",
    "",
    `B2B ${stats.b2bCount.toLocaleString()}건(${stats.totalBoxes.toLocaleString()}BOX) / B2C ${stats.b2cCount.toLocaleString()}건`,
    "",
    "면허파일 전달드립니다.",
  ];

  if (stats.batteryCount) {
    lines.push(
      "",
      `금일 배터리포함 ${stats.batteryCount.toLocaleString()}건 ${stats.batteryBoxes.toLocaleString()}BOX있습니다, 참고바랍니다`,
    );
  }

  lines.push("", "", "감사합니다", "", "", "주희영 드림.");
  return lines.join("\n");
}

function seoulShortDateString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}.${value("month")}.${value("day")}`;
}

function makeLicenseMailSubject(rows) {
  const suffix = rows.some((row) => row.batteryNote) ? "_배터리포함" : "";
  return `실리콘투 음반팀 면허파일 전달의 건_${seoulShortDateString()}${suffix}`;
}

function showLicenseDeliveryCopy(rows) {
  licenseDom.deliveryText.textContent = makeLicenseDeliveryText(rows);
  licenseDom.mailSubject.textContent = makeLicenseMailSubject(rows);
  licenseDom.mailTo.textContent = LICENSE_MAIL_TO;
  licenseDom.mailCc.textContent = LICENSE_MAIL_CC;
  licenseDom.mailPreview.hidden = false;
  licenseDom.deliveryCopy.hidden = false;
}

async function copyLicenseText(text, button) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("copy failed");
  }
  button.textContent = "복사 완료";
  setTimeout(() => {
    button.textContent = "복사";
  }, 1500);
}

function loadLicenseRows(force = false) {
  if (licenseRows && !force) return Promise.resolve(licenseRows);

  setLicenseStatus("loading", "면허 탭 불러오는 중");
  return new Promise((resolve, reject) => {
    const callbackName = `woongtoolLicense_${Date.now()}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      setLicenseStatus("error", "면허 탭 연결 실패");
      reject(new Error("면허 탭 연결 시간이 초과됐습니다. 공유 설정을 확인해 주세요."));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (response) => {
      try {
        licenseRows = makeLicenseRows(response);
        const batteryCount = licenseRows.filter((row) => row.batteryNote).length;
        setLicenseStatus("ready", `${licenseRows.length.toLocaleString()}건 연결`);
        licenseDom.summary.textContent = batteryCount
          ? `총 ${licenseRows.length.toLocaleString()}건 · 배터리 포함 ${batteryCount.toLocaleString()}건을 확인했습니다.`
          : `총 ${licenseRows.length.toLocaleString()}건 · 일반 면허 양식으로 저장됩니다.`;
        cleanup();
        resolve(licenseRows);
      } catch (error) {
        setLicenseStatus("error", "면허 탭 확인 필요");
        cleanup();
        reject(error);
      }
    };

    const tqx = encodeURIComponent(`out:json;responseHandler:${callbackName}`);
    script.src =
      `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq` +
      `?gid=${GOOGLE_LICENSE_GID}&headers=0&tqx=${tqx}&range=A:Q&t=${Date.now()}`;
    script.onerror = () => {
      cleanup();
      setLicenseStatus("error", "면허 탭 연결 실패");
      reject(new Error("면허 탭을 불러오지 못했습니다. 인터넷 연결과 공유 설정을 확인해 주세요."));
    };
    document.head.append(script);
  });
}

function seoulDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildLicenseWorkbook(rows) {
  const hasBattery = rows.some((row) => row.batteryNote);
  const headers = hasBattery
    ? [...LICENSE_HEADERS, "배터리포함 BOX수량", "비고"]
    : [...LICENSE_HEADERS];
  const matrix = [
    headers,
    ...rows.map((row) => {
      const values = row.values.map((value, index) => {
        if (value == null) return "";
        if (index === 0) return String(value).replace(/\.0$/, "");
        return value;
      });
      if (!hasBattery) return values;
      return [...values, row.batteryNote ? 1 : "", row.batteryNote];
    }),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "pckg_DHL");

  const thinBorder = {
    top: { style: "thin", color: { rgb: "000000" } },
    bottom: { style: "thin", color: { rgb: "000000" } },
    left: { style: "thin", color: { rgb: "000000" } },
    right: { style: "thin", color: { rgb: "000000" } },
  };
  const lastColumn = headers.length - 1;
  const lastRow = matrix.length - 1;

  for (let row = 0; row <= lastRow; row += 1) {
    for (let col = 0; col <= lastColumn; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] || (sheet[address] = { t: "s", v: "" });
      const batteryRow = row > 0 && Boolean(rows[row - 1]?.batteryNote);
      const yellow = (row === 0 && hasBattery && col === 16) || (batteryRow && col <= 16);
      cell.s = {
        font: { name: "맑은 고딕", sz: 10, bold: row === 0 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
        fill: { patternType: "solid", fgColor: { rgb: yellow ? "FFF2CC" : row === 0 ? "D9EAD3" : "FFFFFF" } },
      };
    }
  }

  sheet["!cols"] = [13, 14, 11, 21, 21, 10, 28, 30, 25, 13, 10, 9, 9, 8, 10, 8, 20, 18]
    .slice(0, headers.length)
    .map((wch) => ({ wch }));
  sheet["!rows"] = matrix.map((_, index) => ({ hpt: index === 0 ? 34 : 27 }));
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(lastColumn)}${matrix.length}` };
  return { workbook, hasBattery };
}

async function downloadLicenseWorkbook() {
  if (typeof XLSX === "undefined") {
    showLicenseMessage("Excel 기능을 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.", true);
    return;
  }

  licenseDom.downloadButton.disabled = true;
  licenseDom.downloadButton.querySelector("span").textContent = "Checking…";
  showLicenseMessage("");

  try {
    const rows = await loadLicenseRows(true);
    const { workbook, hasBattery } = buildLicenseWorkbook(rows);
    const output = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
      cellStyles: true,
      compression: true,
    });
    const suffix = hasBattery ? "_배터리포함" : "";
    const fileName = `실리콘투 음반팀_종합 ${seoulDateString()}${suffix}.xlsx`;
    downloadFile(output, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    showLicenseMessage(`${fileName} 파일을 저장했습니다.`);
    showLicenseDeliveryCopy(rows);
  } catch (error) {
    showLicenseMessage(error.message || "면허 파일을 만들지 못했습니다.", true);
  } finally {
    licenseDom.downloadButton.disabled = false;
    licenseDom.downloadButton.querySelector("span").textContent = "Excel 받기";
  }
}

licenseDom.downloadButton.addEventListener("click", downloadLicenseWorkbook);
licenseDom.copyButton.addEventListener("click", async () => {
  try {
    await copyLicenseText(licenseDom.deliveryText.textContent, licenseDom.copyButton);
  } catch {
    showLicenseMessage("전달 문구를 복사하지 못했습니다.", true);
  }
});

licenseDom.fieldCopyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.querySelector(`#${button.dataset.copyTarget}`);
    try {
      await copyLicenseText(target?.textContent || "", button);
    } catch {
      showLicenseMessage("메일 정보를 복사하지 못했습니다.", true);
    }
  });
});

function findPickingStructure(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const wanted = { SKU: -1, DESCRIPTION: -1, PRICE: -1, AMOUNT: -1 };
  let headerRow = -1;

  for (let row = range.s.r; row <= Math.min(range.e.r, 60); row += 1) {
    const found = { ...wanted };
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      const header = normalizeHeader(cell?.v);
      if (Object.hasOwn(found, header)) found[header] = col;
    }
    if (found.SKU >= 0 && found.DESCRIPTION >= 0 && found.PRICE >= 0 && found.AMOUNT >= 0) {
      headerRow = row;
      return { headerRow, ...found, IDX: Math.max(0, found.SKU - 4) };
    }
  }

  throw new Error("32행에서 SKU·DESCRIPTION·PRICE·AMOUNT 열을 찾지 못했습니다.");
}

function collectPickingRows(sheet, columns) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = [];

  for (let row = columns.headerRow + 1; row <= range.e.r; row += 1) {
    const skuCell = sheet[XLSX.utils.encode_cell({ r: row, c: columns.SKU })];
    const idxCell = sheet[XLSX.utils.encode_cell({ r: row, c: columns.IDX })];
    const sku = normalizeSku(skuCell?.v);
    const idx = normalizeHeader(idxCell?.v);

    if (idx === "TOTAL") break;
    if (sku) rows.push({ row, sku });
  }

  if (!rows.length) throw new Error("SKU 상품 행을 찾지 못했습니다.");
  return rows;
}

function sheetValue(sheet, row, col) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v ?? "";
}

function findSheetText(sheet, matcher, maxRow = 32) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let row = range.s.r; row <= Math.min(range.e.r, maxRow); row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const value = String(sheetValue(sheet, row, col)).trim();
      if (value && matcher(value)) return value;
    }
  }
  return "";
}

function extractPickingData(sheet, columns, rows) {
  const remarkRow = 29;
  const usedRange = XLSX.utils.decode_range(sheet["!ref"]);
  let remark = "";

  for (let col = usedRange.s.c; col <= usedRange.e.c; col += 1) {
    const value = String(sheetValue(sheet, remarkRow, col) ?? "").trim();
    if (value && normalizeHeader(value) !== "REMARK") {
      remark = value;
      break;
    }
  }

  const invoiceText = findSheetText(sheet, (value) => /(?:NO\.?\s*:?\s*)?IN\d+/i.test(value));
  const invoiceMatch = invoiceText.match(/IN\d+/i);
  const dateText = findSheetText(sheet, (value) => /^DATE\s*:/i.test(value));
  const date = dateText.replace(/^DATE\s*:\s*/i, "").trim();

  const customer =
    String(sheetValue(sheet, 10, 7)).trim() ||
    String(sheetValue(sheet, 16, 7)).split(/\r?\n/)[0].trim();

  const shipToParts = [];
  for (const row of [16, 17, 19]) {
    const value = String(sheetValue(sheet, row, 7)).trim();
    if (value && !shipToParts.includes(value)) shipToParts.push(value);
  }

  const items = rows.map((item, index) => ({
    index: index + 1,
    sku: item.sku,
    description: String(sheetValue(sheet, item.row, columns.DESCRIPTION)).trim(),
    brand: String(sheetValue(sheet, item.row, columns.BRAND ?? 17)).trim(),
    barcode: String(sheetValue(sheet, item.row, 20)).trim(),
    quantity: String(sheetValue(sheet, item.row, 29)).trim(),
    location: locationDb?.get(item.sku) || "",
    packing: "",
  }));

  const salesPersonParts = [
    String(sheetValue(sheet, 10, 14))
      .replace(/^(?:CONTACT|SHIP\s*VIA)\s*:?\s*/i, "")
      .trim(),
    String(sheetValue(sheet, 10, 24)).trim(),
  ].filter(Boolean);
  const salesPerson = formatSalesPersonDisplay(salesPersonParts.join(" "));
  const shippingCarrier = String(sheetValue(sheet, 24, 9))
    .replace(/^SHIP\s*VIA\s*:?\s*/i, "")
    .trim();

  return {
    invoiceNo: invoiceMatch?.[0] || safeBaseName(pickingFile?.name || ""),
    date,
    customer,
    shipTo: shipToParts.join("\n"),
    remark,
    salesPerson,
    shippingCarrier,
    totalQuantity: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    items,
  };
}

const salesPersonAliases = new Map([
  ["한이연 과장", "aileen"],
  ["김시리 대리", "siri"],
  ["장혜원 대리", "briana"],
  ["한혜원 사원", "hyewon"],
  ["박주선 사원", "jusun"],
  ["정재이 인턴", "jaeyi"],
]);

function normalizeDisplayText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatSalesPersonDisplay(value) {
  const text = normalizeDisplayText(value);
  if (!text) return "";
  for (const [key, alias] of salesPersonAliases.entries()) {
    if (text.includes(`(${alias})`)) return text;
    const aliasTail = new RegExp(`(?:^|\\s)\\(?${escapeRegExp(alias)}\\)?\\s*$`, "i");
    const stripped = text.replace(aliasTail, "").trim();
    if (stripped === key || stripped.startsWith(`${key} `)) {
      return `${stripped} (${alias})`;
    }
    if (text === key || text.startsWith(`${key} `)) {
      return `${text} (${alias})`;
    }
  }
  return text;
}

function updatePickingSummary() {
  const missing = pickingRows.filter((item) => !locationDb?.get(item.sku));
  const matched = pickingRows.length - missing.length;
  pickingDom.total.textContent = String(pickingRows.length);
  pickingDom.matched.textContent = String(matched);
  pickingDom.missing.textContent = String(missing.length);
  pickingDom.missingList.hidden = !missing.length;
  pickingDom.missingSkus.textContent = missing.map((item) => item.sku).join(", ");
}

function resetPickingTool() {
  pickingWorkbook = null;
  pickingSheet = null;
  pickingRows = [];
  pickingColumns = null;
  pickingFile = null;
  pickingData = null;
  pickingDom.input.value = "";
  pickingDom.workspace.hidden = false;
  pickingDom.selectedFile.hidden = true;
  pickingDom.dropZone.hidden = false;
  pickingDom.total.textContent = "-";
  pickingDom.matched.textContent = "-";
  pickingDom.missing.textContent = "-";
  setIfPresent(pickingDom.outputName, "");
  pickingDom.missingList.hidden = true;
  showPickingMessage("");
}

async function inspectPickingFile(file) {
  showPickingMessage("");
  if (!file || !/\.(xls|xlsx)$/i.test(file.name)) {
    showPickingMessage("Choose XLS/XLSX.", true);
    return;
  }
  if (typeof XLSX === "undefined") {
    showPickingMessage("엑셀 처리 도구를 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.", true);
    return;
  }

  pickingDom.selectButton.disabled = true;
  pickingDom.selectButton.textContent = "Checking…";

  try {
    const [db, buffer] = await Promise.all([loadGoogleDb(), file.arrayBuffer()]);
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellStyles: true,
      cellDates: true,
      cellNF: true,
      cellFormula: true,
      cellText: true,
      bookVBA: true,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const columns = findPickingStructure(sheet);
    const rows = collectPickingRows(sheet, columns);

    locationDb = db;
    pickingWorkbook = workbook;
    pickingSheet = sheet;
    pickingColumns = columns;
    pickingRows = rows;
    pickingFile = file;
    pickingData = extractPickingData(sheet, columns, rows);

    pickingDom.fileName.textContent = file.name;
    pickingDom.fileInfo.textContent = `${formatBytes(file.size)} · ${rows.length}개 상품 확인`;
    setIfPresent(pickingDom.outputName, `${safeBaseName(file.name)}_피킹리스트`);
    updatePickingSummary();
    pickingDom.dropZone.hidden = true;
    pickingDom.workspace.hidden = false;
    pickingDom.selectedFile.hidden = false;
  } catch (error) {
    resetPickingTool();
    showPickingMessage(error.message || "엑셀파일을 분석할 수 없습니다.", true);
  } finally {
    pickingDom.selectButton.disabled = false;
    pickingDom.selectButton.textContent = "Choose";
  }
}

function ensureCell(sheet, row, col) {
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  if (!sheet[address]) sheet[address] = { t: "s", v: "" };
  return sheet[address];
}

function setCellText(sheet, row, col, value) {
  const cell = ensureCell(sheet, row, col);
  const originalStyle = cell.s;
  cell.t = "s";
  cell.v = String(value ?? "");
  delete cell.w;
  delete cell.f;
  if (originalStyle) cell.s = originalStyle;
  return cell;
}

function withWrapStyle(cell, horizontal = "left") {
  cell.s = cell.s || {};
  cell.s.alignment = {
    ...(cell.s.alignment || {}),
    wrapText: true,
    vertical: "center",
    horizontal,
  };
}

function getLocationSortedPickingData() {
  const items = [...pickingData.items]
    .sort((a, b) => {
      const locationA = String(a.location || "").trim();
      const locationB = String(b.location || "").trim();
      if (!locationA && !locationB) return a.index - b.index;
      if (!locationA) return 1;
      if (!locationB) return -1;
      return (
        locationA.localeCompare(locationB, "en", {
          numeric: true,
          sensitivity: "base",
        }) || a.index - b.index
      );
    })
    .map((item, index) => ({ ...item, index: index + 1 }));

  return { ...pickingData, items, outputType: "로케이션 정리" };
}

function pickingDocumentTitle(data) {
  return data.outputType === "로케이션 정리" ? "피킹리스트" : "패킹리스트";
}

function formatPickingCount(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
}

function buildPickingWorkbook(data = pickingData) {
  const documentTitle = pickingDocumentTitle(data);
  const referenceParts = [];
  if (data.salesPerson) referenceParts.push(`영업사원 : ${data.salesPerson}`);
  if (data.shippingCarrier) referenceParts.push(`배송사 : ${data.shippingCarrier}`);
  const referenceLine = referenceParts.join("   |   ");
  const printedAt = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const referenceRows = referenceLine ? [[referenceLine, "", "", "", "", "", "", ""]] : [];
  const referenceRow = 4;
  const remarkRow = referenceRow + referenceRows.length;
  const workerRow = remarkRow + 1;
  const spacerRow = workerRow + 1;
  const headerRow = spacerRow + 1;
  const firstItemRow = headerRow + 1;
  const rows = [
    [`■ ${documentTitle}`, "", "", "", "", "", printedAt, ""],
    ["", "", "", "", "", "", "", ""],
    ["INVOICE", "", "DATE", "", "CUSTOMER", "", "TOTAL", ""],
    [
      data.invoiceNo,
      "",
      data.date || "-",
      "",
      data.customer || "-",
      "",
      `${data.items.length} SKU / ${formatPickingCount(data.totalQuantity)} EA`,
      "",
    ],
    ...referenceRows,
    ["특이사항", data.remark || "특이사항 없음", "", "", "", "", "", ""],
    ["특전 :", "", "검수 :", "", "피킹 :", "", "패킹 :", ""],
    ["", "", "", "", "", "", "", ""],
    ["NO", "SKU", "DESCRIPTION", "BRAND", "BARCODE", "QTY", "LOC", "PACK"],
    ...data.items.map((item) => [
      item.index,
      item.sku,
      item.description,
      item.brand,
      item.barcode,
      Number(item.quantity) || item.quantity,
      item.location,
      "",
    ]),
    ["", "", "TOTAL", "", "", `${data.items.length} SKU / ${formatPickingCount(data.totalQuantity)} EA`, "", ""],
    ["웅툴 - 업무를 가볍고 빠르게", "", "", "", "", "", "", ""],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "List Print");

  sheet["!merges"] = [
    XLSX.utils.decode_range("A1:F2"),
    XLSX.utils.decode_range("G1:H2"),
    XLSX.utils.decode_range("A3:B3"),
    XLSX.utils.decode_range("C3:D3"),
    XLSX.utils.decode_range("E3:F3"),
    XLSX.utils.decode_range("G3:H3"),
    XLSX.utils.decode_range("A4:B4"),
    XLSX.utils.decode_range("C4:D4"),
    XLSX.utils.decode_range("E4:F4"),
    XLSX.utils.decode_range("G4:H4"),
    ...(referenceLine ? [XLSX.utils.decode_range(`A${referenceRow + 1}:H${referenceRow + 1}`)] : []),
    XLSX.utils.decode_range(`B${remarkRow + 1}:H${remarkRow + 1}`),
    XLSX.utils.decode_range(`C${data.items.length + firstItemRow + 1}:E${data.items.length + firstItemRow + 1}`),
    XLSX.utils.decode_range(`F${data.items.length + firstItemRow + 1}:H${data.items.length + firstItemRow + 1}`),
    XLSX.utils.decode_range(`A${data.items.length + firstItemRow + 2}:H${data.items.length + firstItemRow + 2}`),
  ];
  sheet["!cols"] = [
    { wch: 4 },
    { wch: 24 },
    { wch: 27 },
    { wch: 18 },
    { wch: 17 },
    { wch: 7 },
    { wch: 10 },
    { wch: 10 },
  ];

  const remarkLines = Math.max(
    (data.remark || "").split(/\r?\n/).length,
    Math.ceil((data.remark || "").length / 100),
  );
  sheet["!rows"] = [
    { hpt: 27 },
    { hpt: 18 },
    { hpt: 20 },
    { hpt: 34 },
    ...(referenceLine ? [{ hpt: 34 }] : []),
    { hpt: Math.max(42, remarkLines * 16 + 12) },
    { hpt: 38 },
    { hpt: 8 },
    { hpt: 30 },
    ...data.items.map((item) => ({
      hpt: Math.max(
        34,
        Math.ceil(item.description.length / 30) * 14 + 8,
        Math.ceil(item.brand.length / 18) * 14 + 8,
      ),
    })),
    { hpt: 28 },
    { hpt: 20 },
  ];

  const thinBorder = {
    top: { style: "thin", color: { rgb: "D8D5CE" } },
    bottom: { style: "thin", color: { rgb: "D8D5CE" } },
    left: { style: "thin", color: { rgb: "D8D5CE" } },
    right: { style: "thin", color: { rgb: "D8D5CE" } },
  };
  const used = XLSX.utils.decode_range(sheet["!ref"]);

  for (let row = used.s.r; row <= used.e.r; row += 1) {
    for (let col = used.s.c; col <= used.e.c; col += 1) {
      const cell = ensureCell(sheet, row, col);
      cell.s = {
        font: { name: "맑은 고딕", sz: 9, color: { rgb: "222222" } },
        alignment: { vertical: "center", wrapText: true },
      };
    }
  }

  sheet.A1.s = {
    fill: { fgColor: { rgb: "171717" } },
    font: { name: "맑은 고딕", sz: 20, bold: true, color: { rgb: "FFFFFF" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  sheet.G1.s = {
    fill: { fgColor: { rgb: "171717" } },
    font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "D8D5CE" } },
    alignment: { horizontal: "right", vertical: "center" },
  };

  for (const address of ["A3", "C3", "E3", "G3"]) {
    sheet[address].s = {
      fill: { fgColor: { rgb: "EEEAE3" } },
      font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "55514B" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
  }

  for (const address of ["A4", "C4", "E4", "G4"]) {
    sheet[address].s = {
      fill: { fgColor: { rgb: "F8F7F3" } },
      font: { name: "맑은 고딕", sz: 10, bold: true, color: { rgb: "222222" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
      border: thinBorder,
    };
  }

  if (referenceLine) {
    sheet[`A${referenceRow + 1}`].s = {
      fill: { fgColor: { rgb: "FFF8F4" } },
      font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "33312E" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: false },
      border: thinBorder,
    };
  }

  sheet[`A${remarkRow + 1}`].s = {
    fill: { fgColor: { rgb: "FFF2EC" } },
    font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "B84629" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: thinBorder,
  };
  sheet[`B${remarkRow + 1}`].s = {
    fill: { fgColor: { rgb: "FFF9F6" } },
    font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "33312E" } },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    border: thinBorder,
  };

  for (let col = 0; col < 8; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: workerRow, c: col })];
    cell.s = {
      fill: { fgColor: { rgb: col % 2 === 0 ? "EEEAE3" : "FFFFFF" } },
      font: { name: "맑은 고딕", sz: 10, bold: col % 2 === 0, color: { rgb: "33312E" } },
      alignment: { horizontal: col % 2 === 0 ? "center" : "left", vertical: "center" },
      border: thinBorder,
    };
  }

  for (let col = 0; col < 8; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
    cell.s = {
      fill: { fgColor: { rgb: "F26B3A" } },
      font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
  }

  data.items.forEach((item, index) => {
    const row = index + firstItemRow;
    for (let col = 0; col < 8; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (col === 1 || col === 4) {
        cell.t = "s";
        cell.v = String(col === 1 ? item.sku : item.barcode);
        cell.z = "@";
      } else if (col === 5) {
        cell.z = "#,##0";
      }
      cell.s = {
        fill: { fgColor: { rgb: index % 2 ? "FAF9F6" : "FFFFFF" } },
        font: {
          name: "맑은 고딕",
          sz: col === 1 || col === 3 ? 8 : 9,
          bold: col === 2 || col === 6,
          color: { rgb: col === 6 ? (item.location ? "D6532F" : "C62828") : "222222" },
        },
        alignment: {
          horizontal: [0, 5, 6, 7].includes(col) ? "center" : "left",
          vertical: "center",
          wrapText: ![1, 4].includes(col),
          shrinkToFit: [1, 4].includes(col),
        },
        border: thinBorder,
      };
    }
  });

  const totalRow = data.items.length + firstItemRow;
  for (let col = 0; col < 8; col += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: totalRow, c: col })];
    cell.s = {
      fill: { fgColor: { rgb: "EDEAE4" } },
      font: { name: "맑은 고딕", sz: 10, bold: true, color: { rgb: "222222" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
  }
  const footerRow = totalRow + 1;
  sheet[XLSX.utils.encode_cell({ r: footerRow, c: 0 })].s = {
    font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "FF7A00" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
  sheet[XLSX.utils.encode_cell({ r: footerRow, c: 0 })].v = `◉ ${PICKING_FOOTER_LABEL}`;

  sheet["!autofilter"] = {
    ref: `A${headerRow + 1}:H${headerRow + 1 + data.items.length}`,
  };
  sheet["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 };
  sheet["!pageSetup"] = {
    paperSize: 9,
    orientation: "portrait",
    fitToWidth: 1,
    fitToHeight: 0,
  };
  sheet["!printArea"] = sheet["!ref"];
  return workbook;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || "").split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function buildPickingPdfCanvases(data = pickingData) {
  const portrait = pickingOrientation === "portrait";
  const documentTitle = pickingDocumentTitle(data);
  const width = portrait ? 1131 : 1600;
  const height = portrait ? 1600 : 1131;
  const margin = 50;
  const bottom = 55;
  const pages = [];
  let page;
  let ctx;
  let y;
  const printedAt = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  function newPage(continuation = "") {
    page = document.createElement("canvas");
    page.width = width;
    page.height = height;
    ctx = page.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, width, 18);
    ctx.strokeStyle = "#f26b3a";
    ctx.lineWidth = 4;
    ctx.strokeRect(margin, 42, 28, 28);
    ctx.beginPath();
    ctx.moveTo(margin + 7, 56);
    ctx.lineTo(margin + 12, 62);
    ctx.lineTo(margin + 22, 49);
    ctx.stroke();
    ctx.font = "800 34px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#171717";
    ctx.fillText(documentTitle, margin + 42, 70);
    ctx.font = "600 17px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#77736d";
    ctx.textAlign = "right";
    ctx.fillText(`${printedAt}${continuation ? ` · ${continuation}` : ""}`, width - margin, 66);
    ctx.textAlign = "left";
    y = 96;
    pages.push(page);
  }

  function drawSummary() {
    const boxes = [
      ["INVOICE", data.invoiceNo],
      ["DATE", data.date || "-"],
      ["CUSTOMER", data.customer || "-"],
      ["TOTAL", `${data.items.length} SKU / ${formatPickingCount(data.totalQuantity)} EA`],
    ];
    const boxWidth = (width - margin * 2 - 24) / 4;
    boxes.forEach(([label, value], index) => {
      const x = margin + index * (boxWidth + 8);
      ctx.fillStyle = "#f3f1ec";
      ctx.fillRect(x, y, boxWidth, 75);
      ctx.fillStyle = "#807c75";
      ctx.font = "700 13px 'Malgun Gothic', sans-serif";
      ctx.fillText(label, x + 14, y + 23);
      ctx.fillStyle = "#1c1c1c";
      ctx.font = "700 19px 'Malgun Gothic', sans-serif";
      const valueLines = wrapCanvasText(ctx, value, boxWidth - 28).slice(0, 2);
      valueLines.forEach((line, i) => ctx.fillText(line, x + 14, y + 50 + i * 20));
    });
    y += 92;
  }

  function drawReferencePairs() {
    const parts = [];
    if (data.salesPerson) parts.push(`영업사원 : ${data.salesPerson}`);
    if (data.shippingCarrier) parts.push(`배송사 : ${data.shippingCarrier}`);
    const text = parts.join("   |   ");
    if (!text) return;

    const rowHeight = 54;
    if (y + rowHeight > height - bottom) newPage("추가 정보");
    ctx.fillStyle = "#fff8f4";
    ctx.fillRect(margin, y, width - margin * 2, rowHeight);
    ctx.strokeStyle = "#ddd8d0";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin, y, width - margin * 2, rowHeight);

    let fontSize = 17;
    do {
      ctx.font = `700 ${fontSize}px 'Malgun Gothic', sans-serif`;
      if (ctx.measureText(text).width <= width - margin * 2 - 28) break;
      fontSize -= 1;
    } while (fontSize > 10);

    ctx.fillStyle = "#33312e";
    ctx.textAlign = "left";
    ctx.fillText(text, margin + 14, y + 34);
    y += rowHeight + 12;
  }

  function drawRemark() {
    ctx.fillStyle = "#fff2ec";
    ctx.fillRect(margin, y, width - margin * 2, 38);
    ctx.fillStyle = "#b84629";
    ctx.font = "800 16px 'Malgun Gothic', sans-serif";
    ctx.fillText("특이사항", margin + 14, y + 25);
    y += 50;
    ctx.fillStyle = "#2a2927";
    ctx.font = "600 16px 'Malgun Gothic', sans-serif";
    const lines = wrapCanvasText(ctx, data.remark || "특이사항 없음", width - margin * 2 - 20);
    lines.forEach((line, index) => {
      if (y + 24 > height - bottom) {
        newPage("특이사항 계속");
        ctx.fillStyle = "#2a2927";
        ctx.font = "600 16px 'Malgun Gothic', sans-serif";
      }
      ctx.fillText(line, margin + 10, y);
      y += 23;
    });
    y += 18;
  }

  function drawWorkerFields() {
    const fields = ["특전 :", "검수 :", "피킹 :", "패킹 :"];
    const gap = 8;
    const fieldWidth = (width - margin * 2 - gap * 3) / 4;
    const rowHeight = 56;
    if (y + rowHeight > height - bottom) newPage("작업자 정보");

    fields.forEach((label, index) => {
      const x = margin + index * (fieldWidth + gap);
      ctx.fillStyle = "#f3f1ec";
      ctx.fillRect(x, y, 72, rowHeight);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 72, y, fieldWidth - 72, rowHeight);
      ctx.strokeStyle = "#d9d5ce";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, fieldWidth, rowHeight);
      ctx.beginPath();
      ctx.moveTo(x + 72, y);
      ctx.lineTo(x + 72, y + rowHeight);
      ctx.stroke();
      ctx.fillStyle = "#33312e";
      ctx.font = "800 16px 'Malgun Gothic', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + 36, y + 35);
    });
    ctx.textAlign = "left";
    y += rowHeight + 18;
  }

  const columns = portrait
    ? [
        ["NO", 45],
        ["SKU", 210],
        ["DESCRIPTION", 270],
        ["BRAND", 115],
        ["BARCODE", 150],
        ["QTY", 55],
        ["LOC", 105],
        ["PACK", 81],
      ]
    : [
        ["NO", 55],
        ["SKU", 205],
        ["DESCRIPTION", 540],
        ["BRAND", 100],
        ["BARCODE", 150],
        ["QTY", 80],
        ["LOCATION", 170],
        ["PACK", 150],
      ];

  function drawTableHeader() {
    let x = margin;
    ctx.fillStyle = "#f26b3a";
    ctx.fillRect(margin, y, columns.reduce((sum, col) => sum + col[1], 0), 44);
    ctx.font = "800 16px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    columns.forEach(([label, colWidth]) => {
      ctx.fillText(label, x + colWidth / 2, y + 28);
      x += colWidth;
    });
    ctx.textAlign = "left";
    y += 44;
  }

  function drawItems() {
    if (y > height - 260) newPage("상품 목록");
    drawTableHeader();

    data.items.forEach((item, itemIndex) => {
      ctx.font = "600 17px 'Malgun Gothic', sans-serif";
      const values = [
        String(item.index),
        item.sku,
        item.description,
        item.brand,
        item.barcode,
        item.quantity,
        item.location || "미등록",
        "",
      ];
      const wrapped = values.map((value, index) =>
        [1, 4].includes(index) ? [String(value)] : wrapCanvasText(ctx, value, columns[index][1] - 16),
      );
      const rowHeight = Math.max(58, Math.max(...wrapped.map((lines) => lines.length)) * 22 + 18);

      if (y + rowHeight > height - bottom) {
        newPage("상품 목록 계속");
        drawTableHeader();
      }

      let x = margin;
      values.forEach((value, colIndex) => {
        const colWidth = columns[colIndex][1];
        ctx.fillStyle = itemIndex % 2 ? "#faf9f6" : "#ffffff";
        ctx.fillRect(x, y, colWidth, rowHeight);
        ctx.strokeStyle = "#d9d5ce";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, colWidth, rowHeight);
        ctx.fillStyle =
          colIndex === 6 ? (item.location ? "#d6532f" : "#c62828") : "#222222";
        let fontSize = colIndex === 2 ? 16 : colIndex === 1 ? 14 : colIndex === 3 ? 13 : 15;
        const fontWeight = colIndex === 6 || colIndex === 2 ? 700 : 500;
        if ([1, 4].includes(colIndex)) {
          ctx.font = `${fontWeight} ${fontSize}px 'Malgun Gothic', sans-serif`;
          while (fontSize > 8 && ctx.measureText(String(value)).width > colWidth - 16) {
            fontSize -= 1;
            ctx.font = `${fontWeight} ${fontSize}px 'Malgun Gothic', sans-serif`;
          }
        } else {
          ctx.font = `${fontWeight} ${fontSize}px 'Malgun Gothic', sans-serif`;
        }
        const centered = [0, 5, 6, 7].includes(colIndex);
        ctx.textAlign = centered ? "center" : "left";
        const lines =
          [1, 4].includes(colIndex) ? [String(value)] : wrapCanvasText(ctx, value, colWidth - 16);
        const startY = y + Math.max(22, (rowHeight - lines.length * 22) / 2 + 17);
        lines.forEach((line, lineIndex) => {
          ctx.fillText(
            line,
            centered ? x + colWidth / 2 : x + 8,
            startY + lineIndex * 22,
          );
        });
        x += colWidth;
      });
      ctx.textAlign = "left";
      y += rowHeight;
    });

    const totalHeight = 48;
    if (y + totalHeight > height - bottom) {
      newPage("합계");
      drawTableHeader();
    }
    ctx.fillStyle = "#edeae4";
    ctx.fillRect(margin, y, columns.reduce((sum, column) => sum + column[1], 0), totalHeight);
    ctx.strokeStyle = "#d9d5ce";
    ctx.strokeRect(margin, y, columns.reduce((sum, column) => sum + column[1], 0), totalHeight);
    ctx.fillStyle = "#222222";
    ctx.font = "800 17px 'Malgun Gothic', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(
      `TOTAL  ${data.items.length} SKU / ${formatPickingCount(data.totalQuantity)} EA`,
      width - margin - 14,
      y + 31,
    );
    ctx.textAlign = "left";
    y += totalHeight;
  }

  newPage();
  drawSummary();
  drawReferencePairs();
  drawRemark();
  drawWorkerFields();
  drawItems();

  pages.forEach((canvas, index) => {
    const footer = canvas.getContext("2d");
    footer.fillStyle = "#8b8780";
    footer.font = "600 13px 'Malgun Gothic', sans-serif";
    footer.textAlign = "left";
    drawPickingFooterMark(footer, margin, height - 20, 14);
    footer.fillText(PICKING_FOOTER_LABEL, margin + 20, height - 17);
    footer.textAlign = "right";
    footer.fillText(`${index + 1} / ${pages.length}`, width - margin, height - 22);
  });
  return pages;
}

async function downloadPickingExcel(sortByLocation = false) {
  if (!pickingData) {
    showPickingMessage("Add invoice file first.", true);
    return;
  }
  const button = sortByLocation ? pickingDom.locationExcelButton : pickingDom.excelButton;
  button.disabled = true;
  showPickingMessage("");
  try {
    const data = sortByLocation ? getLocationSortedPickingData() : pickingData;
    const workbook = buildPickingWorkbook(data);
    const output = XLSX.write(workbook, {
      type: "array",
      bookType: "xlsx",
      cellStyles: true,
      compression: true,
    });
    const baseName = safeOutputBaseName(
      pickingDom.outputName,
      sortByLocation ? "웅툴_피킹리스트" : "웅툴_패킹리스트",
    );
    const outputName = `${baseName}_${pickingOrientation === "portrait" ? "세로" : "가로"}`;
    downloadFile(
      output,
      `${outputName}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    showPickingMessage(
      sortByLocation
        ? "Location 알파벳순 Excel 피킹리스트를 저장했어요."
        : "작업자용 Excel 패킹리스트를 저장했어요.",
    );
  } catch (error) {
    showPickingMessage(error.message || "Excel 생성 중 문제가 발생했습니다.", true);
  } finally {
    button.disabled = false;
  }
}

async function downloadPickingPdf(sortByLocation = false) {
  if (!pickingData) {
    showPickingMessage("Add invoice file first.", true);
    return;
  }
  const button = sortByLocation ? pickingDom.locationPdfButton : pickingDom.pdfButton;
  button.disabled = true;
  showPickingMessage("");
  try {
    const data = sortByLocation ? getLocationSortedPickingData() : pickingData;
    const canvases = buildPickingPdfCanvases(data);
    const pdf = await PDFDocument.create();
    const pageWidth = pickingOrientation === "portrait" ? 595.2756 : 841.8898;
    const pageHeight = pickingOrientation === "portrait" ? 841.8898 : 595.2756;
    for (const canvas of canvases) {
      const image = await pdf.embedPng(canvas.toDataURL("image/png"));
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }
    const output = await pdf.save({ useObjectStreams: true });
    const baseName = safeOutputBaseName(
      pickingDom.outputName,
      sortByLocation ? "웅툴_피킹리스트" : "웅툴_패킹리스트",
    );
    const outputName = `${baseName}_${pickingOrientation === "portrait" ? "세로" : "가로"}`;
    downloadPdf(output, outputName);
    showPickingMessage(
      sortByLocation
        ? `Location 알파벳순 PDF 피킹리스트 ${canvases.length}페이지를 저장했어요.`
        : `작업자용 PDF 패킹리스트 ${canvases.length}페이지를 저장했어요.`,
    );
  } catch (error) {
    showPickingMessage(error.message || "PDF 생성 중 문제가 발생했습니다.", true);
  } finally {
    button.disabled = false;
  }
}

pickingDom.selectButton.addEventListener("click", () => pickingDom.input.click());
pickingDom.input.addEventListener("change", () => inspectPickingFile(pickingDom.input.files[0]));
pickingDom.resetButton.addEventListener("click", resetPickingTool);
pickingDom.excelButton.addEventListener("click", () => downloadPickingExcel());
pickingDom.pdfButton.addEventListener("click", () => downloadPickingPdf());
pickingDom.locationExcelButton.addEventListener("click", () => downloadPickingExcel(true));
pickingDom.locationPdfButton.addEventListener("click", () => downloadPickingPdf(true));
["dragenter", "dragover"].forEach((eventName) => {
  pickingDom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    pickingDom.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  pickingDom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    pickingDom.dropZone.classList.remove("is-dragging");
  });
});

pickingDom.dropZone.addEventListener("drop", (event) => {
  inspectPickingFile(event.dataTransfer.files[0]);
});

const syncDom = {
  content: document.querySelector("#sync-content"),
  dropZone: document.querySelector("#sync-drop-zone"),
  input: document.querySelector("#sync-input"),
  selectButton: document.querySelector("#sync-select-button"),
  workspace: document.querySelector("#sync-workspace"),
  selectedFile: document.querySelector("#sync-workspace .selected-file"),
  fileName: document.querySelector("#sync-file-name"),
  fileInfo: document.querySelector("#sync-file-info"),
  resetButton: document.querySelector("#sync-reset-button"),
  total: document.querySelector("#sync-total"),
  normal: document.querySelector("#sync-normal"),
  noLocation: document.querySelector("#sync-no-location"),
  noStock: document.querySelector("#sync-no-stock"),
  outputName: document.querySelector("#sync-output-name"),
  downloadButton: document.querySelector("#sync-download-button"),
  message: document.querySelector("#sync-message"),
};

let syncFile = null;
let syncResults = [];

function showSyncMessage(text, isError = false) {
  syncDom.message.textContent = text;
  syncDom.message.classList.toggle("error", isError);
  syncDom.message.hidden = !text;
}

function resetSyncTool() {
  syncFile = null;
  syncResults = [];
  syncDom.input.value = "";
  syncDom.workspace.hidden = false;
  syncDom.selectedFile.hidden = true;
  syncDom.dropZone.hidden = false;
  syncDom.total.textContent = "-";
  syncDom.normal.textContent = "-";
  syncDom.noLocation.textContent = "-";
  syncDom.noStock.textContent = "-";
  setIfPresent(syncDom.outputName, "");
  showSyncMessage("");
}

function parseNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function parseStockHtml(text) {
  const documentNode = new DOMParser().parseFromString(text, "text/html");
  const table = documentNode.querySelector("table");
  if (!table) throw new Error("재고 표를 찾지 못했습니다.");
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent.trim()),
  );
  return stockRowsFromMatrix(rows);
}

function stockRowsFromMatrix(rows) {
  let headerIndex = rows.findIndex((row) =>
    row.some((value) => normalizeHeader(value) === "상품코드"),
  );
  if (headerIndex < 0) headerIndex = 1;
  const header = rows[headerIndex] || [];
  let skuColumn = header.findIndex((value) => normalizeHeader(value) === "상품코드");
  let stockColumn = header.findIndex((value) => normalizeHeader(value) === "재고수량");
  if (skuColumn < 0) skuColumn = 1;
  if (stockColumn < 0) stockColumn = 7;

  const items = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const sku = normalizeSku(row[skuColumn]);
    if (!sku || sku === "상품코드") continue;
    items.push({
      sku,
      name: String(row[2] ?? "").trim(),
      brand: String(row[3] ?? "").trim(),
      stock: parseNumber(row[stockColumn]),
    });
  }
  if (!items.length) throw new Error("B열 상품코드 데이터를 찾지 못했습니다.");
  return items;
}

function parseStockWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return stockRowsFromMatrix(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }));
}

async function inspectSyncFile(file) {
  showSyncMessage("");
  if (!file || !/\.(xls|xlsx)$/i.test(file.name)) {
    showSyncMessage("Choose XLS/XLSX.", true);
    return;
  }
  syncDom.selectButton.disabled = true;
  syncDom.selectButton.textContent = "Checking…";
  try {
    const [db, buffer] = await Promise.all([loadGoogleDb(), file.arrayBuffer()]);
    const head = new TextDecoder("utf-8").decode(buffer.slice(0, 200)).toLowerCase();
    const items = head.includes("<html")
      ? parseStockHtml(new TextDecoder("utf-8").decode(buffer))
      : parseStockWorkbook(buffer);

    locationDb = db;
    const inventorySkus = new Set(items.map((item) => item.sku));
    syncResults = items.map((item) => {
      const inDb = locationDb.has(item.sku);
      const location = locationDb.get(item.sku) || "";
      let status = "정상";
      if (item.stock <= 0) status = "재고 없음";
      else if (!inDb) status = "DB 미등록";
      else if (!location) status = "로케이션 없음";
      return { ...item, location, status };
    });
    for (const [sku, location] of locationDb.entries()) {
      if (!inventorySkus.has(sku)) {
        syncResults.push({
          sku,
          name: "",
          brand: "",
          stock: 0,
          location,
          status: "재고 없음",
        });
      }
    }
    syncFile = file;

    const normal = syncResults.filter((item) => item.status === "정상").length;
    const noLocation = syncResults.filter((item) => item.status === "로케이션 없음").length;
    const noStock = syncResults.filter((item) => item.status === "재고 없음").length;
    const notRegistered = syncResults.filter((item) => item.status === "DB 미등록").length;
    syncDom.total.textContent = String(syncResults.length);
    syncDom.normal.textContent = String(normal);
    syncDom.noLocation.textContent = String(noLocation + notRegistered);
    syncDom.noStock.textContent = String(noStock);
    syncDom.fileName.textContent = file.name;
    syncDom.fileInfo.textContent = `${formatBytes(file.size)} · ${syncResults.length.toLocaleString()}개 상품 비교 완료`;
    setIfPresent(syncDom.outputName, `${safeBaseName(file.name)}_로케이션동기화`);
    syncDom.dropZone.hidden = true;
    syncDom.workspace.hidden = false;
    syncDom.selectedFile.hidden = false;
    showSyncMessage(
      `로케이션 확인 필요 ${noLocation}개 · DB 미등록 ${notRegistered}개 · 재고 없음 ${noStock}개`,
      noLocation + notRegistered > 0,
    );
  } catch (error) {
    resetSyncTool();
    showSyncMessage(error.message || "Stock compare failed.", true);
  } finally {
    syncDom.selectButton.disabled = false;
    syncDom.selectButton.textContent = "Choose";
  }
}

function buildSyncWorkbook() {
  const ordered = [...syncResults].sort((a, b) => {
    const priority = { "로케이션 없음": 0, "DB 미등록": 1, "재고 없음": 2, 정상: 3 };
    return priority[a.status] - priority[b.status] || naturalCollator.compare(a.sku, b.sku);
  });
  const rows = [
    ["로케이션 동기화 결과", "", "", "", "", ""],
    ["기준", "재고파일 B열 상품코드 / H열 재고 수량 / DB A열 상품코드 / D열 로케이션", "", "", "", ""],
    ["상태", "상품코드", "상품명", "브랜드", "재고 수량", "로케이션"],
    ...ordered.map((item) => [item.status, item.sku, item.name, item.brand, item.stock, item.location]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "동기화 결과");
  sheet["!merges"] = [XLSX.utils.decode_range("A1:F1"), XLSX.utils.decode_range("B2:F2")];
  sheet["!cols"] = [{ wch: 17 }, { wch: 25 }, { wch: 58 }, { wch: 18 }, { wch: 12 }, { wch: 18 }];
  sheet["!rows"] = [{ hpt: 34 }, { hpt: 25 }, { hpt: 28 }, ...ordered.map((item) => ({ hpt: Math.max(28, Math.ceil(item.name.length / 50) * 16 + 8) }))];

  const border = {
    top: { style: "thin", color: { rgb: "D8D5CE" } },
    bottom: { style: "thin", color: { rgb: "D8D5CE" } },
    left: { style: "thin", color: { rgb: "D8D5CE" } },
    right: { style: "thin", color: { rgb: "D8D5CE" } },
  };
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let row = 0; row <= range.e.r; row += 1) {
    for (let col = 0; col <= range.e.c; col += 1) {
      const cell = ensureCell(sheet, row, col);
      cell.s = {
        font: { name: "맑은 고딕", sz: 9, color: { rgb: "222222" } },
        alignment: { vertical: "center", wrapText: true },
        border: row >= 2 ? border : undefined,
      };
    }
  }
  sheet.A1.s = { fill: { fgColor: { rgb: "171717" } }, font: { name: "맑은 고딕", sz: 20, bold: true, color: { rgb: "FFFFFF" } }, alignment: { vertical: "center" } };
  sheet.A2.s = { fill: { fgColor: { rgb: "EEEAE3" } }, font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "55514B" } }, alignment: { horizontal: "center", vertical: "center" } };
  sheet.B2.s = { fill: { fgColor: { rgb: "F8F7F3" } }, font: { name: "맑은 고딕", sz: 9, color: { rgb: "55514B" } }, alignment: { vertical: "center" } };
  for (let col = 0; col < 6; col += 1) {
    sheet[XLSX.utils.encode_cell({ r: 2, c: col })].s = { fill: { fgColor: { rgb: "217346" } }, font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center" }, border };
  }
  ordered.forEach((item, index) => {
    const row = index + 3;
    const colors = {
      정상: ["F0FAF4", "217346"],
      "로케이션 없음": ["FFF2EE", "B84629"],
      "DB 미등록": ["FFF2EE", "B84629"],
      "재고 없음": ["F3F1F9", "6853A4"],
    }[item.status];
    for (let col = 0; col < 6; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      cell.s = { fill: { fgColor: { rgb: index % 2 ? "FAF9F6" : "FFFFFF" } }, font: { name: "맑은 고딕", sz: col === 0 || col === 5 ? 10 : 9, bold: col === 0 || col === 5, color: { rgb: col === 0 ? colors[1] : "222222" } }, alignment: { horizontal: [0, 4, 5].includes(col) ? "center" : "left", vertical: "center", wrapText: true }, border };
    }
    sheet[XLSX.utils.encode_cell({ r: row, c: 0 })].s.fill = { fgColor: { rgb: colors[0] } };
  });
  sheet["!autofilter"] = { ref: `A3:F${ordered.length + 3}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 3 };
  sheet["!pageSetup"] = { paperSize: 9, orientation: "landscape", fitToWidth: 1, fitToHeight: 0 };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 };
  return workbook;
}

function downloadSyncReport() {
  if (!syncResults.length) {
    showSyncMessage("Add stock file first.", true);
    return;
  }
  syncDom.downloadButton.disabled = true;
  try {
    const workbook = buildSyncWorkbook();
    const output = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true, compression: true });
    const outputName = safeOutputBaseName(syncDom.outputName, "웅툴_로케이션동기화");
    downloadFile(output, `${outputName}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    showSyncMessage("로케이션 동기화 결과 Excel을 저장했어요.");
  } catch (error) {
    showSyncMessage(error.message || "결과 파일 생성 중 문제가 발생했습니다.", true);
  } finally {
    syncDom.downloadButton.disabled = false;
  }
}

syncDom.selectButton.addEventListener("click", () => syncDom.input.click());
syncDom.input.addEventListener("change", () => inspectSyncFile(syncDom.input.files[0]));
syncDom.resetButton.addEventListener("click", resetSyncTool);
syncDom.downloadButton.addEventListener("click", downloadSyncReport);

["dragenter", "dragover"].forEach((eventName) => {
  syncDom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    syncDom.dropZone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  syncDom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    syncDom.dropZone.classList.remove("is-dragging");
  });
});
syncDom.dropZone.addEventListener("drop", (event) => inspectSyncFile(event.dataTransfer.files[0]));

const businessDom = {
  input: document.querySelector("#business-input"),
  messages: document.querySelector("#business-messages"),
  sendButton: document.querySelector("#business-send-button"),
  resetButton: document.querySelector("#business-reset-button"),
  message: document.querySelector("#business-message"),
};

const BUSINESS_SYSTEM_MESSAGE =
  "당신은 웅툴의 한국어 AI 도우미입니다. 간단한 질문, 요약, 아이디어 정리, 번역, 물류·영업 업무 문장 작성을 돕습니다. 기본적으로 짧고 명확하게 한국어로 답하세요. 모르는 사실은 추측하지 말고 모른다고 말하세요. 사용자가 업무 문장을 요청하면 뜻, 업체명, 상품명, 수량, 날짜를 보존하면서 정중하고 자연스럽게 작성하세요.";
let businessHistory = [];
let businessBusy = false;

function showBusinessMessage(text, isError = false) {
  businessDom.message.textContent = text;
  businessDom.message.classList.toggle("error", isError);
  businessDom.message.hidden = !text;
}

function addBusinessMessage(role, text, loading = false) {
  const row = document.createElement("div");
  row.className = `chat-message ${role}`;
  const avatar = document.createElement("span");
  avatar.className = "chat-avatar";
  avatar.textContent = role === "user" ? "나" : "AI";
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble${loading ? " is-loading" : ""}`;
  bubble.textContent = text;
  row.append(avatar, bubble);
  businessDom.messages.append(row);
  businessDom.messages.scrollTop = businessDom.messages.scrollHeight;
  return row;
}

async function sendBusinessMessage() {
  const content = businessDom.input.value.trim();
  if (!content || businessBusy) {
    if (!content) businessDom.input.focus();
    return;
  }

  businessBusy = true;
  businessDom.sendButton.disabled = true;
  businessDom.input.disabled = true;
  businessDom.input.value = "";
  showBusinessMessage("");
  addBusinessMessage("user", content);
  businessHistory.push({ role: "user", content });
  const loadingRow = addBusinessMessage("assistant", "답변을 작성하고 있어요…", true);

  try {
    const response = await fetch("/api/groq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: BUSINESS_SYSTEM_MESSAGE,
        messages: [
          ...businessHistory.slice(-12),
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "AI 연결 실패");
    }
    const answer = String(data.text || "").trim();
    if (!answer) throw new Error("답변 없음");

    loadingRow.remove();
    addBusinessMessage("assistant", answer);
    businessHistory.push({ role: "assistant", content: answer });
  } catch (error) {
    loadingRow.remove();
    addBusinessMessage(
      "assistant",
      error.message || "AI에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
    showBusinessMessage(error.message || "AI 연결을 확인해 주세요.", true);
  } finally {
    businessBusy = false;
    businessDom.sendButton.disabled = false;
    businessDom.input.disabled = false;
    businessDom.input.focus();
  }
}

businessDom.sendButton.addEventListener("click", sendBusinessMessage);
businessDom.resetButton.addEventListener("click", () => {
  if (businessBusy) return;
  businessHistory = [];
  businessDom.input.value = "";
  businessDom.messages.innerHTML = `
    <div class="chat-message assistant">
      <span class="chat-avatar">AI</span>
      <div class="chat-bubble">새 대화를 시작했어요. 무엇을 도와드릴까요?</div>
    </div>
  `;
  showBusinessMessage("");
  businessDom.input.focus();
});
businessDom.input.addEventListener("input", () => showBusinessMessage(""));
businessDom.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendBusinessMessage();
  }
});

const adminDom = {
  passwordGate: document.querySelector("#admin-password-gate"),
  passwordForm: document.querySelector("#admin-password-form"),
  password: document.querySelector("#admin-password"),
  passwordError: document.querySelector("#admin-password-error"),
};

let adminUnlocked = sessionStorage.getItem("woongtoolAdminUnlocked") === "yes";

function updateAdminLock() {
  adminDom.passwordGate.hidden = adminUnlocked;
  if (!adminUnlocked) requestAnimationFrame(() => adminDom.password.focus());
}

async function unlockAdmin(event) {
  event.preventDefault();
  const enteredHash = await sha256(adminDom.password.value);
  if (enteredHash !== PICKING_PASSWORD_HASH) {
    adminDom.passwordError.hidden = false;
    adminDom.password.select();
    return;
  }
  adminUnlocked = true;
  sessionStorage.setItem("woongtoolAdminUnlocked", "yes");
  adminDom.password.value = "";
  adminDom.passwordError.hidden = true;
  updateAdminLock();
}

adminDom.passwordForm.addEventListener("submit", unlockAdmin);
adminDom.password.addEventListener("input", () => {
  adminDom.passwordError.hidden = true;
});

function updateDashboardLock(forceRefresh = false) {
  dashboardDom.passwordGate.hidden = dashboardUnlocked;
  dashboardDom.content.hidden = !dashboardUnlocked;
  if (dashboardUnlocked) {
    startDashboardAutoRefresh();
    loadDashboard(forceRefresh);
  } else {
    requestAnimationFrame(() => dashboardDom.password?.focus());
  }
}

async function unlockDashboard(event) {
  event.preventDefault();
  const enteredHash = await sha256(dashboardDom.password.value);
  if (enteredHash !== DASHBOARD_PASSWORD_HASH) {
    dashboardDom.passwordError.hidden = false;
    dashboardDom.password.select();
    return;
  }
  dashboardUnlocked = true;
  try {
    localStorage.setItem(DASHBOARD_UNLOCK_KEY, "1");
  } catch {
    // 저장소를 사용할 수 없는 브라우저에서는 현재 화면에서만 유지합니다.
  }
  dashboardDom.password.value = "";
  dashboardDom.passwordError.hidden = true;
  updateDashboardLock();
}

dashboardDom.passwordForm?.addEventListener("submit", unlockDashboard);
dashboardDom.password?.addEventListener("input", () => {
  dashboardDom.passwordError.hidden = true;
});

/* ── Dashboard ─────────────────────────────────────────────── */

/* ── Dashboard helpers ──────────────────────────────────────── */

const CARRIER_COLORS = {
  fedex:   { bg: "#4d148c", text: "#fff",    accent: "#ff6600" },
  dhl:     { bg: "#FFCC00", text: "#D40511", accent: null },
  ups:     { bg: "#351C15", text: "#FFB500", accent: null },
  cj:      { bg: "#E30613", text: "#fff",    accent: null },
  forward: { bg: "#1d4ed8", text: "#fff",    accent: null },
  quick:   { bg: "#6b7280", text: "#fff",    accent: null },
  default: { bg: "#334155", text: "#fff",    accent: null },
};

function carrierKey(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("fedex") || n.includes("페덱스")) return "fedex";
  if (n.includes("dhl"))   return "dhl";
  if (n.includes("ups"))   return "ups";
  if (n.includes("cj"))    return "cj";
  if (n.includes("포워드") || n.includes("포워딩")) return "forward";
  if (n.includes("퀵"))    return "quick";
  return "default";
}

function carrierBadgeHtml(name) {
  const key  = carrierKey(name);
  const col  = CARRIER_COLORS[key];
  const label = key === "fedex"
    ? `<span style="color:#fff">Fed</span><span style="color:#ff6600">Ex</span>`
    : name.slice(0, 6);
  return `<span class="carrier-badge" style="background:${col.bg};color:${col.text}">${label}</span>`;
}

function carrierDisplayHtml(name) {
  const text = String(name || "");
  const match = text.match(/(fed)\s*ex(.*)/i) || text.match(/(fedex)(.*)/i) || text.match(/(페덱스)(.*)/i);
  if (match) {
    const rest = match[2] || "";
    return `Fed<span class="fedex-accent">Ex</span>${rest}`;
  }
  return text;
}

const PICKING_FOOTER_LABEL = "웅툴 - 업무를 가볍고 빠르게";

function drawPickingFooterMark(ctx, x, y, size = 14) {
  ctx.save();
  ctx.fillStyle = "#ff7a00";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y - size + 1, size, size, 4);
    ctx.fill();
  } else {
    ctx.fillRect(x, y - size + 1, size, size);
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.max(9, Math.floor(size * 0.75))}px 'Malgun Gothic', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("U", x + size / 2, y - size / 2 + 1);
  ctx.restore();
}

const ICON_BOX = `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/>
  <path d="M12 3v18"/>
  <path d="M3 8l9 5 9-5"/>
</svg>`;

const ICON_PLT = `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="1" y="19" width="22" height="2.5" rx="1"/>
  <rect x="2" y="12" width="9" height="7" rx="1"/>
  <rect x="13" y="12" width="9" height="7" rx="1"/>
  <rect x="6" y="6" width="12" height="6" rx="1"/>
</svg>`;

const ICON_MONEY = `<span class="stat-icon money-icon" aria-hidden="true">₩</span>`;

const ICON_DOC = `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14,2 14,8 20,8"/>
  <line x1="8" y1="13" x2="16" y2="13"/>
  <line x1="8" y1="17" x2="13" y2="17"/>
</svg>`;

function setDashStatus(state, text) {
  const el = document.querySelector("#dashboard-sheet-status");
  el.className = `sheet-badge ${state ? `is-${state}` : ""}`;
  el.innerHTML = `<span class="status-dot"></span>${text}`;
}

// ASCII-only callback key prevents JSONP breakage with Korean sheet names
function fetchDashSheet(asciiKey, sheetName, range, parsedNumHeaders) {
  return new Promise((resolve, reject) => {
    const callbackName = `woongtoolDash${asciiKey}${Date.now()}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      script.remove();
      delete window[callbackName];
      reject(new Error(`${sheetName} 탭 연결 시간이 초과됐습니다.`));
    }, 15000);

    window[callbackName] = (response) => {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (!response || response.status === "error" || !response.table) {
        reject(new Error(`${sheetName} 탭 내용을 읽을 수 없습니다.`));
      } else {
        resolve(response.table);
      }
    };

    const tqx = encodeURIComponent(`out:json;responseHandler:${callbackName}`);
    const encodedSheet = encodeURIComponent(sheetName);
    let url = `https://docs.google.com/spreadsheets/d/${DASH_SHEET_ID}/gviz/tq` +
      `?sheet=${encodedSheet}&tqx=${tqx}&t=${Date.now()}`;
    if (range)          url += `&range=${encodeURIComponent(range)}`;
    if (parsedNumHeaders != null) url += `&headers=${parsedNumHeaders}`;
    script.src = url;
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      reject(new Error(`${sheetName} 탭을 불러오지 못했습니다.`));
    };
    document.head.append(script);
  });
}

function fmtKrw(value) {
  const n = Math.round(Number(String(value ?? "").replace(/[^\d.-]/g, "")));
  if (!n) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

function fmtKrwSpaced(value) {
  const n = Math.round(Number(String(value ?? "").replace(/[^\d.-]/g, "")));
  if (!n) return "-";
  return `${n.toLocaleString("ko-KR")} 원`;
}

function fmtNum(value) {
  const n = Number(value);
  if (!n && n !== 0) return "-";
  return n.toLocaleString("ko-KR");
}

function fmtUsd(value) {
  const n = Number(value);
  if (!n && n !== 0) return "-";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtComma(value) {
  const n = parseNumber(value);
  if (!n && n !== 0) return "-";
  return n.toLocaleString("ko-KR");
}

function dashboardUnitTotal(value, fallback = "0") {
  const text = String(value ?? "").trim();
  const numericText = text.replace(/[^\d.-]/g, "");
  if (numericText && Number.isFinite(Number(numericText))) {
    return Number(numericText).toLocaleString("ko-KR");
  }
  return fmtComma(fallback);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dashCell(cells, idx) {
  return String(gvizCellValue(cells[idx] ?? null) ?? "").trim();
}

function normalizeCarrierName(text) {
  const raw = String(text ?? "").replace(/\s+/g, "").toLowerCase();
  if (raw === "fedex코어" || raw === "fedexcore") return "FedEx 코어";
  if (raw === "fedexpickup" || raw === "fedex픽업" || raw === "픽업fedex" || raw === "pickupfedex") return "픽업 FedEx";
  if (raw === "ups코어" || raw === "upscore") return "UPS 코어";
  if (raw === "upspickup" || raw === "ups픽업" || raw === "픽업ups" || raw === "pickupups") return "픽업UPS";
  if (raw === "dhl픽업" || raw === "dhlpickup") return "DHL 픽업";
  return text;
}

function workerUnitCount(worker = "", unit = "box") {
  const match = String(worker || "").match(new RegExp(`\\b([\\d,]+)\\s*${unit}\\b`, "i"));
  return match ? parseNumber(match[1]) : 0;
}

const MAT_UNITS = { "뽕뽕이": "봉지", "테이프": "BOX", "투명랩": "BOX" };

function fmtMatQty(name, raw) {
  if (!raw || raw === "-") return "-";
  const n = parseInt(raw, 10);
  if (!n && n !== 0) return raw;
  const unit = MAT_UNITS[name.trim()] || "PLT";
  return `${n} ${unit}`;
}

// ── 입고 렌더 ──────────────────────────────────────────────────
function renderIncoming(table, totalsTable) {
  const rows = table.rows;

  // M3:M4 range 전용 fetch → tRows[0].c[0]=M3(PLT), tRows[1].c[0]=M4(BOX)
  const tRows = totalsTable?.rows || [];
  const pltTotal = dashCell(tRows[0]?.c || [], 0) || "0";
  const boxTotal = dashCell(tRows[1]?.c || [], 0) || "0";

  // data: rows where col B (index 1) has PC서류번호
  const dataRows = rows.filter((row) => {
    const b = dashCell(row.c || [], 1);
    return b.startsWith("PC");
  });

  let totalAmt = 0;
  let totalItem = 0;
  let totalQty = 0;
  const vendorMap = new Map();

  const tbody = document.querySelector("#dash-in-table tbody");
  tbody.replaceChildren();
  const fragment = document.createDocumentFragment();

  dataRows.forEach((row) => {
    const cells  = row.c || [];
    const vendor = dashCell(cells, 3);
    const qty    = gvizCellValue(cells[7] ?? null);
    const box    = gvizCellValue(cells[8] ?? null);
    const amt    = gvizCellValue(cells[9] ?? null);
    const buri   = dashCell(cells, 10);
    const note   = dashCell(cells, 17) || "-";
    const baecha = dashCell(cells, 13) || "-";

    if (typeof box === "number") vendorMap.set(vendor, (vendorMap.get(vendor) || 0) + box);
    totalItem += parseNumber(qty);
    totalQty += parseNumber(box);
    if (typeof amt === "number") totalAmt += amt;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="tag-cell">${dashCell(cells, 0)}</td>
      <td>${dashCell(cells, 1)}</td>
      <td>${vendor}</td>
      <td class="num-cell dash-item-value">${fmtNum(qty)}</td>
      <td class="num-cell dash-qty-value">${fmtNum(box)}</td>
      <td class="amount-cell">${fmtKrw(amt)}</td>
      <td class="tag-cell">${buri ? `<span class="dash-unit-badge ${queueWorkerClass(buri)}">${escapeHtml(buri)}</span>` : "-"}</td>
      <td>${baecha}</td>
      <td>${note}</td>
    `;
    fragment.append(tr);
  });
  tbody.append(fragment);

  if (!dataRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">데이터가 없습니다.</td>`;
    tbody.append(tr);
  }

  document.querySelector("#dash-in-summary").innerHTML = `
    <div class="queue-summary-card"><span>입고</span><strong>${dataRows.length.toLocaleString("ko-KR")}</strong></div>
    <div class="queue-summary-card"><span>Item</span><strong class="dash-item-value">${totalItem.toLocaleString("ko-KR")}</strong></div>
    <div class="queue-summary-card"><span>수량</span><strong class="dash-qty-value">${totalQty.toLocaleString("ko-KR")}</strong></div>
    <div class="queue-summary-card"><span>금액</span><strong class="dashboard-amount-value">${fmtKrwSpaced(totalAmt)}</strong></div>
  `;

  const incomingHero = document.querySelector("#dash-incoming .dashboard-hero");
  if (incomingHero) {
    incomingHero.innerHTML = `
      <div><h3>입고 현황</h3></div>
      <div class="queue-complete-total" aria-label="입고 BOX PLT 합계">
        <span>BOX <b>${fmtComma(boxTotal)}</b></span>
        <span>PLT <b>${fmtComma(pltTotal)}</b></span>
      </div>`;
  }

  dashboardState.incoming = {
    summary: {
      count: dataRows.length,
      pltTotal,
      boxTotal,
      itemTotal: totalItem,
      qtyTotal: totalQty,
      totalAmt,
    },
    rows: dataRows.map((row) => {
      const cells = row.c || [];
      return [
        dashCell(cells, 0),
        dashCell(cells, 1),
        dashCell(cells, 3),
        fmtNum(gvizCellValue(cells[7] ?? null)),
        fmtNum(gvizCellValue(cells[8] ?? null)),
        fmtKrw(gvizCellValue(cells[9] ?? null)),
        dashCell(cells, 10) || "-",
        dashCell(cells, 13) || "-",
        dashCell(cells, 17) || "-",
      ];
    }),
  };

  const chartWrap = document.querySelector("#dash-in-chart");
  if (chartWrap) {
    chartWrap.innerHTML = "";
    chartWrap.hidden = true;
  }
}

// ── 출고 렌더 ──────────────────────────────────────────────────
function renderOutgoing(table, matRows, totalsTable, album = null, albumOutgoingRows = []) {
  const rows = table.rows;

  // L3:N4 range 전용 fetch → 금액은 기존 요약값을 유지
  const tRows = totalsTable?.rows || [];
  const amtStr   = dashCell(tRows[0]?.c || [], 2) || "-";  // N3
  const displayAmtStr = fmtKrwSpaced(amtStr);

  // data: rows where col B (index 1) has IN번호
  const dataRows = rows.filter((row) => {
    const b = dashCell(row.c || [], 1);
    return b.startsWith("IN");
  });

  const tbody = document.querySelector("#dash-out-table tbody");
  tbody.replaceChildren();
  const fragment = document.createDocumentFragment();
  let totalItem = 0;
  let totalQty = 0;

  dataRows.forEach((row) => {
    const cells   = row.c || [];
    const item    = dashCell(cells, 8) || "-";              // I col
    const qty     = dashCell(cells, 9) || "-";              // J col
    const amt     = gvizCellValue(cells[10] ?? null);       // K col (dollar)
    const carrier = dashCell(cells, 11) || "-";             // L col
    const note    = dashCell(cells, 14) || "-";             // O col

    totalItem += parseNumber(item);
    totalQty += parseNumber(qty);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dashCell(cells, 1)}</td>
      <td>${dashCell(cells, 3)}</td>
      <td class="tag-cell">${carrierBadgeHtml(carrier)}</td>
      <td class="num-cell dash-item-value">${item}</td>
      <td class="num-cell dash-qty-value">${qty}</td>
      <td class="tag-cell">${note}</td>
    `;
    fragment.append(tr);
  });
  tbody.append(fragment);

  if (!dataRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">데이터가 없습니다.</td>`;
    tbody.append(tr);
  }

  const albumRows = (albumOutgoingRows || [])
    .map((row) => ({
      invoiceNo: String(row.invoiceNo || "").trim(),
      customer: String(row.customer || "").trim(),
      carrier: normalizeCarrierName(String(row.carrier || "").trim()),
      item: fmtComma(row.item),
      qty: fmtComma(row.qty),
      worker: String(row.worker || "").trim(),
      progress: String(row.progress || "").trim(),
    }))
    .filter((row) => row.invoiceNo);

  const fallbackOutgoingRows = dataRows.map((row) => {
    const cells = row.c || [];
    return {
      invoiceNo: dashCell(cells, 1),
      customer: dashCell(cells, 3),
      carrier: normalizeCarrierName(dashCell(cells, 11) || "-"),
      item: dashCell(cells, 8) || "-",
      qty: dashCell(cells, 9) || "-",
      worker: dashCell(cells, 14) || "-",
    };
  });
  const visibleOutgoingRows = albumRows.length ? albumRows : fallbackOutgoingRows;
  const visibleOutgoingCount = visibleOutgoingRows.length;
  const visibleTotalItem = visibleOutgoingRows.reduce((sum, row) => sum + parseNumber(row.item), 0);
  const visibleTotalQty = visibleOutgoingRows.reduce((sum, row) => sum + parseNumber(row.qty), 0);
  const visibleBoxTotal = visibleOutgoingRows.reduce((sum, row) => sum + workerUnitCount(row.worker, "box"), 0);
  const visiblePltTotal = visibleOutgoingRows.reduce((sum, row) => sum + workerUnitCount(row.worker, "plt"), 0);

  if (albumRows.length) {
    tbody.replaceChildren();
    const albumFragment = document.createDocumentFragment();
    albumRows.forEach((row, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.invoiceNo)}</td>
        <td>${escapeHtml(row.customer || "-")}</td>
        <td class="tag-cell">${row.carrier ? carrierBadgeHtml(row.carrier) : "-"}</td>
        <td class="num-cell dash-item-value">${escapeHtml(row.item || "-")}</td>
        <td class="num-cell dash-qty-value">${escapeHtml(row.qty || "-")}</td>
        <td class="tag-cell">${row.worker ? `<span class="dash-unit-badge ${queueWorkerClass(row.worker)}">${escapeHtml(row.worker)}</span>` : "-"}</td>
      `;
      albumFragment.append(tr);
    });
    tbody.append(albumFragment);
  }

  const listCountEl = document.querySelector("#dash-out-list-count");
  if (listCountEl) listCountEl.textContent = `${visibleOutgoingCount.toLocaleString("ko-KR")}건`;

  document.querySelector("#dash-out-summary").innerHTML = `
    <div class="queue-summary-card"><span>출고</span><strong>${visibleOutgoingCount.toLocaleString("ko-KR")}</strong></div>
    <div class="queue-summary-card"><span>Item</span><strong class="dash-item-value">${visibleTotalItem.toLocaleString("ko-KR")}</strong></div>
    <div class="queue-summary-card"><span>수량</span><strong class="dash-qty-value">${visibleTotalQty.toLocaleString("ko-KR")}</strong></div>
    <div class="queue-summary-card"><span>금액</span><strong class="dashboard-amount-value">${displayAmtStr}</strong></div>
  `;

  const outgoingHero = document.querySelector("#dash-outgoing .dashboard-hero");
  if (outgoingHero) {
    outgoingHero.innerHTML = `
      <div><h3>출고 현황</h3></div>
      <div class="queue-complete-total" aria-label="출고 BOX PLT 합계">
        <span>BOX <b>${visibleBoxTotal.toLocaleString("ko-KR")}</b></span>
        <span>PLT <b>${visiblePltTotal.toLocaleString("ko-KR")}</b></span>
      </div>`;
  }

  dashboardState.outgoing = {
    summary: {
      count: visibleOutgoingCount,
      pltTotal: visiblePltTotal.toLocaleString("ko-KR"),
      boxTotal: visibleBoxTotal.toLocaleString("ko-KR"),
      itemTotal: visibleTotalItem,
      qtyTotal: visibleTotalQty,
      amtStr: displayAmtStr,
    },
    rows: (albumRows.length ? albumRows.map((row) => [
      row.invoiceNo,
      row.customer || "-",
      row.carrier || "-",
      row.item || "-",
      row.qty || "-",
      row.worker || "-",
    ]) : dataRows.map((row) => {
      const cells = row.c || [];
      return [
        dashCell(cells, 1),
        dashCell(cells, 3),
        normalizeCarrierName(dashCell(cells, 11) || "-"),
        dashCell(cells, 8) || "-",
        dashCell(cells, 9) || "-",
        dashCell(cells, 14) || "-",
      ];
    })),
    carriers: [],
  };

  const chartWrap = document.querySelector("#dash-out-chart");
  if (chartWrap) {
    chartWrap.hidden = false;

    const carrierMap = new Map();
    visibleOutgoingRows.forEach((row) => {
      const carrierName = normalizeCarrierName(row.carrier || "-") || "-";
      const current = carrierMap.get(carrierName) || {
        name: carrierName,
        key: carrierKey(carrierName),
        invoice: 0,
        box: 0,
        plt: 0,
      };
      current.invoice += 1;
      current.box += workerUnitCount(row.worker, "box");
      current.plt += workerUnitCount(row.worker, "plt");
      carrierMap.set(carrierName, current);
    });

    const order = ["DHL", "DHL 픽업", "픽업UPS", "UPS 코어", "FedEx 코어", "픽업 FedEx", "FedEx", "포워드", "CJ 택배", "퀵", "3층전달"];
    const carriers = Array.from(carrierMap.values()).sort((a, b) => {
      const aIndex = order.indexOf(a.name);
      const bIndex = order.indexOf(b.name);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      return a.name.localeCompare(b.name, "ko-KR");
    });

    dashboardState.outgoing.carriers = carriers.map((c) => ({
      name: normalizeCarrierName(c.name),
      invoice: c.invoice || 0,
      box: c.box || 0,
      plt: c.plt || 0,
    }));

    const cards = carriers.map((c) => {
      const col = CARRIER_COLORS[c.key] || CARRIER_COLORS.default;
      const isEmpty = c.invoice === 0 && c.box === 0;
      return `<div class="carrier-card${isEmpty ? " carrier-card-empty" : ""}">
        <div class="carrier-card-header" style="background:${col.bg}">
          <span class="carrier-badge carrier-badge-card" style="background:rgba(255,255,255,.15);color:${col.text};border:1px solid rgba(255,255,255,.25)">${carrierDisplayHtml(normalizeCarrierName(c.name))}</span>
        </div>
        <div class="carrier-card-body">
          <div class="carrier-stat">
            <span class="cstat-num dash-item-value">${c.invoice || 0}</span>
            <span class="cstat-label">건</span>
          </div>
          <div class="carrier-stat carrier-stat-unit">
            <span class="dash-unit-badge is-box">${c.box ? `${c.box.toLocaleString("ko-KR")} BOX` : "- BOX"}</span>
          </div>
          <div class="carrier-stat carrier-stat-unit">
            <span class="dash-unit-badge is-plt">${c.plt ? `${c.plt.toLocaleString("ko-KR")} PLT` : "- PLT"}</span>
          </div>
        </div>
      </div>`;
    }).join("");

    chartWrap.innerHTML = cards
      ? `<div class="carrier-cards-grid">${cards}</div>`
      : `<div class="dash-empty-card">출고 리스트 데이터가 없습니다.</div>`;
  }
}

function queueStage(progress = "") {
  const text = String(progress || "").trim();
  if (text === "완료") return "완료";
  if (text.includes("검수")) return "검수";
  if (text.includes("패킹")) return "패킹";
  if (text.includes("피킹")) return "피킹";
  if (text.includes("출력")) return "출력";
  if (text.includes("완료")) return "완료";
  return text || "대기";
}

function queueProgressLabel(progress = "") {
  const text = String(progress || "").trim();
  return text || queueStage(progress);
}

function queueProgressClass(progress = "") {
  const text = String(progress || "").trim();
  if (text.includes("패킹중")) return "is-packing";
  if (text.includes("피킹")) return "is-picking";
  return "";
}

function queueStatus(worker = "", progress = "") {
  const workerText = String(worker || "").trim();
  const progressText = String(progress || "").trim();
  if (progressText === "완료") return "완료";
  if (workerText && !/box/i.test(workerText)) return "작업중";
  if (progressText.includes("완료")) return "작업중";
  return "대기";
}

function queueWorkerName(worker = "") {
  const text = String(worker || "").trim();
  return text;
}

function queueWorkerClass(worker = "") {
  const text = String(worker || "").trim();
  if (/\b\d+\s*box\b/i.test(text)) return "is-box";
  if (/\b\d+\s*plt\b/i.test(text)) return "is-plt";
  return "";
}

function queueCarrierIconHtml(name = "") {
  const text = String(name || "").trim() || "-";
  const key = carrierKey(text);
  const fedexLogo = (suffix = "", prefix = "") => `${prefix}Fed<span>Ex</span>${suffix}`;
  const label = key === "fedex"
    ? text.includes("픽업")
      ? fedexLogo("", "픽업 ")
      : text.includes("코어")
        ? fedexLogo(" 코어")
        : fedexLogo()
    : key === "dhl"
      ? "DHL"
      : key === "ups"
        ? text.includes("픽업")
          ? "픽업UPS"
          : text.includes("코어")
            ? "UPS 코어"
            : "UPS"
        : key === "cj"
          ? "CJ"
          : text.includes("3층")
            ? "3F"
            : key === "forward"
              ? "포워드"
              : escapeHtml(text.slice(0, 4));
  return `<span class="queue-carrier-icon ${key}" title="${escapeHtml(text)}">${label}</span>`;
}

function groupCount(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || "-";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1] || naturalCollator.compare(a[0], b[0]));
}

function renderQueue(items = []) {
  const container = document.querySelector("#dash-queue-content");
  if (!container) return;

  const rows = (items || [])
    .map((item) => ({
      invoiceNo: String(item.invoiceNo || "").trim(),
      customer: String(item.customer || "").trim(),
      carrier: normalizeCarrierName(String(item.carrier || "").trim()),
      item: fmtComma(item.item),
      qty: fmtComma(item.qty),
      worker: queueWorkerName(item.worker),
      progress: String(item.progress || "").trim(),
    }))
    .filter((item) => item.invoiceNo && (item.customer || item.carrier));

  if (!rows.length) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:32px">출고대기 데이터를 찾지 못했습니다.</p>`;
    dashboardState.shippingQueue = {
      headers: ["Invoice No", "거래처", "배송사", "Item", "수량", "작업", "진행"],
      rows: [],
    };
    return;
  }

  const totalItem = rows.reduce((sum, row) => sum + parseNumber(row.item), 0);
  const totalQty = rows.reduce((sum, row) => sum + parseNumber(row.qty), 0);
  const workingCount = rows.filter((row) => queueStatus(row.worker, row.progress) === "작업중").length;
  const stageOrder = ["출력", "피킹", "패킹", "검수", "완료", "대기"];
  const activeRows = rows.filter((row) => ["출력", "피킹", "패킹", "검수"].includes(queueStage(row.progress)));
  const stageGroups = groupCount(activeRows, (row) => queueStage(row.progress))
    .sort((a, b) => {
      const ai = stageOrder.indexOf(a[0]);
      const bi = stageOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  const packedRows = rows.filter((row) => /\b\d+\s*(box|plt)\b/i.test(row.worker));
  const carrierGroups = groupCount(packedRows, (row) => row.carrier).slice(0, 8);
  const packedBoxTotal = packedRows.reduce((sum, row) => {
    const match = String(row.worker || "").match(/\b(\d+)\s*box\b/i);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  const packedPltTotal = packedRows.reduce((sum, row) => {
    const match = String(row.worker || "").match(/\b(\d+)\s*plt\b/i);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);

  function progressPercent(stage) {
    const index = stageOrder.indexOf(stage);
    if (index < 0) return 12;
    return Math.min(100, Math.max(12, Math.round(((index + 1) / (stageOrder.length - 1)) * 100)));
  }

  container.innerHTML = `
    <div class="queue-hero">
      <div>
        <h3>출고대기 현황</h3>
      </div>
      <div class="queue-complete-total" aria-label="작업완료 BOX PLT 합계">
        <span>BOX <b>${packedBoxTotal.toLocaleString("ko-KR")}</b></span>
        <span>PLT <b>${packedPltTotal.toLocaleString("ko-KR")}</b></span>
      </div>
    </div>
    <div class="queue-summary-grid">
      <div class="queue-summary-card"><span>Invoice</span><strong>${rows.length.toLocaleString("ko-KR")}</strong></div>
      <div class="queue-summary-card"><span>Item</span><strong class="dash-item-value">${totalItem.toLocaleString("ko-KR")}</strong></div>
      <div class="queue-summary-card"><span>수량</span><strong class="dash-qty-value">${totalQty.toLocaleString("ko-KR")}</strong></div>
      <div class="queue-summary-card is-working"><span>작업중</span><strong>${workingCount.toLocaleString("ko-KR")}</strong></div>
    </div>
    <div class="queue-stage-pills">
      <button class="queue-stage-filter is-active" type="button" data-stage="all"><span>전체</span><b>${activeRows.length.toLocaleString("ko-KR")}</b></button>
      ${stageGroups.map(([stage, count]) => `<button class="queue-stage-filter" type="button" data-stage="${escapeHtml(stage)}"><span>${escapeHtml(stage)}</span><b>${count}</b></button>`).join("")}
    </div>
    <div class="queue-split-grid">
      <div class="queue-active-column">
        <div class="queue-panel-spacer" aria-hidden="true"></div>
        ${renderQueuePanel("진행중", activeRows, "active", true)}
      </div>
      <div class="queue-packed-column">
        <div class="queue-carrier-pills" aria-label="패킹완료 배송사 필터">
          <button class="queue-carrier-filter is-active" type="button" data-carrier="all"><span>전체</span><b>${packedRows.length}</b></button>
          ${carrierGroups.map(([name, count]) => `<button class="queue-carrier-filter" type="button" data-carrier="${escapeHtml(name)}">${queueCarrierIconHtml(name)}<b>${count}</b></button>`).join("")}
        </div>
        ${renderQueuePanel("패킹완료", packedRows, "packed", false)}
      </div>
    </div>`;

  requestAnimationFrame(adjustQueuePanelAlignment);

  function renderQueuePanel(title, panelRows, type, showProgress) {
    return `
      <section class="queue-panel ${type}">
        <div class="queue-panel-title">
          <h3>${escapeHtml(title)}</h3>
          <span class="queue-panel-count" data-panel-count="${type}">${panelRows.length.toLocaleString("ko-KR")}건</span>
        </div>
        <div class="queue-panel-head ${showProgress ? "" : "no-progress"}">
          <span>Invoice</span><span>거래처</span><span>배송</span><span>Item</span><span>수량</span><span>작업</span>${showProgress ? "<span>진행</span>" : ""}
        </div>
        <div class="queue-panel-list">
      ${panelRows.length ? panelRows.map((row) => {
        const status = queueStatus(row.worker, row.progress);
        const stage = queueStage(row.progress);
        const progressLabel = queueProgressLabel(row.progress);
        return `
          <div class="queue-row ${showProgress ? "" : "no-progress"} ${status === "완료" ? "is-done" : status === "작업중" ? "is-working" : ""}" data-panel="${type}" data-carrier="${escapeHtml(row.carrier)}" data-stage="${escapeHtml(stage)}">
            <strong class="queue-invoice">${escapeHtml(row.invoiceNo)}</strong>
            <span class="queue-row-customer">${escapeHtml(row.customer)}</span>
            <span class="queue-row-carrier">${queueCarrierIconHtml(row.carrier)}</span>
            <span class="queue-row-number queue-row-item">${escapeHtml(row.item)}</span>
            <span class="queue-row-number queue-row-qty">${escapeHtml(row.qty)}</span>
            <span class="queue-row-worker ${queueWorkerClass(row.worker)}">${row.worker ? escapeHtml(row.worker) : "대기"}</span>
            ${showProgress ? `<div class="queue-row-progress">
              <span class="queue-stage-badge ${queueProgressClass(row.progress)}">${escapeHtml(progressLabel)}</span>
              <i><b style="width:${progressPercent(stage)}%"></b></i>
            </div>` : ""}
          </div>`;
      }).join("") : `<p class="queue-empty">표시할 데이터가 없습니다.</p>`}
        </div>
      </section>`;
  }

  function applyCarrierFilter(carrier) {
    const target = carrier || "all";
    container.querySelectorAll(".queue-carrier-filter").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.carrier === target);
    });
    container.querySelectorAll('.queue-row[data-panel="packed"][data-carrier]').forEach((row) => {
      row.hidden = target !== "all" && row.dataset.carrier !== target;
    });
    const visibleCount = container.querySelectorAll('.queue-row[data-panel="packed"]:not([hidden])').length;
    const packedCountEl = container.querySelector('[data-panel-count="packed"]');
    if (packedCountEl) packedCountEl.textContent = `${visibleCount.toLocaleString("ko-KR")}건`;
  }

  function applyStageFilter(stage) {
    const target = stage || "all";
    container.querySelectorAll(".queue-stage-filter").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.stage === target);
    });
    container.querySelectorAll('.queue-row[data-panel="active"][data-stage]').forEach((row) => {
      row.hidden = target !== "all" && row.dataset.stage !== target;
    });
    const visibleCount = container.querySelectorAll('.queue-row[data-panel="active"]:not([hidden])').length;
    const activeCountEl = container.querySelector('[data-panel-count="active"]');
    if (activeCountEl) activeCountEl.textContent = `${visibleCount.toLocaleString("ko-KR")}건`;
  }

  container.querySelectorAll(".queue-carrier-filter").forEach((button) => {
    button.addEventListener("click", () => applyCarrierFilter(button.dataset.carrier));
  });
  container.querySelectorAll(".queue-stage-filter").forEach((button) => {
    button.addEventListener("click", () => applyStageFilter(button.dataset.stage));
  });

  dashboardState.shippingQueue = {
    headers: ["Invoice No", "거래처", "배송사", "Item", "수량", "작업", "진행"],
    rows: rows.map((row) => [
      row.invoiceNo,
      row.customer,
      row.carrier,
      row.item,
      row.qty,
      row.worker || queueStatus(row.worker, row.progress),
      row.progress || queueStage(row.progress),
    ]),
  };
}

function adjustQueuePanelAlignment() {
  const container = document.querySelector("#dash-queue-content");
  const carrierFilterBar = container?.querySelector(".queue-packed-column .queue-carrier-pills");
  const activeSpacer = container?.querySelector(".queue-panel-spacer");
  if (!carrierFilterBar || !activeSpacer) return;
  const filterHeight = carrierFilterBar.offsetHeight;
  if (!filterHeight) return;
  activeSpacer.style.height = `${filterHeight}px`;
  activeSpacer.style.minHeight = `${filterHeight}px`;
}

// ── 자재현황 렌더 ───────────────────────────────────────────────
function renderMaterials(matTable) {
  const container = document.querySelector("#dash-materials-content");
  container.replaceChildren();

  const rows = matTable.rows;
  function rowCells(idx) {
    return (rows[idx]?.c || []).map((cell) => String(gvizCellValue(cell ?? null) ?? "").trim());
  }

  // 시트 앞부분의 행이 추가되어도 "박스 / 포장용품" 구분 행을 기준으로 찾습니다.
  const categoryRowIndex = rows.findIndex((row, index) => {
    const cells = rowCells(index);
    return cells.includes("박스") && cells.includes("포장용품");
  });
  const matHeaders = rowCells(categoryRowIndex >= 0 ? categoryRowIndex + 1 : 11);
  const matQtys    = rowCells(categoryRowIndex >= 0 ? categoryRowIndex + 2 : 12);

  const boxItems  = [];
  const packItems = [];
  for (let i = 2; i < matHeaders.length; i++) {
    const name = matHeaders[i];
    if (!name || name === "-") continue;
    const qty = fmtMatQty(name, matQtys[i]);
    if (qty === "-") continue;
    if (i <= 9) boxItems.push({ name, qty });
    else packItems.push({ name, qty });
  }

  if (!boxItems.length && !packItems.length) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:32px">부자재 데이터를 찾지 못했습니다.</p>`;
    return;
  }

  const materialHero = document.createElement("div");
  materialHero.className = "queue-hero dashboard-hero";
  materialHero.innerHTML = `<div><h3>자재현황</h3></div>`;
  container.append(materialHero);

  function svgDataUri(svg) {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function materialIcon(name) {
    const kind = name.includes("뽕뽕")
      ? "air"
      : name.includes("테이프")
        ? "tape"
        : name.includes("랩") || name.includes("필름")
          ? "wrap"
          : "box";
    const colors = {
      box: { stroke: "#d97706", fill: "#fff7ed" },
      air: { stroke: "#0284c7", fill: "#ecfeff" },
      tape: { stroke: "#ea580c", fill: "#fff1e8" },
      wrap: { stroke: "#059669", fill: "#ecfdf5" },
    };
    const { stroke, fill } = colors[kind] || colors.box;
    const svg = kind === "air"
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
          <rect x="5" y="5" width="54" height="54" rx="16" fill="${fill}"/>
          <path d="M20 44h22c6.6 0 12-4.7 12-10.5S42.6 23 36 23c-1.9 0-3.7.4-5.3 1.1C29 18.8 24.5 15 19 15c-6.1 0-11 4.6-11 10.4 0 4.6 3 8.4 7.2 9.9C15.8 40.6 17.6 44 20 44Z" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M19 50h18" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round"/>
        </svg>`
      : kind === "tape"
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
            <rect x="5" y="5" width="54" height="54" rx="16" fill="${fill}"/>
            <rect x="12" y="16" width="34" height="32" rx="14" stroke="${stroke}" stroke-width="3.4" />
            <circle cx="29" cy="32" r="7" stroke="${stroke}" stroke-width="3.4" />
            <path d="M46 24h6c2.2 0 4 1.8 4 4v8c0 2.2-1.8 4-4 4h-6" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round"/>
            <path d="M16 24h8" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round"/>
          </svg>`
        : kind === "wrap"
          ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
              <rect x="5" y="5" width="54" height="54" rx="16" fill="${fill}"/>
              <rect x="14" y="15" width="36" height="34" rx="8" stroke="${stroke}" stroke-width="3.4" />
              <path d="M20 23h24M20 32h24M20 41h16" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round"/>
            </svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
              <rect x="5" y="5" width="54" height="54" rx="16" fill="${fill}"/>
              <path d="m12 22 20-10 20 10-20 10-20-10Z" stroke="${stroke}" stroke-width="3.4" stroke-linejoin="round"/>
              <path d="M12 22v20l20 10 20-10V22" stroke="${stroke}" stroke-width="3.4" stroke-linejoin="round"/>
              <path d="M32 32v20" stroke="${stroke}" stroke-width="3.4" stroke-linecap="round"/>
            </svg>`;
    const label = kind === "air" ? "AIR" : kind === "tape" ? "TAPE" : kind === "wrap" ? "WRAP" : "BOX";
    return `<img class="mat-visual-icon ${kind}" alt="${label}" src="${svgDataUri(svg)}" />`;
  }

  if (boxItems.length) {
    const card = document.createElement("div");
    card.className = "dash-materials-card is-box-stock";
    card.innerHTML = `
      <h3>박스 재고</h3>
      <div class="mat-item-grid">
        ${boxItems.map((m) => `<div class="mat-item">${materialIcon(m.name)}<div class="mat-item-meta"><span class="mat-item-name">${m.name}</span><strong class="mat-item-qty dash-qty-value">${m.qty}</strong></div></div>`).join("")}
      </div>`;
    container.append(card);
  }

  if (packItems.length) {
    const card = document.createElement("div");
    card.className = "dash-materials-card is-pack-stock";
    card.innerHTML = `
      <h3>포장용품</h3>
      <div class="mat-item-grid">
        ${packItems.map((m) => `<div class="mat-item">${materialIcon(m.name)}<div class="mat-item-meta"><span class="mat-item-name">${m.name}</span><strong class="mat-item-qty dash-qty-value">${m.qty}</strong></div></div>`).join("")}
      </div>`;
    container.append(card);
  }

  dashboardState.materials = {
    boxItems,
    packItems,
  };
}

function renderPersonnel(rows = []) {
  const container = document.querySelector("#dash-personnel-content");
  if (!container) return;

  const cleanRows = rows
    .map((row) => Array.from({ length: 8 }, (_, index) => String(row?.[index] ?? "").trim()))
    .filter((row) => row.some(Boolean));

  if (!cleanRows.length) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:32px">인원 데이터를 찾지 못했습니다.</p>`;
    dashboardState.personnel = {
      headers: ["설명", "성별", "나이", "입사일", "상태"],
      rows: [],
    };
    return;
  }

  const summaryItems = [];
  const employees = [];

  function personnelStartDateKey(value = "") {
    const text = String(value || "").trim();
    const match = text.match(/(\d{2,4})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    let year = Number(match[1]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const month = Number(match[2]);
    const day = Number(match[3]);
    return year * 10000 + month * 100 + day;
  }

  cleanRows.forEach((row) => {
    const [name, genderCount, gender, age, startDate, , label, value] = row;
    if ((name === "男" || name === "女") && genderCount) {
      summaryItems.push({
        label: name === "男" ? "남성" : "여성",
        value: genderCount,
        tone: name === "男" ? "male" : "female",
      });
    }
    if (label && value) {
      summaryItems.push({
        label: label.replace(/\s+/g, ""),
        value,
        tone: label.includes("출근") ? "present" : label.includes("총원") ? "total" : "rest",
      });
    }
    if (name && name !== "男" && name !== "女" && !name.includes("이름") && (gender === "男" || gender === "女")) {
      employees.push({
        name,
        gender,
        age,
        startDate,
        status: label || "",
      });
    }
  });

  employees.sort((a, b) =>
    personnelStartDateKey(a.startDate) - personnelStartDateKey(b.startDate) ||
    naturalCollator.compare(a.name, b.name)
  );

  const uniqueSummary = [];
  const seenSummary = new Set();
  const summaryOrder = ["총원", "출근", "남성", "여성"];
  summaryItems
    .sort((a, b) => {
      const ai = summaryOrder.indexOf(a.label);
      const bi = summaryOrder.indexOf(b.label);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .forEach((item) => {
    const key = `${item.label}:${item.value}`;
    if (!seenSummary.has(key)) {
      seenSummary.add(key);
      uniqueSummary.push(item);
    }
  });

  container.innerHTML = `
    <div class="personnel-hero dashboard-hero">
      <div>
        <h3>음반팀 인원 현황</h3>
      </div>
    </div>
    <div class="personnel-summary-grid">
      ${uniqueSummary.slice(0, 4).map((item) => `
        <div class="personnel-summary-card ${item.tone}">
          <strong>${escapeHtml(item.label)}</strong>
          <em>${escapeHtml(item.value)}</em>
        </div>`).join("")}
    </div>
    <div class="personnel-card-grid">
      ${employees.map((person) => `
        <article class="person-card ${person.gender === "男" ? "is-male" : "is-female"}">
          <div class="person-avatar">${person.gender === "男" ? "男" : "女"}</div>
          <div class="person-info">
            <strong>${escapeHtml(person.name)}</strong>
            <div class="person-meta">
              ${person.age ? `<span>${escapeHtml(person.age)}세</span>` : ""}
              ${person.startDate ? `<span>입사일 ${escapeHtml(person.startDate)}</span>` : ""}
            </div>
          </div>
          ${person.status ? `<span class="person-status">${escapeHtml(person.status)}</span>` : ""}
        </article>`).join("")}
    </div>`;

  dashboardState.personnel = {
    headers: ["설명", "성별", "나이", "입사일", "상태"],
    rows: employees.map((person) => [
      person.name,
      person.gender,
      person.age,
      person.startDate,
      person.status || "-",
    ]),
  };
}

function dashboardExportReady() {
  if (!dashboardState.incoming || !dashboardState.shippingQueue || !dashboardState.outgoing || !dashboardState.personnel || !dashboardState.materials) {
    throw new Error("대시보드 데이터를 아직 불러오지 못했어요.");
  }
}

function dashboardBlankRow(width) {
  return Array.from({ length: width }, () => "");
}

function dashboardBuildWorkbookSheet(title, widths, header, rows, summaryRows = []) {
  const matrix = [
    [title, ...dashboardBlankRow(widths.length - 1)],
    [`생성일자 : ${seoulDateString()}`, ...dashboardBlankRow(widths.length - 1)],
    ...summaryRows,
    dashboardBlankRow(widths.length),
    header,
    ...rows,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbookSheetName = title.replace(/^웅툴 - /, "").slice(0, 31);
  const titleRange = `A1:${XLSX.utils.encode_col(widths.length - 1)}1`;
  const dateRange = `A2:${XLSX.utils.encode_col(widths.length - 1)}2`;
  const headerRow = summaryRows.length + 3;
  const lastRow = matrix.length - 1;
  const lastCol = widths.length - 1;
  const border = {
    top: { style: "thin", color: { rgb: "D8D5CE" } },
    bottom: { style: "thin", color: { rgb: "D8D5CE" } },
    left: { style: "thin", color: { rgb: "D8D5CE" } },
    right: { style: "thin", color: { rgb: "D8D5CE" } },
  };

  sheet["!merges"] = [XLSX.utils.decode_range(titleRange), XLSX.utils.decode_range(dateRange)];
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  sheet["!rows"] = matrix.map((_, row) => ({ hpt: row === 0 ? 28 : row === 1 ? 20 : row === headerRow ? 24 : 22 }));
  sheet["!autofilter"] = { ref: `A${headerRow + 1}:${XLSX.utils.encode_col(lastCol)}${lastRow + 1}` };

  for (let row = 0; row <= lastRow; row += 1) {
    for (let col = 0; col <= lastCol; col += 1) {
      const cell = ensureCell(sheet, row, col);
      const isTitle = row === 0;
      const isDate = row === 1;
      const isHeader = row === headerRow;
      const isSummary = row >= 2 && row < 2 + summaryRows.length;
      cell.s = {
        font: {
          name: "맑은 고딕",
          sz: isTitle ? 15 : isHeader ? 10 : 9,
          bold: isTitle || isHeader,
          color: { rgb: isTitle ? "FFFFFF" : "222222" },
        },
        alignment: {
          horizontal: isTitle ? "left" : isHeader ? "center" : "left",
          vertical: "center",
          wrapText: true,
        },
        border: row >= headerRow ? border : undefined,
        fill: isTitle
          ? { fgColor: { rgb: "171717" } }
          : isHeader
            ? { fgColor: { rgb: "EDEAE4" } }
            : isSummary
              ? { fgColor: { rgb: "F8F7F3" } }
              : undefined,
      };
      if (isDate && col > 0) cell.v = "";
    }
  }

  return { sheet, workbookSheetName };
}

function buildDashboardWorkbook() {
  dashboardExportReady();

  const workbook = XLSX.utils.book_new();

  const incoming = dashboardState.incoming;
  const incomingSummary = [
    ["요약", `${incoming.summary.count}건`, `${incoming.summary.pltTotal} PLT`, `${incoming.summary.boxTotal} BOX`, fmtKrwSpaced(incoming.summary.totalAmt), "", "", "", ""],
  ];
  const incomingSheet = dashboardBuildWorkbookSheet(
    "웅툴 - 입고",
    [8, 16, 20, 10, 10, 14, 12, 12, 20],
    ["번호", "서류번호", "거래처", "수량", "BOX", "금액", "부피", "배차", "특이사항"],
    incoming.rows,
    incomingSummary,
  );
  XLSX.utils.book_append_sheet(workbook, incomingSheet.sheet, incomingSheet.workbookSheetName);

  const queueSheet = dashboardBuildWorkbookSheet(
    "웅툴 - 출고대기",
    [18, 24, 16, 10, 10, 16, 14],
    dashboardState.shippingQueue.headers,
    dashboardState.shippingQueue.rows,
    [["요약", `${dashboardState.shippingQueue.rows.length}건`, "", "", "", "", ""]],
  );
  XLSX.utils.book_append_sheet(workbook, queueSheet.sheet, queueSheet.workbookSheetName);

  const outgoing = dashboardState.outgoing;
  const outgoingSummary = [
    ["요약", `${outgoing.summary.count}건`, `${outgoing.summary.itemTotal} item`, `${outgoing.summary.qtyTotal} EA`, outgoing.summary.amtStr, "", ""],
  ];
  const outgoingSheet = dashboardBuildWorkbookSheet(
    "웅툴 - 출고",
    [18, 24, 16, 10, 10, 16],
    ["Invoice", "거래처", "배송사", "item", "수량", "작업"],
    outgoing.rows,
    outgoingSummary,
  );
  XLSX.utils.book_append_sheet(workbook, outgoingSheet.sheet, outgoingSheet.workbookSheetName);

  const personnelSheet = dashboardBuildWorkbookSheet(
    "웅툴 - 인원",
    [20, 12, 10, 14, 14],
    dashboardState.personnel.headers,
    dashboardState.personnel.rows,
  );
  XLSX.utils.book_append_sheet(workbook, personnelSheet.sheet, personnelSheet.workbookSheetName);

  const materials = dashboardState.materials;
  const materialRows = [
    ...materials.boxItems.map((item) => ["박스 재고", item.name, item.qty]),
    ...materials.packItems.map((item) => ["포장용품", item.name, item.qty]),
  ];
  const materialsSheet = dashboardBuildWorkbookSheet(
    "웅툴 - 자재현황",
    [14, 22, 14],
    ["구분", "자재명", "수량"],
    materialRows,
  );
  XLSX.utils.book_append_sheet(workbook, materialsSheet.sheet, materialsSheet.workbookSheetName);

  return workbook;
}

async function downloadDashboardExcel() {
  if (typeof XLSX === "undefined") {
    return;
  }
  const button = dashboardDom.excelButton;
  if (!button) return;
  try {
    button.disabled = true;
    setDashboardExportButton(button, "excel", "저장중");
    const workbook = buildDashboardWorkbook();
    const output = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true, compression: true });
    downloadFile(output, `${dashboardFileBase()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } catch (error) {
    setDashStatus("error", error.message || "Excel 저장 실패");
  } finally {
    button.disabled = false;
    setDashboardExportButton(button, "excel", "엑셀");
  }
}

function setDashboardExportButton(button, type, label) {
  const icon = type === "pdf"
    ? `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.8h6.8L15.8 6v11.2H5z"/><path d="M12 2.8V6h3.8"/><path d="M7 10h6M7 13h5"/></svg>`
    : `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h8l4 4v10H4z"/><path d="M12 3v4h4"/><path d="M7 8l6 6M13 8l-6 6"/></svg>`;
  button.innerHTML = `${icon}<span>${escapeHtml(label)}</span>`;
}

function fitCanvasText(ctx, text, maxWidth) {
  const raw = String(text ?? "");
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  const ellipsis = "…";
  let current = raw;
  while (current.length > 0 && ctx.measureText(`${current}${ellipsis}`).width > maxWidth) {
    current = current.slice(0, -1);
  }
  return current ? `${current}${ellipsis}` : ellipsis;
}

function drawDashboardRow(ctx, x, y, widths, values, options = {}) {
  const height = options.height || 30;
  const fill = options.fill || "#ffffff";
  const textColor = options.textColor || "#222222";
  const borderColor = options.borderColor || "#d8d5ce";
  const font = options.font || "500 17px 'Malgun Gothic', sans-serif";
  const align = options.align || [];
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, widths.reduce((sum, width) => sum + width, 0), height);
  let offset = x;
  widths.forEach((width, index) => {
    ctx.strokeRect(offset, y, width, height);
    ctx.font = font;
    ctx.fillStyle = textColor;
    ctx.textBaseline = "middle";
    const pad = 10;
    const text = fitCanvasText(ctx, values[index] ?? "", width - pad * 2);
    const alignment = align[index] || "left";
    let drawX = offset + pad;
    if (alignment === "center") {
      ctx.textAlign = "center";
      drawX = offset + width / 2;
    } else if (alignment === "right") {
      ctx.textAlign = "right";
      drawX = offset + width - pad;
    } else {
      ctx.textAlign = "left";
    }
    ctx.fillText(text, drawX, y + height / 2 + 1);
    offset += width;
  });
  ctx.restore();
}

function buildDashboardSectionCanvases(title, summaryLines, headers, rows, widths) {
  const pages = [];
  const pageWidth = 1684;
  const pageHeight = 1190;
  const margin = 44;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const rowsPerPage = 24;
  const chunks = [];
  for (let index = 0; index < rows.length; index += rowsPerPage) {
    chunks.push(rows.slice(index, index + rowsPerPage));
  }
  if (!chunks.length) chunks.push([]);

  chunks.forEach((chunk, chunkIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    ctx.fillStyle = "#171717";
    ctx.font = "700 34px 'Malgun Gothic', sans-serif";
    ctx.fillText(title, margin, 62);

    ctx.fillStyle = "#6b665f";
    ctx.font = "500 18px 'Malgun Gothic', sans-serif";
    ctx.fillText(`생성일자 : ${seoulDateString()}`, margin, 92);

    let y = 120;
    summaryLines.forEach((line) => {
      ctx.fillStyle = "#f8f7f3";
      ctx.strokeStyle = "#ddd9d1";
      ctx.lineWidth = 1;
      ctx.fillRect(margin, y, tableWidth, 42);
      ctx.strokeRect(margin, y, tableWidth, 42);
      ctx.fillStyle = "#44413b";
      ctx.font = "600 18px 'Malgun Gothic', sans-serif";
      ctx.fillText(line, margin + 14, y + 27);
      y += 48;
    });

    y += 4;
    drawDashboardRow(ctx, margin, y, widths, headers, {
      height: 42,
      fill: "#edeae4",
      font: "700 18px 'Malgun Gothic', sans-serif",
      textColor: "#36332e",
      align: headers.map((_, index) => (index === headers.length - 1 ? "left" : index === 3 || index === 4 || index === 5 ? "center" : "left")),
    });
    y += 42;

    chunk.forEach((row, rowIndex) => {
      drawDashboardRow(ctx, margin, y, widths, row, {
        height: 38,
        fill: rowIndex % 2 ? "#fbfaf7" : "#ffffff",
        font: "500 16px 'Malgun Gothic', sans-serif",
        textColor: "#222222",
        align: row.map((_, index) => (index === 0 || index === 3 || index === 4 ? "center" : index === 5 ? "right" : "left")),
      });
      y += 38;
    });

    ctx.fillStyle = "#8b8780";
    ctx.font = "600 16px 'Malgun Gothic', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("웅툴 - 업무를 가볍고 빠르게", margin, pageHeight - 20);
    ctx.textAlign = "right";
    ctx.fillText(`${chunkIndex + 1} / ${chunks.length}`, pageWidth - margin, pageHeight - 20);

    pages.push(canvas);
  });

  return pages;
}

async function downloadDashboardPdf() {
  const button = dashboardDom.pdfButton;
  if (!button) return;
  try {
    button.disabled = true;
    setDashboardExportButton(button, "pdf", "저장중");
    dashboardExportReady();

    const incomingPages = buildDashboardSectionCanvases(
      "입고",
      [
        `총 입고 건수 : ${dashboardState.incoming.summary.count}건`,
        `총 입고 PLT : ${dashboardState.incoming.summary.pltTotal} / 총 입고 BOX : ${dashboardState.incoming.summary.boxTotal}`,
        `총 입고 금액 : ${fmtKrwSpaced(dashboardState.incoming.summary.totalAmt)}`,
      ],
      ["번호", "서류번호", "거래처", "수량", "BOX", "금액", "부피", "배차", "특이사항"],
      dashboardState.incoming.rows,
      [80, 160, 220, 90, 90, 140, 130, 120, 480],
    );

    const outgoingPages = buildDashboardSectionCanvases(
      "출고",
      [
        `총 출고 건수 : ${dashboardState.outgoing.summary.count}건`,
        `총 출고 PLT : ${dashboardState.outgoing.summary.pltTotal} / 총 출고 BOX : ${dashboardState.outgoing.summary.boxTotal}`,
        `총 출고 금액 : ${dashboardState.outgoing.summary.amtStr}`,
      ],
      ["Invoice", "거래처", "배송사", "item", "수량", "작업"],
      dashboardState.outgoing.rows,
      [150, 240, 150, 80, 90, 150],
    );

    const queuePages = buildDashboardSectionCanvases(
      "출고대기",
      [`총 출고대기 : ${dashboardState.shippingQueue.rows.length}건`],
      dashboardState.shippingQueue.headers,
      dashboardState.shippingQueue.rows,
      [150, 240, 150, 80, 90, 150, 120],
    );

    const materialRows = [
      ...dashboardState.materials.boxItems.map((item) => ["박스 재고", item.name, item.qty]),
      ...dashboardState.materials.packItems.map((item) => ["포장용품", item.name, item.qty]),
    ];
    const personnelPages = buildDashboardSectionCanvases(
      "인원",
      ["인원 탭 AC15:AJ97"],
      dashboardState.personnel.headers,
      dashboardState.personnel.rows,
      [220, 110, 90, 130, 140],
    );
    const materialPages = buildDashboardSectionCanvases(
      "자재현황",
      ["박스 재고 / 포장용품"],
      ["구분", "자재명", "수량"],
      materialRows,
      [220, 780, 180],
    );
    const pdf = await PDFDocument.create();
    const pageWidth = 841.8898;
    const pageHeight = 595.2756;

    for (const canvas of [...incomingPages, ...queuePages, ...outgoingPages, ...personnelPages, ...materialPages]) {
      const image = await pdf.embedPng(canvas.toDataURL("image/png"));
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }

    const output = await pdf.save({ useObjectStreams: true });
    downloadPdf(output, dashboardFileBase());
  } catch (error) {
    setDashStatus("error", error.message || "PDF 저장 실패");
  } finally {
    button.disabled = false;
    setDashboardExportButton(button, "pdf", "PDF");
  }
}

let dashLoaded = false;
let dashboardRefreshTimer = null;
let dashboardLoading = false;

async function loadDashboardFromServer() {
  const response = await fetch(`/api/dashboard?t=${Date.now()}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "대시보드 API 연결 실패");
  renderIncoming(data.incoming, data.incomingTotals);
  renderQueue(data.shippingQueue);
  renderOutgoing(data.outgoing, data.minho?.rows, data.outgoingTotals, data.album, data.albumOutgoing);
  renderPersonnel(data.personnel);
  renderMaterials(data.minho);
}

async function loadDashboardFromPublicSheet() {
  const [inTable, outTable, matTable] = await Promise.all([
    fetchDashSheet("In",  "입고"),
    fetchDashSheet("Out", "출고"),
    fetchDashSheet("Mat", "민호", null, 0),
  ]);

  const [inTotals, outTotals] = await Promise.all([
    fetchDashSheet("InT",  "입고", "M3:M4"),
    fetchDashSheet("OutT", "출고", "L3:N4"),
  ]);

  renderIncoming(inTable, inTotals);
  renderQueue([]);
  renderOutgoing(outTable, matTable.rows, outTotals);
  renderPersonnel([]);
  renderMaterials(matTable);
}

async function loadDashboard(force = false) {
  if (dashboardLoading) return;
  if (dashLoaded && !force) return;
  dashboardLoading = true;
  setDashStatus("loading", "데이터 불러오는 중");

  try {
    try {
      await loadDashboardFromServer();
    } catch (serverError) {
      console.warn("Dashboard API fallback:", serverError);
      await loadDashboardFromPublicSheet();
    }
    setDashStatus("ready", "데이터 연결 완료");
    dashLoaded = true;
  } catch (error) {
    setDashStatus("error", "데이터 연결 실패");
    const errHtml = `<p style="color:var(--danger,#ef4444);text-align:center;padding:32px">${error.message}</p>`;
    ["dash-in-summary", "dash-out-summary", "dash-materials-content"].forEach((id) => {
      const el = document.querySelector(`#${id}`);
      if (el) el.innerHTML = errHtml;
    });
    renderQueue([]);
    renderPersonnel([]);
  } finally {
    dashboardLoading = false;
  }
}

function startDashboardAutoRefresh() {
  if (dashboardRefreshTimer) return;
  dashboardRefreshTimer = setInterval(() => {
    const dashboardVisible = !document.querySelector("#dashboard-tool")?.hidden;
    const dashboardContentVisible = !dashboardDom.content?.hidden;
    if (dashboardVisible && dashboardContentVisible && document.visibilityState === "visible") {
      loadDashboard(true);
    }
  }, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !document.querySelector("#dashboard-tool")?.hidden && !dashboardDom.content?.hidden) {
    loadDashboard(true);
  }
  if (document.visibilityState === "visible") {
    refreshGoogleBackedTool(currentToolName());
  }
});

setInterval(() => {
  if (document.visibilityState !== "visible") return;
  refreshGoogleBackedTool(currentToolName());
}, 60000);

/* ── 로케이션 파악 ───────────────────────────────────────────── */
function renderLocCheckResults(barcodes, targetLoc) {
  const results = document.querySelector("#loc-check-results");
  if (!barcodeDb) {
    results.innerHTML = `<p class="loc-check-error">DB가 아직 연결되지 않았습니다. DB 연결 후 다시 시도하세요.</p>`;
    return;
  }

  const items = barcodes.map((bc) => {
    const dbLoc = barcodeDb.get(bc);
    const match = dbLoc ? dbLoc.toUpperCase() === targetLoc.toUpperCase() : null;
    let status, cls;
    if (match === null) { status = "미등록"; cls = "loc-unknown"; }
    else if (match)     { status = "일치"; cls = "loc-match"; }
    else                { status = "불일치"; cls = "loc-mismatch"; }
    return { bc, dbLoc, match, status, cls };
  });

  const matchCount   = items.filter(i => i.match === true).length;
  const noMatchCount = items.filter(i => i.match === false).length;
  const noRegCount   = items.filter(i => i.match === null).length;

  function buildRows(filter) {
    return items
      .filter(i => filter === "all" || i.cls === filter)
      .map(i => `<div class="loc-row ${i.cls}">
        <span class="loc-bc">${i.bc}</span>
        <span class="loc-arrow">·</span>
        <span class="loc-target">${targetLoc}</span>
        <span class="loc-status-pill">${i.status}</span>
        ${i.match === false && i.dbLoc ? `<span class="loc-actual">(DB: ${i.dbLoc})</span>` : ""}
        ${i.match === null ? `<span class="loc-actual">(DB 미등록)</span>` : ""}
      </div>`)
      .join("");
  }

  results.innerHTML = `
    <div class="loc-filter-btns">
      <button class="loc-filter-btn active" data-filter="all">전체 <span>${items.length}</span></button>
      <button class="loc-filter-btn loc-filter-match" data-filter="loc-match">일치 <span>${matchCount}</span></button>
      <button class="loc-filter-btn loc-filter-mismatch" data-filter="loc-mismatch">불일치 <span>${noMatchCount}</span></button>
      <button class="loc-filter-btn loc-filter-unknown" data-filter="loc-unknown">미등록 <span>${noRegCount}</span></button>
    </div>
    <div class="loc-rows" id="loc-rows-body">${buildRows("all")}</div>`;

  results.querySelectorAll(".loc-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      results.querySelectorAll(".loc-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector("#loc-rows-body").innerHTML = buildRows(btn.dataset.filter);
    });
  });
}

document.querySelector("#loc-check-button")?.addEventListener("click", () => {
  const raw = (document.querySelector("#loc-check-input")?.value || "").trim();
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    document.querySelector("#loc-check-results").innerHTML =
      `<p class="loc-check-error">바코드와 로케이션을 입력해주세요. (마지막 줄 = 로케이션 코드)</p>`;
    return;
  }
  const targetLoc = lines[lines.length - 1];
  const barcodes  = lines.slice(0, -1);

  if (!barcodeDb) {
    loadGoogleDb().then(() => renderLocCheckResults(barcodes, targetLoc))
      .catch((e) => {
        document.querySelector("#loc-check-results").innerHTML =
          `<p class="loc-check-error">${e.message}</p>`;
      });
  } else {
    renderLocCheckResults(barcodes, targetLoc);
  }
});

document.querySelectorAll(".dash-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".dash-tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const target = tab.dataset.dash;
    document.querySelectorAll(".dash-panel").forEach((panel) => {
      panel.hidden = panel.id !== `dash-${target}`;
    });
    loadDashboard(true);
    if (target === "queue") requestAnimationFrame(adjustQueuePanelAlignment);
  });
});

window.addEventListener("resize", () => {
  if (!document.querySelector("#dash-queue")?.hidden) requestAnimationFrame(adjustQueuePanelAlignment);
});

if (dashboardDom.excelButton) {
  dashboardDom.excelButton.addEventListener("click", downloadDashboardExcel);
}

if (dashboardDom.pdfButton) {
  dashboardDom.pdfButton.addEventListener("click", downloadDashboardPdf);
}

brandHome.addEventListener("click", (event) => {
  event.preventDefault();
  showHome();
});
