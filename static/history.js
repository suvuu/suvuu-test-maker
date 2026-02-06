const dom = {};

function cacheDom() {
  dom.list = document.getElementById("history-list");
  dom.empty = document.getElementById("history-empty");
  dom.error = document.getElementById("history-error");
  dom.status = document.getElementById("history-status");
  dom.clearBtn = document.getElementById("clear-history-btn");
}

function showError(message) {
  if (dom.error) {
    dom.error.textContent = message;
    dom.error.classList.remove("d-none");
  }
  if (dom.status) {
    dom.status.classList.add("d-none");
    dom.status.textContent = "";
  }
}

function clearError() {
  if (!dom.error) return;
  dom.error.textContent = "";
  dom.error.classList.add("d-none");
}

function showStatus(message) {
  if (dom.status) {
    dom.status.textContent = message;
    dom.status.classList.remove("d-none");
  }
  clearError();
}

function formatDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function renderAttempt(attempt) {
  const wrapper = document.createElement("div");
  wrapper.className = "history-item";

  const top = document.createElement("div");
  top.className = "d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2";

  const title = document.createElement("strong");
  title.textContent = attempt.test_title || "Untitled Test";

  const chip = document.createElement("span");
  chip.className = "score-chip";
  chip.textContent = `${attempt.score}/${attempt.total} (${attempt.percent}%)`;

  top.appendChild(title);
  top.appendChild(chip);

  const dateLine = document.createElement("div");
  dateLine.className = "text-muted small mb-2";
  dateLine.textContent = formatDate(attempt.created_at);

  const actions = document.createElement("div");
  actions.className = "d-flex gap-2";
  if (attempt.id) {
    const review = document.createElement("a");
    review.className = "btn btn-sm btn-primary";
    review.href = `/results/${encodeURIComponent(attempt.id)}`;
    review.textContent = "Review";
    actions.appendChild(review);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-sm btn-outline-danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteAttempt(attempt.id));
    actions.appendChild(del);
  }

  wrapper.appendChild(top);
  wrapper.appendChild(dateLine);
  wrapper.appendChild(actions);
  return wrapper;
}

function renderHistory(items) {
  if (!dom.list || !dom.empty) return;
  dom.list.innerHTML = "";
  if (!items.length) {
    dom.empty.classList.remove("d-none");
    return;
  }
  dom.empty.classList.add("d-none");
  items.forEach((item) => dom.list.appendChild(renderAttempt(item)));
}

async function loadHistory() {
  clearError();
  try {
    const response = await fetch("/api/attempts");
    if (!response.ok) {
      throw new Error("Failed to load history.");
    }
    const data = await response.json();
    const items = Array.isArray(data.attempts) ? data.attempts : [];
    renderHistory(items);
  } catch (err) {
    showError(err.message || "Failed to load history.");
  }
}

async function deleteAttempt(id) {
  if (!id) return;
  const ok = confirm("Delete this result?");
  if (!ok) return;

  clearError();
  try {
    const response = await fetch(`/api/attempts/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to delete result.");
    }
    showStatus("Result deleted.");
    loadHistory();
  } catch (err) {
    showError(err.message || "Failed to delete result.");
  }
}

async function clearHistory() {
  const ok = confirm("Delete all saved results? This cannot be undone.");
  if (!ok) return;

  clearError();
  try {
    const response = await fetch("/api/attempts", {
      method: "DELETE"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to clear history.");
    }
    const count = Number.isFinite(Number(data.deleted)) ? Number(data.deleted) : 0;
    showStatus(`Deleted ${count} result${count === 1 ? "" : "s"}.`);
    loadHistory();
  } catch (err) {
    showError(err.message || "Failed to clear history.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  if (dom.clearBtn) {
    dom.clearBtn.addEventListener("click", clearHistory);
  }
  loadHistory();
});
