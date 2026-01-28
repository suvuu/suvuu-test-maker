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
  dom.testsSkeleton = document.getElementById("tests-skeleton");
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

function renderTests(tests) {
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

function showTestsMessage(message, isError = false) {
  if (!dom.testsEmpty) return;
  dom.testsEmpty.textContent = message;
  dom.testsEmpty.classList.remove("d-none", "text-danger");
  dom.testsEmpty.classList.add(isError ? "text-danger" : "text-muted");
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
