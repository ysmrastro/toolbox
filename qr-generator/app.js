// DOM要素
const $ = (id) => document.getElementById(id);
const dataInput = $("data");
const preview = $("preview");
const downloadPng = $("downloadPng");
const downloadSvg = $("downloadSvg");
const downloadJpeg = $("downloadJpeg");
const imageInput = $("imageInput");
const dropArea = $("dropArea");
const imagePreview = $("imagePreview");
const uploadText = $("uploadText");
const clearImageBtn = $("clearImage");

// 状態
let uploadedImage = null;
let selectedLogo = null;
let qrCode = null;
let debounceTimer = null;
let presetQRCodes = [];

// ========== プリセットテーマ ==========

function initPresets() {
  const grid = $("presetGrid");
  PRESETS.forEach((preset, i) => {
    const card = document.createElement("button");
    card.className = "preset-card";
    card.innerHTML = `<div class="preset-card__preview" id="presetPreview${i}"></div><span class="preset-card__name">${preset.name}</span>`;
    card.addEventListener("click", () => applyPreset(i));
    grid.appendChild(card);

    // ミニプレビュー生成
    const miniOptions = buildQROptions(preset, 60);
    const miniQR = new QRCodeStyling(miniOptions);
    presetQRCodes.push(miniQR);
    miniQR.append(document.getElementById(`presetPreview${i}`));
  });
}

function applyPreset(index) {
  const preset = PRESETS[index];

  $("dotColor").value = preset.dotColor;
  $("dotColorHex").textContent = preset.dotColor;
  $("bgColor").value = preset.bgColor;
  $("bgColorHex").textContent = preset.bgColor;
  $("dotStyle").value = preset.dotStyle;
  $("cornerSquareStyle").value = preset.cornerSquareStyle;
  $("cornerDotStyle").value = preset.cornerDotStyle;

  if (preset.gradient) {
    activateTab("gradient");
    $("gradColor1").value = preset.gradientColor1;
    $("gradColor1Hex").textContent = preset.gradientColor1;
    $("gradColor2").value = preset.gradientColor2;
    $("gradColor2Hex").textContent = preset.gradientColor2;
    $("gradientType").value = preset.gradientType;
    $("gradientAngle").value = preset.gradientAngle;
    $("gradientAngleValue").textContent = preset.gradientAngle + "°";
    $("gradBgColor").value = preset.bgColor;
    $("gradBgColorHex").textContent = preset.bgColor;
  } else {
    activateTab("solid");
  }

  // アクティブ状態の更新
  document.querySelectorAll(".preset-card").forEach((card, i) => {
    card.classList.toggle("active", i === index);
  });

  scheduleUpdate();
}

function buildQROptions(preset, size) {
  const options = {
    width: size,
    height: size,
    margin: 2,
    data: "https://example.com",
    dotsOptions: {
      type: preset.dotStyle,
    },
    backgroundOptions: {
      color: preset.bgColor,
    },
    cornersSquareOptions: {
      type: preset.cornerSquareStyle,
    },
    cornersDotOptions: {
      type: preset.cornerDotStyle,
    },
    qrOptions: {
      errorCorrectionLevel: "L",
    },
  };

  if (preset.gradient) {
    options.dotsOptions.gradient = {
      type: preset.gradientType,
      rotation: (preset.gradientAngle * Math.PI) / 180,
      colorStops: [
        { offset: 0, color: preset.gradientColor1 },
        { offset: 1, color: preset.gradientColor2 },
      ],
    };
  } else {
    options.dotsOptions.color = preset.dotColor;
  }

  return options;
}

// ========== プリセットロゴ ==========

const LOGOS = [
  { name: "X", file: "x.svg" },
  { name: "Instagram", file: "instagram.svg" },
  { name: "LINE", file: "line.svg" },
  { name: "YouTube", file: "youtube.svg" },
  { name: "Facebook", file: "facebook.svg" },
  { name: "GitHub", file: "github.svg" },
  { name: "TikTok", file: "tiktok.svg" },
  { name: "Discord", file: "discord.svg" },
  { name: "Threads", file: "threads.svg" },
];

function initLogos() {
  const grid = $("logoGrid");

  // 「なし」ボタン
  const noneBtn = document.createElement("button");
  noneBtn.className = "logo-btn active";
  noneBtn.id = "logoNone";
  noneBtn.title = "なし";
  noneBtn.innerHTML =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2" fill="none"/><line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  noneBtn.addEventListener("click", () => {
    selectedLogo = null;
    updateLogoActive(null);
    scheduleUpdate();
  });
  grid.appendChild(noneBtn);

  LOGOS.forEach((logo) => {
    const btn = document.createElement("button");
    btn.className = "logo-btn";
    btn.title = logo.name;
    btn.dataset.logo = logo.file;

    // SVGを読み込んでインライン表示
    fetch(`logos/${logo.file}`)
      .then((r) => r.text())
      .then((svg) => {
        btn.innerHTML = svg;
      });

    btn.addEventListener("click", () => {
      // SVGをBlobURLに変換してqr-code-stylingに渡す
      fetch(`logos/${logo.file}`)
        .then((r) => r.blob())
        .then((blob) => {
          selectedLogo = URL.createObjectURL(blob);
          uploadedImage = null;
          clearUploadUI();
          updateLogoActive(logo.file);
          scheduleUpdate();
        });
    });

    grid.appendChild(btn);
  });
}

function updateLogoActive(activeFile) {
  document.querySelectorAll(".logo-btn").forEach((btn) => {
    if (activeFile === null) {
      btn.classList.toggle("active", btn.id === "logoNone");
    } else {
      btn.classList.toggle("active", btn.dataset.logo === activeFile);
    }
  });
}

// ========== 画像アップロード ==========

dropArea.addEventListener("click", () => imageInput.click());
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.style.borderColor = "var(--tb-accent)";
});
dropArea.addEventListener("dragleave", () => {
  dropArea.style.borderColor = "";
});
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.style.borderColor = "";
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
imageInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImage = e.target.result;
    selectedLogo = null;
    updateLogoActive(null);
    $("logoNone").classList.remove("active");

    imagePreview.src = uploadedImage;
    imagePreview.style.display = "block";
    uploadText.textContent = file.name;
    dropArea.classList.add("has-file");
    clearImageBtn.style.display = "inline";
    scheduleUpdate();
  };
  reader.readAsDataURL(file);
}

clearImageBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  uploadedImage = null;
  clearUploadUI();
  updateLogoActive(null);
  scheduleUpdate();
});

function clearUploadUI() {
  imageInput.value = "";
  imagePreview.style.display = "none";
  uploadText.textContent = "クリックまたはドラッグ&ドロップで画像を選択";
  dropArea.classList.remove("has-file");
  clearImageBtn.style.display = "none";
}

// ========== カラータブ ==========

let colorMode = "solid";

function initColorTabs() {
  document.querySelectorAll("#colorTabs .tb-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
      scheduleUpdate();
    });
  });
}

function activateTab(mode) {
  colorMode = mode;
  document.querySelectorAll("#colorTabs .tb-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === mode);
  });
  $("solidSettings").style.display = mode === "solid" ? "block" : "none";
  $("gradientSettings").classList.toggle("visible", mode === "gradient");
}

// ========== カラーピッカー同期 ==========

function syncColorHex(colorId, hexId) {
  const el = $(colorId);
  const hex = $(hexId);
  el.addEventListener("input", () => {
    hex.textContent = el.value;
    scheduleUpdate();
  });
}

// ========== スライダー同期 ==========

function syncRange(rangeId, valueId, suffix) {
  const range = $(rangeId);
  const value = $(valueId);
  range.addEventListener("input", () => {
    value.textContent = range.value + (suffix || "");
    scheduleUpdate();
  });
}

// ========== QRコード生成 ==========

function scheduleUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(updatePreview, 300);
}

function updatePreview() {
  const data = dataInput.value.trim();
  if (!data) {
    preview.innerHTML =
      '<span class="preview-placeholder">URLを入力してください</span>';
    return;
  }

  const options = getCurrentOptions(300);
  preview.innerHTML = "";
  qrCode = new QRCodeStyling(options);
  qrCode.append(preview);
}

function getCurrentOptions(size) {
  const data = dataInput.value.trim();
  const margin = parseInt($("margin").value);

  const options = {
    width: size,
    height: size,
    margin: Math.round((margin / 1000) * size),
    data: data,
    dotsOptions: {
      type: $("dotStyle").value,
    },
    backgroundOptions: {},
    cornersSquareOptions: {
      type: $("cornerSquareStyle").value,
    },
    cornersDotOptions: {
      type: $("cornerDotStyle").value,
    },
    qrOptions: {
      errorCorrectionLevel: $("errorCorrection").value,
    },
  };

  // カラー設定
  if (colorMode === "gradient") {
    const angle = parseInt($("gradientAngle").value);
    options.dotsOptions.gradient = {
      type: $("gradientType").value,
      rotation: (angle * Math.PI) / 180,
      colorStops: [
        { offset: 0, color: $("gradColor1").value },
        { offset: 1, color: $("gradColor2").value },
      ],
    };
    options.backgroundOptions.color = $("gradBgColor").value;
  } else {
    options.dotsOptions.color = $("dotColor").value;
    options.backgroundOptions.color = $("bgColor").value;
  }

  // 画像設定
  const imageUrl = uploadedImage || selectedLogo;
  if (imageUrl) {
    options.image = imageUrl;
    options.imageOptions = {
      crossOrigin: "anonymous",
      margin: parseInt($("imageMargin").value),
      imageSize: parseFloat($("imageSize").value),
      hideBackgroundDots: true,
    };
  }

  return options;
}

// ========== ダウンロード ==========

function downloadAs(extension) {
  const data = dataInput.value.trim();
  if (!data) return;

  const size = parseInt($("size").value);
  const options = getCurrentOptions(size);
  const dlQR = new QRCodeStyling(options);

  if (extension === "jpeg") {
    // JPEGはcanvasから変換
    const tempDiv = document.createElement("div");
    dlQR.append(tempDiv);
    setTimeout(() => {
      const canvas = tempDiv.querySelector("canvas");
      if (canvas) {
        const link = document.createElement("a");
        link.download = "qrcode.jpeg";
        link.href = canvas.toDataURL("image/jpeg", 0.95);
        link.click();
      }
    }, 500);
  } else {
    dlQR.download({ name: "qrcode", extension: extension });
  }
}

downloadPng.addEventListener("click", () => downloadAs("png"));
downloadSvg.addEventListener("click", () => downloadAs("svg"));
downloadJpeg.addEventListener("click", () => downloadAs("jpeg"));

// ========== イベントリスナー ==========

function initEvents() {
  // URL入力
  dataInput.addEventListener("input", scheduleUpdate);

  // セレクトボックス
  ["dotStyle", "errorCorrection", "cornerSquareStyle", "cornerDotStyle", "gradientType"].forEach((id) => {
    $(id).addEventListener("change", scheduleUpdate);
  });

  // 数値入力
  ["size", "margin"].forEach((id) => {
    $(id).addEventListener("input", scheduleUpdate);
  });

  // カラーピッカー
  syncColorHex("dotColor", "dotColorHex");
  syncColorHex("bgColor", "bgColorHex");
  syncColorHex("gradColor1", "gradColor1Hex");
  syncColorHex("gradColor2", "gradColor2Hex");
  syncColorHex("gradBgColor", "gradBgColorHex");

  // スライダー
  syncRange("gradientAngle", "gradientAngleValue", "°");
  syncRange("imageSize", "imageSizeValue", "");
  syncRange("imageMargin", "imageMarginValue", "px");
}

// ========== 初期化 ==========

function init() {
  initColorTabs();
  initPresets();
  initLogos();
  initEvents();
  updatePreview();
}

init();
