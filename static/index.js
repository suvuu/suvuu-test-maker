const dom = {};
let cachedTests = [];
let aiDraft = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  attachImportHandlers();
  attachAiConfigHandlers();
  attachAiImageImportHandlers();
  initDeleteModal();
  loadTests();
  loadAiConfig();
});

function cacheDom() {
  dom.testsList = document.getElementById("tests-list");
  dom.testsEmpty = document.getElementById("tests-empty");
  dom.testsSkeleton = document.getElementById("tests-skeleton");
  dom.importBtn = document.getElementById("import-btn");
  dom.importFileInput = document.getElementById("import-file-input");
  dom.importStatus = document.getElementById("import-status");
  dom.importStatusBase = dom.importStatus ? dom.importStatus.className : "";
  dom.ollamaUrl = document.getElementById("ollama-url");
  dom.ollamaModel = document.getElementById("ollama-model");
  dom.saveAiConfig = document.getElementById("save-ai-config");
  dom.aiConfigStatus = document.getElementById("ai-config-status");
  dom.deleteModal = document.getElementById("deleteModal");
  dom.deleteTitle = document.getElementById("testTitlePreview");
  dom.deleteConfirm = document.getElementById("confirmDeleteBtn");
  dom.aiImportTest = document.getElementById("ai-import-test");
  dom.aiImportImage = document.getElementById("ai-import-image");
  dom.aiImportBtn = document.getElementById("ai-import-btn");
  dom.aiImportBatchBtn = document.getElementById("ai-import-batch-btn");
  dom.aiImportAttachImage = document.getElementById("ai-import-attach-image");
  dom.aiImportStatus = document.getElementById("ai-import-status");
  dom.aiPreviewBox = document.getElementById("ai-import-preview");
  dom.aiPreviewQuestion = document.getElementById("ai-preview-question");
  dom.aiPreviewOptions = document.getElementById("ai-preview-options");
  dom.aiPreviewExplanation = document.getElementById("ai-preview-explanation");
  dom.aiPreviewAddOption = document.getElementById("ai-preview-add-option");
  dom.aiPreviewSave = document.getElementById("ai-preview-save");
  dom.aiPreviewCancel = document.getElementById("ai-preview-cancel");
}

function attachImportHandlers() {
  if (!dom.importBtn || !dom.importFileInput) return;

  dom.importBtn.addEventListener("click", () => dom.importFileInput.click());

  dom.importFileInput.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!(lower.endsWith(".json") || lower.endsWith(".zip"))) {
      alert("Please select a .json or .zip backup file");
      event.target.value = "";
      return;
    }
    uploadImportFile(file);
    event.target.value = "";
  });
}

function attachAiConfigHandlers() {
  if (!dom.saveAiConfig) return;
  dom.saveAiConfig.addEventListener("click", saveAiConfig);
}

function attachAiImageImportHandlers() {
  if (!dom.aiImportBtn) return;
  dom.aiImportBtn.addEventListener("click", runAiImageImport);
  if (dom.aiImportBatchBtn) {
    dom.aiImportBatchBtn.addEventListener("click", runAiImageBatchImport);
  }
  if (dom.aiPreviewAddOption) {
    dom.aiPreviewAddOption.addEventListener("click", () => addAiPreviewOption(""));
  }
  if (dom.aiPreviewSave) {
    dom.aiPreviewSave.addEventListener("click", commitAiDraft);
  }
  if (dom.aiPreviewCancel) {
    dom.aiPreviewCancel.addEventListener("click", clearAiDraft);
  }
}

function initDeleteModal() {
  if (!dom.deleteModal) return;
  dom.deleteModalInstance = new bootstrap.Modal(dom.deleteModal);
}

async function loadTests() {
  setSkeletonVisible(true);
  try {
    const response = await fetch("/api/tests");
    if (!response.ok) {
      throw new Error("Failed to load tests");
    }
    const data = await response.json();
    renderTests(Array.isArray(data.tests) ? data.tests : []);
  } catch (err) {
    console.error("Failed to load tests:", err);
    setSkeletonVisible(false);
    showTestsMessage("Unable to load tests. Please refresh.", true);
  }
}

async function loadAiConfig() {
  if (!dom.ollamaUrl || !dom.ollamaModel) return;
  try {
    const response = await fetch("/api/ai-config");
    if (!response.ok) {
      throw new Error("Failed to load AI config");
    }
    const data = await response.json();
    dom.ollamaUrl.value = data.ollama_url || "";
    dom.ollamaModel.value = data.ollama_model || "";
  } catch (err) {
    if (dom.aiConfigStatus) {
      dom.aiConfigStatus.textContent = "Unable to load AI settings.";
      dom.aiConfigStatus.className = "text-warning small";
    }
  }
}

async function saveAiConfig() {
  if (!dom.ollamaUrl || !dom.ollamaModel || !dom.aiConfigStatus) return;
  const ollamaUrl = dom.ollamaUrl.value.trim();
  const ollamaModel = dom.ollamaModel.value.trim();
  if (!ollamaUrl || !ollamaModel) {
    dom.aiConfigStatus.textContent = "Both URL and model are required.";
    dom.aiConfigStatus.className = "text-warning small";
    return;
  }

  dom.aiConfigStatus.textContent = "Saving...";
  dom.aiConfigStatus.className = "text-info small";

  try {
    const response = await fetch("/api/ai-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ollama_url: ollamaUrl, ollama_model: ollamaModel })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to save AI settings.");
    }
    dom.ollamaUrl.value = data.ollama_url || ollamaUrl;
    dom.ollamaModel.value = data.ollama_model || ollamaModel;
    dom.aiConfigStatus.textContent = "AI settings saved.";
    dom.aiConfigStatus.className = "text-success small";
  } catch (err) {
    dom.aiConfigStatus.textContent = err.message || "Failed to save AI settings.";
    dom.aiConfigStatus.className = "text-danger small";
  }
}

function renderTests(tests) {
  cachedTests = tests;
  renderAiImportTargets(tests);
  setSkeletonVisible(false);
  if (!tests.length) {
    dom.testsList.classList.add("d-none");
    showTestsMessage("No tests available. Create one or import a backup!");
    return;
  }

  dom.testsEmpty.classList.add("d-none");
  dom.testsList.classList.remove("d-none");
  const existing = new Map();
  dom.testsList.querySelectorAll("li[data-test-id]").forEach(li => {
    existing.set(li.dataset.testId, li);
  });

  const nextIds = new Set();
  const fragment = document.createDocumentFragment();

  tests.forEach(test => {
    const id = String(test.id);
    nextIds.add(id);
    const current = existing.get(id);
    if (current) {
      updateTestListItem(current, test);
      fragment.appendChild(current);
    } else {
      fragment.appendChild(createTestListItem(test));
    }
  });

  existing.forEach((li, id) => {
    if (!nextIds.has(id)) {
      li.remove();
    }
  });

  dom.testsList.innerHTML = "";
  dom.testsList.appendChild(fragment);
}

function renderAiImportTargets(tests) {
  if (!dom.aiImportTest) return;
  dom.aiImportTest.innerHTML = "";
  if (!tests.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No tests available";
    dom.aiImportTest.appendChild(option);
    dom.aiImportTest.disabled = true;
    return;
  }
  dom.aiImportTest.disabled = false;
  tests.forEach((test) => {
    const option = document.createElement("option");
    option.value = String(test.id);
    option.textContent = `${test.title || "Untitled Test"} (${test.question_count || 0} q)`;
    dom.aiImportTest.appendChild(option);
  });
}

function showTestsMessage(message, isError = false) {
  if (!dom.testsEmpty) return;
  dom.testsEmpty.textContent = message;
  dom.testsEmpty.classList.remove("d-none", "text-danger");
  dom.testsEmpty.classList.add(isError ? "text-danger" : "text-muted");
}

function setImportStatus(message, extraClass) {
  if (!dom.importStatus) return;
  dom.importStatus.textContent = message;
  dom.importStatus.className = dom.importStatusBase;
  if (extraClass) {
    dom.importStatus.classList.add(extraClass);
  }
}

function createTestListItem(test) {
  const li = document.createElement("li");
  li.className = "list-group-item bg-secondary text-light d-flex justify-content-between align-items-center mb-2";
  li.dataset.testId = test.id;

  const info = document.createElement("div");
  const title = document.createElement("strong");
  title.className = "test-title";
  title.textContent = test.title || "Untitled Test";
  const questionCount = document.createElement("span");
  questionCount.className = "ms-2 test-count";
  questionCount.textContent = `(${test.question_count || 0} questions)`;
  info.appendChild(title);
  info.appendChild(questionCount);

  const actions = document.createElement("div");
  actions.className = "action-buttons d-flex flex-wrap gap-2 justify-content-end justify-content-md-start w-100 w-md-auto";

  const takeLink = document.createElement("a");
  takeLink.href = `/take/${test.id}`;
  takeLink.className = "btn btn-sm btn-primary flex-grow-1 flex-md-grow-0 test-take";
  takeLink.textContent = "Take";

  const flashcardsLink = document.createElement("a");
  flashcardsLink.href = `/flashcards/${test.id}`;
  flashcardsLink.className = "btn btn-sm btn-info flex-grow-1 flex-md-grow-0 test-flashcards";
  flashcardsLink.textContent = "Flashcards";

  const editLink = document.createElement("a");
  editLink.href = `/edit/${test.id}`;
  editLink.className = "btn btn-sm btn-warning flex-grow-1 flex-md-grow-0 test-edit";
  editLink.textContent = "Edit";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-sm btn-danger flex-grow-1 flex-md-grow-0 test-delete";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => showDeleteModal(test));

  actions.appendChild(takeLink);
  actions.appendChild(flashcardsLink);
  actions.appendChild(editLink);
  actions.appendChild(deleteBtn);

  li.appendChild(info);
  li.appendChild(actions);

  return li;
}

function updateTestListItem(li, test) {
  const title = li.querySelector(".test-title");
  if (title) {
    title.textContent = test.title || "Untitled Test";
  }
  const count = li.querySelector(".test-count");
  if (count) {
    count.textContent = `(${test.question_count || 0} questions)`;
  }
  const takeLink = li.querySelector(".test-take");
  if (takeLink) {
    takeLink.href = `/take/${test.id}`;
  }
  const editLink = li.querySelector(".test-edit");
  if (editLink) {
    editLink.href = `/edit/${test.id}`;
  }
  const flashcardsLink = li.querySelector(".test-flashcards");
  if (flashcardsLink) {
    flashcardsLink.href = `/flashcards/${test.id}`;
  }
  const deleteBtn = li.querySelector(".test-delete");
  if (deleteBtn) {
    deleteBtn.onclick = () => showDeleteModal(test);
  }
  li.dataset.testId = test.id;
}

function setSkeletonVisible(visible) {
  if (dom.testsSkeleton) {
    dom.testsSkeleton.classList.toggle("d-none", !visible);
  }
  if (visible) {
    if (dom.testsList) dom.testsList.classList.add("d-none");
    if (dom.testsEmpty) dom.testsEmpty.classList.add("d-none");
  }
}

function showDeleteModal(test) {
  if (!dom.deleteModalInstance || !dom.deleteTitle || !dom.deleteConfirm) return;
  dom.deleteTitle.textContent = test.title || "Untitled Test";
  dom.deleteConfirm.href = `/delete/${test.id}`;
  dom.deleteModalInstance.show();
}

async function uploadImportFile(file) {
  if (!dom.importStatus) return;
  setImportStatus("Uploading...", "text-info");

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/import", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (data.success) {
      setImportStatus(`Success: ${data.message}`, "text-success");
      loadTests();
    } else {
      setImportStatus(`Failed: ${data.error || "Upload failed"}`, "text-danger");
    }
  } catch (err) {
    console.error("Import failed:", err);
    setImportStatus("Failed: Upload failed", "text-danger");
  }
}

async function runAiImageImport() {
  if (!dom.aiImportBtn || !dom.aiImportTest || !dom.aiImportImage || !dom.aiImportStatus) return;
  const selectedTest = dom.aiImportTest.value;
  const imageFile = dom.aiImportImage.files && dom.aiImportImage.files[0];

  if (!selectedTest) {
    dom.aiImportStatus.className = "text-warning small mt-2";
    dom.aiImportStatus.textContent = "Select a test first.";
    return;
  }
  if (!imageFile) {
    dom.aiImportStatus.className = "text-warning small mt-2";
    dom.aiImportStatus.textContent = "Select an image first.";
    return;
  }

  dom.aiImportBtn.disabled = true;
  dom.aiImportStatus.className = "text-info small mt-2";
  dom.aiImportStatus.textContent = "Running AI pass 1 + pass 2, then preparing review draft...";

  const formData = new FormData();
  formData.append("image", imageFile);
  formData.append("attach_source_image", dom.aiImportAttachImage && dom.aiImportAttachImage.checked ? "on" : "off");

  try {
    const response = await fetch(`/api/tests/${encodeURIComponent(selectedTest)}/ai-import-question`, {
      method: "POST",
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to import question from image.");
    }

    aiDraft = {
      testId: Number(selectedTest),
      question: data.question?.question || "",
      options: Array.isArray(data.question?.options) ? data.question.options : [],
      correct_index: Number(data.question?.correct_index ?? 0),
      explanation: data.question?.explanation || "",
      image: data.question?.image || ""
    };
    populateAiDraftEditor();
    dom.aiImportStatus.className = "text-success small mt-2";
    dom.aiImportStatus.textContent = data.message || "Draft ready. Review and save.";
    dom.aiImportImage.value = "";
  } catch (err) {
    dom.aiImportStatus.className = "text-danger small mt-2";
    dom.aiImportStatus.textContent = err.message || "Failed to import question from image.";
  } finally {
    dom.aiImportBtn.disabled = false;
  }
}

async function runAiImageBatchImport() {
  if (!dom.aiImportBatchBtn || !dom.aiImportBtn || !dom.aiImportTest || !dom.aiImportImage || !dom.aiImportStatus) return;
  const selectedTest = dom.aiImportTest.value;
  const files = dom.aiImportImage.files ? Array.from(dom.aiImportImage.files) : [];

  if (!selectedTest) {
    dom.aiImportStatus.className = "text-warning small mt-2";
    dom.aiImportStatus.textContent = "Select a test first.";
    return;
  }
  if (!files.length) {
    dom.aiImportStatus.className = "text-warning small mt-2";
    dom.aiImportStatus.textContent = "Select one or more images first.";
    return;
  }

  dom.aiImportBatchBtn.disabled = true;
  dom.aiImportBtn.disabled = true;
  if (dom.aiPreviewSave) dom.aiPreviewSave.disabled = true;

  let added = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    dom.aiImportStatus.className = "text-info small mt-2";
    dom.aiImportStatus.textContent = `Batch ${i + 1}/${files.length}: processing ${file.name}...`;

    const formData = new FormData();
    formData.append("image", file);
    formData.append("attach_source_image", dom.aiImportAttachImage && dom.aiImportAttachImage.checked ? "on" : "off");

    try {
      const draftRes = await fetch(`/api/tests/${encodeURIComponent(selectedTest)}/ai-import-question`, {
        method: "POST",
        body: formData
      });
      const draftData = await draftRes.json().catch(() => ({}));
      if (!draftRes.ok || !draftData.question) {
        throw new Error(draftData.error || "AI draft failed");
      }

      const commitRes = await fetch(`/api/tests/${encodeURIComponent(selectedTest)}/ai-import-question/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: draftData.question.question || "",
          options: Array.isArray(draftData.question.options) ? draftData.question.options : [],
          correct_index: Number(draftData.question.correct_index ?? 0),
          explanation: draftData.question.explanation || "",
          image: draftData.question.image || ""
        })
      });
      const commitData = await commitRes.json().catch(() => ({}));
      if (!commitRes.ok) {
        throw new Error(commitData.error || "Save failed");
      }

      added += 1;
    } catch (err) {
      failed += 1;
      failures.push(`${file.name}: ${err.message || "Unknown error"}`);
    }
  }

  dom.aiImportImage.value = "";
  clearAiDraft();
  await loadTests();

  if (failed === 0) {
    dom.aiImportStatus.className = "text-success small mt-2";
    dom.aiImportStatus.textContent = `Batch complete: added ${added}/${files.length} questions.`;
  } else {
    const preview = failures.slice(0, 3).join(" | ");
    const more = failures.length > 3 ? ` (+${failures.length - 3} more)` : "";
    dom.aiImportStatus.className = "text-warning small mt-2";
    dom.aiImportStatus.textContent = `Batch complete: added ${added}, failed ${failed}. ${preview}${more}`;
  }

  dom.aiImportBatchBtn.disabled = false;
  dom.aiImportBtn.disabled = false;
  if (dom.aiPreviewSave) dom.aiPreviewSave.disabled = false;
}

function clearAiDraft() {
  aiDraft = null;
  if (dom.aiPreviewBox) dom.aiPreviewBox.classList.add("d-none");
  if (dom.aiPreviewQuestion) dom.aiPreviewQuestion.value = "";
  if (dom.aiPreviewExplanation) dom.aiPreviewExplanation.value = "";
  if (dom.aiPreviewOptions) dom.aiPreviewOptions.innerHTML = "";
}

function addAiPreviewOption(text = "") {
  if (!dom.aiPreviewOptions) return;
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2 mb-2";
  row.innerHTML = `
    <input type="radio" name="ai-preview-correct" class="form-check-input mt-0">
    <input type="text" class="form-control ai-preview-option" value="">
    <button type="button" class="btn btn-sm btn-outline-danger">×</button>
  `;
  const textInput = row.querySelector(".ai-preview-option");
  if (textInput) textInput.value = text;
  const removeBtn = row.querySelector("button");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      row.remove();
      ensureAiPreviewHasCheckedOption();
    });
  }
  dom.aiPreviewOptions.appendChild(row);
  ensureAiPreviewHasCheckedOption();
}

function ensureAiPreviewHasCheckedOption() {
  if (!dom.aiPreviewOptions) return;
  const radios = dom.aiPreviewOptions.querySelectorAll('input[type="radio"]');
  if (!radios.length) return;
  const hasChecked = Array.from(radios).some(r => r.checked);
  if (!hasChecked) {
    radios[0].checked = true;
  }
}

function populateAiDraftEditor() {
  if (!aiDraft || !dom.aiPreviewBox || !dom.aiPreviewQuestion || !dom.aiPreviewOptions || !dom.aiPreviewExplanation) return;

  dom.aiPreviewQuestion.value = aiDraft.question || "";
  dom.aiPreviewExplanation.value = aiDraft.explanation || "";
  dom.aiPreviewOptions.innerHTML = "";
  const options = Array.isArray(aiDraft.options) ? aiDraft.options : [];
  options.forEach((opt) => addAiPreviewOption(opt));

  const radios = dom.aiPreviewOptions.querySelectorAll('input[type="radio"]');
  if (radios.length) {
    const idx = Number(aiDraft.correct_index);
    if (Number.isInteger(idx) && idx >= 0 && idx < radios.length) {
      radios[idx].checked = true;
    } else {
      radios[0].checked = true;
    }
  }

  dom.aiPreviewBox.classList.remove("d-none");
}

function collectAiDraftFromEditor() {
  if (!dom.aiPreviewQuestion || !dom.aiPreviewOptions || !dom.aiPreviewExplanation) return null;
  const question = dom.aiPreviewQuestion.value.trim();
  const rows = Array.from(dom.aiPreviewOptions.children);
  const options = [];
  let correctIndex = -1;

  rows.forEach((row) => {
    const radio = row.querySelector('input[type="radio"]');
    const input = row.querySelector(".ai-preview-option");
    const value = input ? input.value.trim() : "";
    if (!value) return;
    if (radio && radio.checked) {
      correctIndex = options.length;
    }
    options.push(value);
  });

  if (!question || options.length < 2) return null;
  if (correctIndex < 0 || correctIndex >= options.length) correctIndex = 0;

  return {
    question,
    options,
    correct_index: correctIndex,
    explanation: dom.aiPreviewExplanation.value.trim()
  };
}

async function commitAiDraft() {
  if (!aiDraft || !dom.aiPreviewSave || !dom.aiImportStatus) return;
  const compiled = collectAiDraftFromEditor();
  if (!compiled) {
    dom.aiImportStatus.className = "text-warning small mt-2";
    dom.aiImportStatus.textContent = "Review draft is incomplete. Add question and at least 2 options.";
    return;
  }

  dom.aiPreviewSave.disabled = true;
  dom.aiImportStatus.className = "text-info small mt-2";
  dom.aiImportStatus.textContent = "Saving question to test...";

  try {
    const response = await fetch(`/api/tests/${encodeURIComponent(aiDraft.testId)}/ai-import-question/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...compiled,
        image: aiDraft.image || ""
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to save question.");
    }

    dom.aiImportStatus.className = "text-success small mt-2";
    dom.aiImportStatus.textContent = data.message || "Question saved to test.";
    clearAiDraft();
    await loadTests();
  } catch (err) {
    dom.aiImportStatus.className = "text-danger small mt-2";
    dom.aiImportStatus.textContent = err.message || "Failed to save question.";
  } finally {
    dom.aiPreviewSave.disabled = false;
  }
}
