const captureButton = document.querySelector("#capture");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const statusEl = document.querySelector("#status");
const outputEl = document.querySelector("#output");

let lastResult = null;

function setStatus(text, kind = "info") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function slugify(value) {
  return String(value || "page")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "page";
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function updateActionButtons() {
  const hasOutput = Boolean(lastResult?.dsl);
  copyButton.disabled = !hasOutput;
  downloadButton.disabled = !hasOutput;
}

async function captureDomToUi() {
  setStatus("Capturing page...", "info");
  captureButton.disabled = true;

  try {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== "number") {
      throw new Error("Could not find an active tab.");
    }

    const response = await browser.tabs.sendMessage(tab.id, {
      type: "UNITS_CAPTURE_DOM",
    });

    if (!response || response.ok !== true) {
      const message = response?.error || "Capture failed.";
      throw new Error(message);
    }

    lastResult = response;
    outputEl.value = response.dsl;
    updateActionButtons();

    setStatus(
      `Captured ${response.stats.nodeCount} nodes · ${response.stats.dslChars} chars`,
      "success",
    );
  } catch (error) {
    lastResult = null;
    outputEl.value = "";
    updateActionButtons();
    const message = error?.message || String(error);
    const isMissingReceiver = /Could not establish connection|Receiving end does not exist/i.test(message);
    const hint = isMissingReceiver
      ? "Refresh the tab once after installing/reloading the extension."
      : "Restricted pages (chrome://, extensions, stores) are not capturable.";
    setStatus(
      `${message}. ${hint}`,
      "error",
    );
  } finally {
    captureButton.disabled = false;
  }
}

async function copyOutput() {
  if (!lastResult?.dsl) return;
  await navigator.clipboard.writeText(lastResult.dsl);
  setStatus("Copied .ui to clipboard", "success");
}

function downloadOutput() {
  if (!lastResult?.dsl) return;

  const title = slugify(lastResult.title || "page");
  const hostname = (() => {
    try {
      return slugify(new URL(lastResult.url).hostname);
    } catch {
      return "site";
    }
  })();

  const fileName = `${hostname}-${title}.ui`;
  const blob = new Blob([lastResult.dsl], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);

  setStatus(`Downloaded ${fileName}`, "success");
}

captureButton.addEventListener("click", captureDomToUi);
copyButton.addEventListener("click", () => {
  copyOutput().catch((error) => {
    setStatus(`Copy failed: ${error.message || error}`, "error");
  });
});
downloadButton.addEventListener("click", downloadOutput);

updateActionButtons();
