// ui.js – stable working version (tabs + preview + bold)

import { printText, printBarcode, printQR, printImage, updatePreview } from "./printer.js";

// ---------------------- State ----------------------
let activeTab = "text";
let boldEnabled = JSON.parse(localStorage.getItem("boldEnabled") || "false");

// ---------------------- Helpers ----------------------
function saveState() {
    localStorage.setItem("boldEnabled", JSON.stringify(boldEnabled));
}

function updateBoldUI() {
    document.getElementById("boldToggle").checked = boldEnabled;
}

// ---------------------- Tab Switching ----------------------
export function setActiveTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-page").forEach(p => p.classList.add("hidden"));
    document.getElementById(`tab-${tab}`).classList.remove("hidden");
    updatePreview();
}

document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.onclick = () => setActiveTab(btn.dataset.tab);
});

// ---------------------- Bold Toggle ----------------------
const boldUI = document.getElementById("boldToggle");
if (boldUI) {
    boldUI.addEventListener("change", e => {
        boldEnabled = e.target.checked;
        saveState();
        updatePreview();
    });
    updateBoldUI();
}

// ---------------------- Print Buttons ----------------------
document.getElementById("printTextBtn")?.addEventListener("click", () => {
    const text = document.getElementById("textInput").value;
    const copies = parseInt(document.getElementById("copiesInput").value) || 1;
    printText(text, copies, { bold: boldEnabled });
});

document.getElementById("printBarcodeBtn")?.addEventListener("click", () => {
    const text = document.getElementById("barcodeInput").value;
    const copies = parseInt(document.getElementById("barcodeCopies").value) || 1;
    printBarcode(text, copies);
});

document.getElementById("printQrBtn")?.addEventListener("click", () => {
    const text = document.getElementById("qrInput").value;
    const copies = parseInt(document.getElementById("qrCopies").value) || 1;
    printQR(text, copies);
});

document.getElementById("printImageBtn")?.addEventListener("click", () => {
    printImage();
});

// ---------------------- Preview ----------------------
window.addEventListener("load", () => {
    setActiveTab("text");
    updatePreview();
});
