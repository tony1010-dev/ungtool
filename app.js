const { PDFDocument } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const themeButtons = document.querySelectorAll(".theme-button");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

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

applyTheme(document.documentElement.dataset.themeMode || "system", false);

const dom = {
  dropZone: document.querySelector("#drop-zone"),
  zipInput: document.querySelector("#zip-input"),
  selectButton: document.querySelector("#select-button"),
  workspace: document.querySelector("#workspace"),
  selectedFile: document.querySelector("#workspace .selected-file"),
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

let selectedZip = null;
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

const labelDom = {
  company: document.querySelector("#label-company"),
  invoice: document.querySelector("#label-invoice"),
  boxCount: document.querySelector("#label-box-count"),
  copyCount: document.querySelector("#label-copy-count"),
  outputName: document.querySelector("#label-output-name"),
  previewCompany: document.querySelector("#label-preview-company"),
  previewInvoice: document.querySelector("#label-preview-invoice"),
  previewBox: document.querySelector("#label-preview-box"),
  downloadButton: document.querySelector("#label-download-button"),
  message: document.querySelector("#label-message"),
};

function labelValues() {
  return {
    company: labelDom.company.value.trim() || "House of Kpop Pte Ltd",
    invoice: labelDom.invoice.value.trim().replace(/^#\s*/, "") || "IN00443990",
    boxes: Math.max(1, Number(labelDom.boxCount.value) || 1),
    copies: Math.min(200, Math.max(1, Number(labelDom.copyCount.value) || 1)),
  };
}

function updateLabelPreview() {
  const values = labelValues();
  labelDom.previewCompany.textContent = values.company;
  labelDom.previewInvoice.textContent = `# ${values.invoice}`;
  labelDom.previewBox.textContent = `${values.boxes} BOX`;
}

function showLabelMessage(text, isError = false) {
  labelDom.message.textContent = text;
  labelDom.message.classList.toggle("error", isError);
  labelDom.message.hidden = !text;
}

function fitCanvasFont(ctx, text, maxWidth, startSize, minSize = 42) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `800 ${size}px Arial, "Malgun Gothic", sans-serif`;
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
  ctx.font = `800 ${companySize}px Arial, "Malgun Gothic", sans-serif`;
  ctx.fillText(values.company, 750, 305);

  const invoiceText = `# ${values.invoice}`;
  const invoiceSize = fitCanvasFont(ctx, invoiceText, 1400, 150, 62);
  ctx.font = `800 ${invoiceSize}px Arial, "Malgun Gothic", sans-serif`;
  ctx.fillText(invoiceText, 750, 515);

  const boxText = `${values.boxes} BOX`;
  const boxSize = fitCanvasFont(ctx, boxText, 1400, 200, 82);
  ctx.font = `900 ${boxSize}px Arial, "Malgun Gothic", sans-serif`;
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
    const outputName = safeBaseName(labelDom.outputName.value) || "LABEL";
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
  ctx.font = `800 ${canvasFontSize}px Arial, "Malgun Gothic", sans-serif`;
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
    const outputName = safeBaseName(customLabelDom.outputName.value) || "CUSTOM_LABEL";
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

const DEFAULT_HOME_NOTICE = `2026.06.19 | Genesis Release

• Label 출력: 업체명 · Invoice No. · Box Qty PDF 자동 생성
• PDF Merge (ZIP): ZIP 내 PDF 자동 병합
• UPS 출력: A4 UPS Label → 10×15cm Thermal Label 변환
• 피킹리스트 출력: SKU · Location 매핑 Excel / PDF 생성
• 로케이션 동기화: 재고 데이터와 DB 비교로 누락 · 미등록 · 재고없음 검증`;
const homePanel = document.querySelector("#home-panel");
const homeNoticeText = document.querySelector("#home-notice-text");
const brandHome = document.querySelector("#brand-home");

function displayHomeNotice(notice) {
  const lines = String(notice).split(/\r?\n/);
  const title = lines.shift()?.trim() || "";
  const details = lines.filter((line) => line.trim());
  homeNoticeText.replaceChildren();

  const titleElement = document.createElement("div");
  titleElement.className = "notice-version";
  titleElement.textContent = title;
  homeNoticeText.append(titleElement);

  if (details.length) {
    const list = document.createElement("ul");
    list.className = "notice-feature-list";
    details.forEach((line) => {
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
    homeNoticeText.append(list);
  }
  return notice;
}

function loadHomeNotice() {
  return displayHomeNotice(DEFAULT_HOME_NOTICE);
}

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
  selectedZip = null;
  pdfEntries = [];
  dom.zipInput.value = "";
  dom.workspace.hidden = false;
  dom.selectedFile.hidden = true;
  dom.dropZone.hidden = false;
  dom.pdfList.replaceChildren();
  dom.fileCount.textContent = "0개";
  dom.outputName.value = "";
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

async function loadZip(file) {
  showMessage("");

  if (!file || !file.name.toLowerCase().endsWith(".zip")) {
    showMessage("ZIP 형식의 파일을 선택해 주세요.", true);
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    showMessage("500MB보다 큰 파일은 브라우저 메모리 부족으로 실패할 수 있어요.", true);
  }

  dom.selectButton.disabled = true;
  dom.selectButton.textContent = "확인 중…";

  try {
    const archive = await JSZip.loadAsync(file);
    const entries = Object.values(archive.files)
      .filter(
        (entry) =>
          !entry.dir &&
          entry.name.toLowerCase().endsWith(".pdf") &&
          !entry.name.includes("__MACOSX/") &&
          !entry.name.split("/").at(-1).startsWith("._"),
      )
      .sort((a, b) => naturalCollator.compare(a.name, b.name));

    if (!entries.length) {
      throw new Error("ZIP 파일 안에서 PDF를 찾지 못했어요.");
    }

    selectedZip = file;
    pdfEntries = entries;
    dom.zipName.textContent = file.name;
    dom.zipSize.textContent = formatBytes(file.size);
    dom.outputName.value = `${safeBaseName(file.name)}_병합`;
    renderPdfList();
    dom.dropZone.hidden = true;
    dom.workspace.hidden = false;
    dom.selectedFile.hidden = false;
  } catch (error) {
    selectedZip = null;
    pdfEntries = [];
    showMessage(error.message || "ZIP 파일을 열 수 없어요. 파일을 다시 확인해 주세요.", true);
  } finally {
    dom.selectButton.disabled = false;
    dom.selectButton.textContent = "파일 선택";
  }
}

async function mergePdfs() {
  if (!selectedZip || !pdfEntries.length) {
    showMessage("먼저 병합할 ZIP 파일을 올려주세요.", true);
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
      const bytes = await entry.async("uint8array");
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
    const outputName = safeBaseName(dom.outputName.value) || "웅툴_병합";
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
dom.zipInput.addEventListener("change", () => loadZip(dom.zipInput.files[0]));
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
  loadZip(event.dataTransfer.files[0]);
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

  if (name === "picking") updatePickingLock();
  if (name === "sync") updateSyncLock();
  if (name === "admin") updateAdminLock();
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
  upsDom.outputName.value = "";
  upsDom.progressWrap.hidden = true;
  setUpsProgress(0, "라벨을 변환하고 있어요");
  showUpsMessage("");
}

async function inspectUpsPdf(file) {
  showUpsMessage("");

  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    showUpsMessage("PDF 형식의 UPS 라벨 파일을 선택해 주세요.", true);
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
    upsDom.outputName.value = `${safeBaseName(file.name)}_10x15`;
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
    upsDom.selectButton.textContent = "PDF 선택";
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
    const outputName = safeBaseName(upsDom.outputName.value) || "웅툴_UPS_10x15";
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
const GOOGLE_DB_GID = "1060200137";
const PICKING_PASSWORD_HASH = "75992a5ac67ff644d3063976c2effd10bdd93fcc109798e3d5c1acf2e530d01a";

const pickingDom = {
  passwordGate: document.querySelector("#picking-password-gate"),
  content: document.querySelector("#picking-content"),
  passwordForm: document.querySelector("#picking-password-form"),
  password: document.querySelector("#picking-password"),
  passwordError: document.querySelector("#picking-password-error"),
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
  orientationOptions: document.querySelectorAll(".orientation-option"),
  message: document.querySelector("#picking-message"),
};

let locationDb = null;
let pickingWorkbook = null;
let pickingSheet = null;
let pickingRows = [];
let pickingColumns = null;
let pickingFile = null;
let pickingData = null;
let pickingOrientation = "landscape";
let pickingUnlocked = sessionStorage.getItem("woongtoolPickingUnlocked") === "yes";

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function updatePickingLock() {
  pickingDom.passwordGate.hidden = pickingUnlocked;
  pickingDom.content.hidden = !pickingUnlocked;
  if (!pickingUnlocked) {
    requestAnimationFrame(() => pickingDom.password.focus());
  }
}

async function unlockPicking(event) {
  event.preventDefault();
  const enteredHash = await sha256(pickingDom.password.value);
  if (enteredHash !== PICKING_PASSWORD_HASH) {
    pickingDom.passwordError.hidden = false;
    pickingDom.password.select();
    return;
  }

  pickingUnlocked = true;
  sessionStorage.setItem("woongtoolPickingUnlocked", "yes");
  pickingDom.password.value = "";
  pickingDom.passwordError.hidden = true;
  updatePickingLock();
  loadGoogleDb().catch((error) => showPickingMessage(error.message, true));
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

function makeLocationMap(response) {
  if (!response || response.status === "error" || !response.table) {
    throw new Error("Google DB 내용을 읽을 수 없습니다.");
  }

  const table = response.table;
  const map = new Map();
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const cells = table.rows[rowIndex].c || [];
    const sku = normalizeSku(gvizCellValue(cells[0]));
    const location = String(gvizCellValue(cells[3]) ?? "").trim();
    if (sku === "상품코드" || sku === "SKU") continue;
    if (sku) map.set(sku, location);
  }

  if (!map.size) throw new Error("DB 탭 A열 상품코드 데이터를 찾지 못했습니다.");
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
    String(sheetValue(sheet, 10, 25)).trim(),
  ].filter(Boolean);
  const salesPerson = salesPersonParts.join(" ");
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
  pickingDom.outputName.value = "";
  pickingDom.missingList.hidden = true;
  showPickingMessage("");
}

async function inspectPickingFile(file) {
  showPickingMessage("");
  if (!file || !/\.(xls|xlsx)$/i.test(file.name)) {
    showPickingMessage("XLS 또는 XLSX 형식의 파일을 선택해 주세요.", true);
    return;
  }
  if (typeof XLSX === "undefined") {
    showPickingMessage("엑셀 처리 도구를 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.", true);
    return;
  }

  pickingDom.selectButton.disabled = true;
  pickingDom.selectButton.textContent = "분석 중…";

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
    pickingDom.outputName.value = `${safeBaseName(file.name)}_피킹리스트`;
    updatePickingSummary();
    pickingDom.dropZone.hidden = true;
    pickingDom.workspace.hidden = false;
    pickingDom.selectedFile.hidden = false;
  } catch (error) {
    resetPickingTool();
    showPickingMessage(error.message || "엑셀파일을 분석할 수 없습니다.", true);
  } finally {
    pickingDom.selectButton.disabled = false;
    pickingDom.selectButton.textContent = "엑셀파일 선택";
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

  return { ...pickingData, items };
}

function buildPickingWorkbook(data = pickingData) {
  const portrait = pickingOrientation === "portrait";
  const referenceParts = [];
  if (data.salesPerson) referenceParts.push(`영업사원 : ${data.salesPerson}`);
  if (data.shippingCarrier) referenceParts.push(`배송사 : ${data.shippingCarrier}`);
  const referenceLine = referenceParts.join("   |   ");
  const referenceRows = referenceLine
    ? [[referenceLine, "", "", "", "", "", "", ""]]
    : [];
  const shipRow = 3 + referenceRows.length;
  const remarkRow = shipRow + 1;
  const spacerRow = remarkRow + 1;
  const headerRow = spacerRow + 1;
  const firstItemRow = headerRow + 1;
  const rows = [
    ["PICKING LIST", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["INVOICE", data.invoiceNo, "DATE", data.date, "CUSTOMER", data.customer, "TOTAL QTY", data.totalQuantity],
    ...referenceRows,
    ["SHIP TO", data.shipTo, "", "", "", "", "", ""],
    ["특이사항", data.remark, "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
    ["NO", "SKU", "DESCRIPTION", "BRAND", "BARCODE", "QTY", "LOCATION", "PACKING"],
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
    ["", "", "TOTAL", "", "", data.totalQuantity, "", ""],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Picking List");

  sheet["!merges"] = [
    XLSX.utils.decode_range("A1:H2"),
    ...(referenceLine ? [XLSX.utils.decode_range("A4:H4")] : []),
    XLSX.utils.decode_range(`B${shipRow + 1}:H${shipRow + 1}`),
    XLSX.utils.decode_range(`B${remarkRow + 1}:H${remarkRow + 1}`),
  ];
  sheet["!cols"] = [
    { wch: portrait ? 4 : 5 },
    { wch: portrait ? 18 : 23 },
    { wch: portrait ? 40 : 54 },
    { wch: portrait ? 15 : 19 },
    { wch: portrait ? 15 : 19 },
    { wch: portrait ? 7 : 9 },
    { wch: portrait ? 13 : 16 },
    { wch: portrait ? 11 : 15 },
  ];

  const remarkLines = Math.max(
    data.remark.split(/\r?\n/).length,
    Math.ceil(data.remark.length / 105),
  );
  sheet["!rows"] = [
    { hpt: 30 },
    { hpt: 18 },
    { hpt: 27 },
    ...(referenceLine ? [{ hpt: 34 }] : []),
    { hpt: Math.max(34, 16 * data.shipTo.split(/\r?\n/).length + 8) },
    { hpt: Math.max(46, remarkLines * 16 + 12) },
    { hpt: 8 },
    { hpt: 30 },
    ...data.items.map((item) => ({
      hpt: Math.max(34, Math.ceil(item.description.length / (portrait ? 30 : 42)) * 16 + 10),
    })),
    { hpt: 28 },
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
    font: { name: "맑은 고딕", sz: 22, bold: true, color: { rgb: "FFFFFF" } },
    alignment: { horizontal: "left", vertical: "center" },
  };

  for (const address of [
    "A3",
    "C3",
    "E3",
    "G3",
    `A${shipRow + 1}`,
    `A${remarkRow + 1}`,
  ]) {
    sheet[address].s = {
      fill: { fgColor: { rgb: "EEEAE3" } },
      font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "55514B" } },
      alignment: { horizontal: "center", vertical: "center" },
      border: thinBorder,
    };
  }

  for (const address of [
    "B3",
    "D3",
    "F3",
    "H3",
    `B${shipRow + 1}`,
    `B${remarkRow + 1}`,
  ]) {
    sheet[address].s = {
      fill: { fgColor: { rgb: address === `B${remarkRow + 1}` ? "FFF5F0" : "FFFFFF" } },
      font: {
        name: "맑은 고딕",
        sz: address === `B${remarkRow + 1}` ? 10 : 9,
        bold: address === `B${remarkRow + 1}`,
        color: { rgb: address === `B${remarkRow + 1}` ? "9D3B25" : "222222" },
      },
      alignment: { vertical: "center", wrapText: true },
      border: thinBorder,
    };
  }

  if (referenceLine) {
    sheet.A4.s = {
      fill: { fgColor: { rgb: "FFF8F4" } },
      font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: "33312E" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: false },
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
      cell.s = {
        fill: { fgColor: { rgb: index % 2 ? "FAF9F6" : "FFFFFF" } },
        font: {
          name: "맑은 고딕",
          sz: col === 6 ? 11 : 9,
          bold: col === 2 || col === 6,
          color: { rgb: col === 6 ? (item.location ? "D6532F" : "C62828") : "222222" },
        },
        alignment: {
          horizontal: [0, 5, 6, 7].includes(col) ? "center" : "left",
          vertical: "center",
          wrapText: true,
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

  sheet["!autofilter"] = {
    ref: `A${headerRow + 1}:H${headerRow + 1 + data.items.length}`,
  };
  sheet["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 };
  sheet["!pageSetup"] = {
    paperSize: 9,
    orientation: portrait ? "portrait" : "landscape",
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
    ctx.font = "800 34px 'Malgun Gothic', sans-serif";
    ctx.fillText("PICKING LIST", margin, 70);
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
      ["TOTAL", `${data.items.length} SKU / ${data.totalQuantity} EA`],
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

  const columns = portrait
    ? [
        ["NO", 45],
        ["SKU", 160],
        ["DESCRIPTION", 366],
        ["BRAND", 90],
        ["BARCODE", 125],
        ["QTY", 55],
        ["LOCATION", 120],
        ["PACKING", 70],
      ]
    : [
        ["NO", 55],
        ["SKU", 205],
        ["DESCRIPTION", 540],
        ["BRAND", 120],
        ["BARCODE", 150],
        ["QTY", 80],
        ["LOCATION", 150],
        ["PACKING", 150],
      ];

  function drawTableHeader() {
    let x = margin;
    ctx.fillStyle = "#f26b3a";
    ctx.fillRect(margin, y, columns.reduce((sum, col) => sum + col[1], 0), 44);
    ctx.font = "800 14px 'Malgun Gothic', sans-serif";
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
      ctx.font = "600 15px 'Malgun Gothic', sans-serif";
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
        wrapCanvasText(ctx, value, columns[index][1] - 16),
      );
      const rowHeight = Math.max(54, Math.max(...wrapped.map((lines) => lines.length)) * 20 + 18);

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
        ctx.font =
          colIndex === 6
            ? "800 18px 'Malgun Gothic', sans-serif"
            : colIndex === 2
              ? "700 15px 'Malgun Gothic', sans-serif"
              : "500 14px 'Malgun Gothic', sans-serif";
        const centered = [0, 5, 6, 7].includes(colIndex);
        ctx.textAlign = centered ? "center" : "left";
        const lines = wrapCanvasText(ctx, value, colWidth - 16);
        const startY = y + Math.max(20, (rowHeight - lines.length * 20) / 2 + 15);
        lines.forEach((line, lineIndex) => {
          ctx.fillText(
            line,
            centered ? x + colWidth / 2 : x + 8,
            startY + lineIndex * 20,
          );
        });
        x += colWidth;
      });
      ctx.textAlign = "left";
      y += rowHeight;
    });
  }

  newPage();
  drawSummary();
  drawReferencePairs();
  drawRemark();
  drawItems();

  pages.forEach((canvas, index) => {
    const footer = canvas.getContext("2d");
    footer.fillStyle = "#8b8780";
    footer.font = "500 12px 'Malgun Gothic', sans-serif";
    footer.textAlign = "left";
    footer.fillText("웅툴 - 피킹리스트", margin, height - 22);
    footer.textAlign = "right";
    footer.fillText(`${index + 1} / ${pages.length}`, width - margin, height - 22);
  });
  return pages;
}

async function downloadPickingExcel(sortByLocation = false) {
  if (!pickingData) {
    showPickingMessage("먼저 인보이스 엑셀파일을 올려주세요.", true);
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
    const baseName = safeBaseName(pickingDom.outputName.value) || "웅툴_피킹리스트";
    const sortSuffix = sortByLocation ? "_Location순" : "";
    const outputName = `${baseName}${sortSuffix}_${pickingOrientation === "portrait" ? "세로" : "가로"}`;
    downloadFile(
      output,
      `${outputName}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    showPickingMessage(
      sortByLocation
        ? "Location 알파벳순 Excel 피킹리스트를 저장했어요."
        : "작업자용 Excel 피킹리스트를 저장했어요.",
    );
  } catch (error) {
    showPickingMessage(error.message || "Excel 생성 중 문제가 발생했습니다.", true);
  } finally {
    button.disabled = false;
  }
}

async function downloadPickingPdf(sortByLocation = false) {
  if (!pickingData) {
    showPickingMessage("먼저 인보이스 엑셀파일을 올려주세요.", true);
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
    const baseName = safeBaseName(pickingDom.outputName.value) || "웅툴_피킹리스트";
    const sortSuffix = sortByLocation ? "_Location순" : "";
    const outputName = `${baseName}${sortSuffix}_${pickingOrientation === "portrait" ? "세로" : "가로"}`;
    downloadPdf(output, outputName);
    showPickingMessage(
      sortByLocation
        ? `Location 알파벳순 PDF 피킹리스트 ${canvases.length}페이지를 저장했어요.`
        : `작업자용 PDF 피킹리스트 ${canvases.length}페이지를 저장했어요.`,
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
pickingDom.passwordForm.addEventListener("submit", unlockPicking);
pickingDom.password.addEventListener("input", () => {
  pickingDom.passwordError.hidden = true;
});
pickingDom.orientationOptions.forEach((option) => {
  option.addEventListener("click", () => {
    pickingOrientation = option.dataset.orientation;
    pickingDom.orientationOptions.forEach((button) => {
      const active = button === option;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  });
});

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
  passwordGate: document.querySelector("#sync-password-gate"),
  content: document.querySelector("#sync-content"),
  passwordForm: document.querySelector("#sync-password-form"),
  password: document.querySelector("#sync-password"),
  passwordError: document.querySelector("#sync-password-error"),
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

let syncUnlocked = sessionStorage.getItem("woongtoolSyncUnlocked") === "yes";
let syncFile = null;
let syncResults = [];

function showSyncMessage(text, isError = false) {
  syncDom.message.textContent = text;
  syncDom.message.classList.toggle("error", isError);
  syncDom.message.hidden = !text;
}

function updateSyncLock() {
  syncDom.passwordGate.hidden = syncUnlocked;
  syncDom.content.hidden = !syncUnlocked;
  if (!syncUnlocked) requestAnimationFrame(() => syncDom.password.focus());
}

async function unlockSync(event) {
  event.preventDefault();
  const enteredHash = await sha256(syncDom.password.value);
  if (enteredHash !== PICKING_PASSWORD_HASH) {
    syncDom.passwordError.hidden = false;
    syncDom.password.select();
    return;
  }
  syncUnlocked = true;
  sessionStorage.setItem("woongtoolSyncUnlocked", "yes");
  syncDom.password.value = "";
  syncDom.passwordError.hidden = true;
  updateSyncLock();
  loadGoogleDb().catch((error) => showSyncMessage(error.message, true));
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
  syncDom.outputName.value = "";
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
    showSyncMessage("XLS 또는 XLSX 형식의 재고파일을 선택해 주세요.", true);
    return;
  }
  syncDom.selectButton.disabled = true;
  syncDom.selectButton.textContent = "비교 중…";
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
    syncDom.outputName.value = `${safeBaseName(file.name)}_로케이션동기화`;
    syncDom.dropZone.hidden = true;
    syncDom.workspace.hidden = false;
    syncDom.selectedFile.hidden = false;
    showSyncMessage(
      `로케이션 확인 필요 ${noLocation}개 · DB 미등록 ${notRegistered}개 · 재고 없음 ${noStock}개`,
      noLocation + notRegistered > 0,
    );
  } catch (error) {
    resetSyncTool();
    showSyncMessage(error.message || "재고파일 비교 중 문제가 발생했습니다.", true);
  } finally {
    syncDom.selectButton.disabled = false;
    syncDom.selectButton.textContent = "재고파일 선택";
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
    showSyncMessage("먼저 재고 엑셀파일을 올려주세요.", true);
    return;
  }
  syncDom.downloadButton.disabled = true;
  try {
    const workbook = buildSyncWorkbook();
    const output = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true, compression: true });
    const outputName = safeBaseName(syncDom.outputName.value) || "웅툴_로케이션동기화";
    downloadFile(output, `${outputName}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    showSyncMessage("로케이션 동기화 결과 Excel을 저장했어요.");
  } catch (error) {
    showSyncMessage(error.message || "결과 파일 생성 중 문제가 발생했습니다.", true);
  } finally {
    syncDom.downloadButton.disabled = false;
  }
}

syncDom.passwordForm.addEventListener("submit", unlockSync);
syncDom.password.addEventListener("input", () => { syncDom.passwordError.hidden = true; });
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
brandHome.addEventListener("click", (event) => {
  event.preventDefault();
  showHome();
});
