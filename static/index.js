const dom = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  attachImportHandlers();
  initDeleteModal();
  loadTests();
});

function cacheDom() {
  dom.testsList = document.getElementById("tests-list");
  dom.testsEmpty = document.getElementById("tests-empty");
  dom.importBtn = document.getElementById("import-btn");
  dom.importFileInput = document.getElementById("import-file-input");
  dom.importStatus = document.getElementById("import-status");
  dom.deleteModal = document.getElementById("deleteModal");
  dom.deleteTitle = document.getElementById("testTitlePreview");
  dom.deleteConfirm = document.getElementById("confirmDeleteBtn");
}

function attachImportHandlers() {
  if (!dom.importBtn || !dom.importFileInput) return;

  dom.importBtn.addEventListener("click", () => dom.importFileInput.click());

  dom.importFileInput.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      alert("Please select a .json file");
      event.target.value = "";
      return;
    }
    uploadImportFile(file);
    event.target.value = "";
  });
}

function initDeleteModal() {
  if (!dom.deleteModal) return;
  dom.deleteModalInstance = new bootstrap.Modal(dom.deleteModal);
}

async function loadTests() {
  showTestsMessage("Loading tests...");
  try {
    const response = await fetch("/api/tests");
    if (!response.ok) {
      throw new Error("Failed to load tests");
    }
    const data = await response.json();
    renderTests(Array.isArray(data.tests) ? data.tests : []);
  } catch (err) {
    console.error("Failed to load tests:", err);
    showTestsMessage("Unable to load tests. Please refresh.", true);
  }
}

function renderTests(tests) {
  if (!tests.length) {
    dom.testsList.classList.add("d-none");
    showTestsMessage("No tests available. Create one or import a backup!");
    return;
  }

  dom.testsEmpty.classList.add("d-none");
  dom.testsList.classList.remove("d-none");
  dom.testsList.innerHTML = "";

  tests.forEach(test => {
    dom.testsList.appendChild(createTestListItem(test));
  });
}

function showTestsMessage(message, isError = false) {
  if (!dom.testsEmpty) return;
  dom.testsEmpty.textContent = message;
  dom.testsEmpty.classList.remove("d-none", "text-danger");
  dom.testsEmpty.classList.add(isError ? "text-danger" : "text-muted");
}

function createTestListItem(test) {
  const li = document.createElement("li");
  li.className = "list-group-item bg-secondary text-light d-flex justify-content-between align-items-center mb-2";

  const info = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = test.title || "Untitled Test";
  const questionCount = document.createElement("span");
  questionCount.className = "ms-2";
  questionCount.textContent = `(${test.question_count || 0} questions)`;
  info.appendChild(title);
  info.appendChild(questionCount);

  const actions = document.createElement("div");

  const takeLink = document.createElement("a");
  takeLink.href = `/take/${test.id}`;
  takeLink.className = "btn btn-sm btn-primary me-2";
  takeLink.textContent = "Take";

  const editLink = document.createElement("a");
  editLink.href = `/edit/${test.id}`;
  editLink.className = "btn btn-sm btn-warning me-2";
  editLink.textContent = "Edit";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-sm btn-danger";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => showDeleteModal(test));

  actions.appendChild(takeLink);
  actions.appendChild(editLink);
  actions.appendChild(deleteBtn);

  li.appendChild(info);
  li.appendChild(actions);

  return li;
}

function showDeleteModal(test) {
  if (!dom.deleteModalInstance || !dom.deleteTitle || !dom.deleteConfirm) return;
  dom.deleteTitle.textContent = test.title || "Untitled Test";
  dom.deleteConfirm.href = `/delete/${test.id}`;
  dom.deleteModalInstance.show();
}

async function uploadImportFile(file) {
  if (!dom.importStatus) return;
  dom.importStatus.innerHTML = '<span class="text-info">Uploading...</span>';

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/import", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (data.success) {
      dom.importStatus.innerHTML = `<span class="text-success">Success: ${data.message}</span>`;
      loadTests();
    } else {
      dom.importStatus.innerHTML = `<span class="text-danger">Failed: ${data.error || "Upload failed"}</span>`;
    }
  } catch (err) {
    console.error("Import failed:", err);
    dom.importStatus.innerHTML = '<span class="text-danger">Failed: Upload failed</span>';
  }
}
