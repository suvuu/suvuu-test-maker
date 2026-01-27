const dom = {};

function cacheDom() {
  dom.scoreBox = document.getElementById("score-box");
  dom.testTitle = document.getElementById("test-title");
  dom.scoreDisplay = document.getElementById("score-display");
  dom.percentText = document.getElementById("percent-text");
  dom.scoreProgress = document.getElementById("score-progress");
  dom.questionsContainer = document.getElementById("questions-container");
  dom.error = document.getElementById("results-error");
}

function showError(message) {
  if (dom.error) {
    dom.error.textContent = message;
    dom.error.classList.remove("d-none");
  }
  if (dom.scoreBox) {
    dom.scoreBox.classList.add("d-none");
  }
  if (dom.questionsContainer) {
    dom.questionsContainer.innerHTML = "";
  }
  document.title = "Results";
}

function renderAnswer(answer, idx) {
  const wrapper = document.createElement("div");
  wrapper.className = `question-item shadow-sm ${answer.is_correct ? "correct" : "incorrect"}`;

  const header = document.createElement("div");
  header.className = "d-flex justify-content-between align-items-center mb-3";

  const title = document.createElement("h5");
  title.className = "mb-0";
  title.textContent = `Question ${idx + 1}`;

  const status = document.createElement("span");
  status.className = `badge ${answer.is_correct ? "bg-success" : "bg-danger"} fs-6 px-3 py-2`;
  status.textContent = answer.is_correct ? "Correct" : "Incorrect";

  header.appendChild(title);
  header.appendChild(status);

  const questionText = document.createElement("p");
  questionText.className = "mb-3 fw-medium";
  questionText.textContent = answer.question || "Untitled question";

  const imageBlock = answer.image ? document.createElement("img") : null;
  if (imageBlock) {
    imageBlock.className = "question-image mb-3";
    imageBlock.alt = "Question image";
    imageBlock.src = `/uploads/${encodeURIComponent(answer.image)}`;
  }

  const yourAnswerBlock = document.createElement("div");
  yourAnswerBlock.className = "your-answer";

  const yourAnswerLabel = document.createElement("strong");
  yourAnswerLabel.textContent = "Your answer:";

  const yourAnswerText = document.createElement("span");
  yourAnswerText.className = "ms-2";

  const selectedText = getOptionText(answer.options, answer.selected);
  if (selectedText !== null) {
    yourAnswerText.textContent = selectedText;
  } else {
    const noAnswer = document.createElement("em");
    noAnswer.className = "text-muted";
    noAnswer.textContent = "No answer selected";
    yourAnswerText.appendChild(noAnswer);
  }

  yourAnswerBlock.appendChild(yourAnswerLabel);
  yourAnswerBlock.appendChild(yourAnswerText);

  const correctAnswerBlock = document.createElement("div");
  correctAnswerBlock.className = "correct-answer text-success";

  const correctAnswerLabel = document.createElement("strong");
  correctAnswerLabel.textContent = "Correct answer:";

  const correctAnswerText = document.createElement("span");
  correctAnswerText.className = "ms-2";
  const correctText = getOptionText(answer.options, answer.correct);
  correctAnswerText.textContent = correctText !== null ? correctText : "Not provided";

  correctAnswerBlock.appendChild(correctAnswerLabel);
  correctAnswerBlock.appendChild(correctAnswerText);

  wrapper.appendChild(header);
  wrapper.appendChild(questionText);
  if (imageBlock) {
    wrapper.appendChild(imageBlock);
  }
  wrapper.appendChild(yourAnswerBlock);
  wrapper.appendChild(correctAnswerBlock);

  if (answer.explanation) {
    const explanationBlock = document.createElement("div");
    explanationBlock.className = "explanation";
    const explanationLabel = document.createElement("strong");
    explanationLabel.textContent = "Explanation:";
    const explanationText = document.createElement("p");
    explanationText.className = "mb-0";
    explanationText.textContent = answer.explanation;
    explanationBlock.appendChild(explanationLabel);
    explanationBlock.appendChild(document.createElement("br"));
    explanationBlock.appendChild(explanationText);
    wrapper.appendChild(explanationBlock);
  }

  return wrapper;
}

function getOptionText(options, index) {
  if (!Array.isArray(options)) {
    return null;
  }
  if (typeof index !== "number" || index < 0 || index >= options.length) {
    return null;
  }
  const value = options[index];
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function renderResults(payload) {
  if (!payload || typeof payload !== "object") {
    showError("Results data missing.");
    return;
  }

  const title = payload.test_title || "Test Results";
  const score = normalizeNumber(payload.score);
  const total = Math.max(0, normalizeNumber(payload.total));
  const answers = Array.isArray(payload.answers) ? payload.answers : [];

  const percent = total > 0 ? Math.round((score / total) * 1000) / 10 : 0;

  dom.testTitle.textContent = title;
  document.title = `${title} - Results`;
  dom.scoreDisplay.textContent = `${score} / ${total}`;
  dom.percentText.textContent = `${percent}% Correct`;
  dom.scoreProgress.style.width = `${percent}%`;
  dom.scoreProgress.textContent = `${percent}%`;

  dom.questionsContainer.innerHTML = "";
  if (!answers.length) {
    dom.questionsContainer.innerHTML = '<p class="text-muted text-center">No answer data available.</p>';
    return;
  }

  answers.forEach((answer, idx) => dom.questionsContainer.appendChild(renderAnswer(answer, idx)));
}

async function fetchResults(token) {
  try {
    const response = await fetch(`/api/results/${encodeURIComponent(token)}`);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Results not found." : "Failed to load results.");
    }
    const payload = await response.json();
    renderResults(payload);
  } catch (err) {
    console.error("Failed to load results:", err);
    showError(err.message || "Unable to load results.");
  }
}

function extractToken() {
  const pathMatch = window.location.pathname.match(/\/results\/([^/]+)/);
  if (pathMatch && pathMatch[1]) {
    return decodeURIComponent(pathMatch[1]);
  }
  const queryToken = new URLSearchParams(window.location.search).get("token");
  return queryToken ? queryToken : null;
}

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  const token = extractToken();
  if (!token) {
    showError("No results data found. Please retake the test.");
    return;
  }
  fetchResults(token);
});
