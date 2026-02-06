const dom = {};

function cacheDom() {
  dom.list = document.getElementById("history-list");
  dom.empty = document.getElementById("history-empty");
  dom.error = document.getElementById("history-error");
}

function showError(message) {
  if (dom.error) {
    dom.error.textContent = message;
    dom.error.classList.remove("d-none");
  }
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

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  loadHistory();
});
