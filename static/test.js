let TEST_DATA = null;
let QUESTIONS = [];
let indexMap = [];
let optionMap = [];
let currentQuestionIndex = 0;
let userAnswers = {};
let zoomScale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let lastAiSummary = "";
let lastAiQuestionOrigIdx = null;
let lastAiQuestionShuffledIdx = null;

const dom = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  document.body.classList.remove("no-scroll");
  window.addEventListener("pageshow", () => {
    document.body.classList.remove("no-scroll");
  });
  setLoadingState(true);
  setControlsDisabled(true);

  const testId = extractTestId();
  if (testId === null) {
    showFatalError("Invalid test URL. Unable to determine which test to load.");
    return;
  }

  dom.form.action = `/take/${testId}`;
  attachEventListeners();
  loadTest(testId);
});

function cacheDom() {
  dom.testTitle = document.getElementById("test-title");
  dom.progress = document.getElementById("progress");
  dom.questionContainer = document.getElementById("question-container");
  dom.questionContent = dom.questionContainer ? dom.questionContainer.querySelector(".question-content") : null;
  dom.resultMsg = document.getElementById("result-msg");
  dom.aiToggle = document.getElementById("ai-summary-toggle");
  dom.aiSummaryBtn = document.getElementById("ai-summary-btn");
  dom.appendAiBtn = document.getElementById("append-ai-btn");
  dom.aiSummary = document.getElementById("ai-summary");
  dom.form = document.getElementById("test-form");
  dom.checkBtn = document.getElementById("check-btn");
  dom.prevBtn = document.getElementById("prev-btn");
  dom.nextBtn = document.getElementById("next-btn");
  dom.finishBtn = document.getElementById("finish-btn");
  dom.imageOverlay = document.getElementById("image-overlay");
  dom.imageOverlayImg = document.getElementById("image-overlay-img");
  dom.zoomInBtn = document.getElementById("zoom-in-btn");
  dom.zoomOutBtn = document.getElementById("zoom-out-btn");
  dom.zoomResetBtn = document.getElementById("zoom-reset-btn");
}

function attachEventListeners() {
  dom.checkBtn.addEventListener("click", handleCheck);
  if (dom.aiSummaryBtn) {
    dom.aiSummaryBtn.addEventListener("click", handleManualAiSummary);
  }
  if (dom.appendAiBtn) {
    dom.appendAiBtn.addEventListener("click", handleAppendAiSummary);
  }
  dom.prevBtn.addEventListener("click", handlePrev);
  dom.nextBtn.addEventListener("click", handleNext);
  dom.form.addEventListener("submit", handleFormSubmit);
  if (isTouchDevice()) {
    if (dom.imageOverlay) {
      dom.imageOverlay.remove();
    }
    return;
  }
  if (dom.imageOverlay) {
    dom.imageOverlay.addEventListener("click", closeImageViewer);
    dom.imageOverlay.addEventListener("touchstart", preventOverlayScroll, { passive: false });
    dom.imageOverlay.addEventListener("touchmove", preventOverlayScroll, { passive: false });
    dom.imageOverlay.addEventListener("touchend", closeImageViewer);
  }
  if (dom.imageOverlayImg) {
    dom.imageOverlayImg.addEventListener("click", (e) => e.stopPropagation());
    dom.imageOverlayImg.addEventListener("pointerdown", handlePanStart);
    dom.imageOverlayImg.addEventListener("dragstart", (e) => e.preventDefault());
  }
  if (dom.zoomInBtn) {
    dom.zoomInBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      adjustZoom(0.25);
    });
  }
  if (dom.zoomOutBtn) {
    dom.zoomOutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      adjustZoom(-0.25);
    });
  }
  if (dom.zoomResetBtn) {
    dom.zoomResetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetZoom();
    });
  }
  if (dom.imageOverlay) {
    dom.imageOverlay.addEventListener("wheel", handleZoomWheel, { passive: false });
    dom.imageOverlay.addEventListener("pointermove", handlePanMove);
    dom.imageOverlay.addEventListener("pointerup", handlePanEnd);
    dom.imageOverlay.addEventListener("pointercancel", handlePanEnd);
    dom.imageOverlay.addEventListener("pointerleave", handlePanEnd);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeImageViewer();
      return;
    }
    if (dom.imageOverlay && dom.imageOverlay.classList.contains("show")) {
      if (e.key === "+" || e.key === "=") {
        adjustZoom(0.25);
      } else if (e.key === "-" || e.key === "_") {
        adjustZoom(-0.25);
      } else if (e.key.toLowerCase() === "r") {
        resetZoom();
      }
    }
  });
}

function extractTestId() {
  const match = window.location.pathname.match(/\/take\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function loadTest(testId) {
  try {
    const response = await fetch(`/api/tests/${testId}`);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Test not found." : "Failed to fetch test data.");
    }

    const data = await response.json();
    setupTestData(data);

    dom.testTitle.textContent = data.title || "Untitled Test";
    document.title = data.title ? `${data.title} - TestMaker` : "TestMaker";

    if (!QUESTIONS.length) {
      dom.questionContainer.innerHTML = '<div class="alert alert-warning">No questions available in this test.</div>';
      dom.progress.textContent = "";
      return;
    }

    renderQuestion();
    setControlsDisabled(false);
  } catch (err) {
    showFatalError(err.message || "Unable to load test.");
  }
}

function setupTestData(data) {
  TEST_DATA = data;
  const questionList = Array.isArray(data.questions) ? data.questions : [];
  const prepared = prepareQuestionState(questionList);

  QUESTIONS = prepared.questions;
  indexMap = prepared.indexMap;
  optionMap = prepared.optionMap;

  userAnswers = {};
  currentQuestionIndex = 0;
  clearResult();
  initHiddenInputs(questionList.length);
  initQuestionShell();
}

function prepareQuestionState(questionList) {
  const withShuffledOptions = questionList.map((question, origIdx) => {
    const options = Array.isArray(question.options) ? question.options : [];
    const order = options.map((_, idx) => idx);
    shuffleInPlace(order);

    const shuffledOptions = order.map(idx => options[idx]);
    const correctIndex = order.indexOf(question.correct_index);

    return {
      ...question,
      options: shuffledOptions,
      correct_index: correctIndex,
      __origIdx: origIdx,
      __optionMap: order
    };
  });

  shuffleInPlace(withShuffledOptions);

  const mapQ = withShuffledOptions.map(q => q.__origIdx);
  const mapOpt = withShuffledOptions.map(q => q.__optionMap);
  const sanitizedQuestions = withShuffledOptions.map(({ __origIdx, __optionMap, ...rest }) => rest);

  return {
    questions: sanitizedQuestions,
    indexMap: mapQ,
    optionMap: mapOpt
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function initHiddenInputs(count) {
  const hidden = document.getElementById("hidden-answers");
  hidden.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = `q${i}`;
    input.id = `hidden_q${i}`;
    hidden.appendChild(input);
  }
}

function syncHiddenFor(shuffledIdx) {
  if (indexMap[shuffledIdx] === undefined) return;

  const origQ = indexMap[shuffledIdx];
  const hidden = document.getElementById(`hidden_q${origQ}`);
  if (!hidden) return;

  const shuffledOpt = userAnswers[shuffledIdx];
  if (shuffledOpt === undefined || shuffledOpt === null || shuffledOpt === "") {
    hidden.value = "";
    return;
  }

  const questionOptionMap = optionMap[shuffledIdx] || [];
  const origOpt = questionOptionMap[shuffledOpt];
  hidden.value = origOpt === undefined ? "" : String(origOpt);
}

function renderQuestion() {
  if (!QUESTIONS.length) {
    dom.questionContainer.innerHTML = '<div class="alert alert-warning">No questions available.</div>';
    dom.progress.textContent = "";
    setLoadingState(false);
    return;
  }

  if (!dom.questionContent || !dom.questionTitle || !dom.optionsList) {
    initQuestionShell();
  }

  const question = QUESTIONS[currentQuestionIndex];
  dom.questionContent.style.opacity = "0";
  dom.questionTitle.textContent = `Question ${currentQuestionIndex + 1}: ${question.question}`;

  if (dom.questionImage) {
    if (question.image) {
      dom.questionImage.src = `/uploads/${encodeURIComponent(question.image)}`;
      dom.questionImage.alt = "Question image";
      dom.questionImage.classList.remove("d-none");
      if (!isTouchDevice()) {
        dom.questionImage.onclick = () => openImageViewer(dom.questionImage.src, dom.questionImage.alt);
      } else {
        dom.questionImage.onclick = null;
      }
    } else {
      dom.questionImage.src = "";
      dom.questionImage.classList.add("d-none");
      dom.questionImage.onclick = null;
    }
  }

  dom.optionsList.innerHTML = "";
  const optionsFragment = document.createDocumentFragment();
  question.options.forEach((opt, idx) => {
    const optDiv = document.createElement("div");
    optDiv.classList.add("form-check", "my-2");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `q_ui_${currentQuestionIndex}`;
    radio.id = `q${currentQuestionIndex}_opt${idx}`;
    radio.value = idx;
    radio.classList.add("form-check-input");

    radio.addEventListener("change", () => {
      userAnswers[currentQuestionIndex] = idx;
      syncHiddenFor(currentQuestionIndex);
    });

    if (userAnswers[currentQuestionIndex] === idx) {
      radio.checked = true;
    }

    const label = document.createElement("label");
    label.classList.add("form-check-label");
    label.setAttribute("for", radio.id);
    label.textContent = opt;

    optDiv.appendChild(radio);
    optDiv.appendChild(label);
    optionsFragment.appendChild(optDiv);
  });
  dom.optionsList.appendChild(optionsFragment);

  updateProgress();
  clearResult();
  setLoadingState(false);
  requestAnimationFrame(() => {
    dom.questionContent.style.opacity = "1";
  });
}

function updateProgress() {
  if (!QUESTIONS.length) {
    dom.progress.textContent = "";
    return;
  }
  dom.progress.textContent = `Question ${currentQuestionIndex + 1} of ${QUESTIONS.length}`;
}

function clearResult() {
  dom.resultMsg.textContent = "";
  dom.resultMsg.className = "mt-2";
  if (dom.aiSummary) {
    dom.aiSummary.textContent = "";
    dom.aiSummary.className = "mt-2";
  }
  lastAiSummary = "";
  lastAiQuestionOrigIdx = null;
  lastAiQuestionShuffledIdx = null;
  if (dom.appendAiBtn) {
    dom.appendAiBtn.classList.add("d-none");
    dom.appendAiBtn.disabled = false;
    dom.appendAiBtn.textContent = "Append AI Summary To Explanation";
  }
}

function showResult(isCorrect, explanation) {
  dom.resultMsg.classList.remove("text-success", "text-danger");
  dom.resultMsg.textContent = "";

  const status = document.createElement("span");
  status.className = isCorrect ? "text-success" : "text-danger";
  status.textContent = isCorrect ? "Correct!" : "Incorrect.";
  dom.resultMsg.appendChild(status);

  if (explanation) {
    dom.resultMsg.appendChild(document.createElement("br"));
    const label = document.createElement("em");
    label.textContent = "Explanation:";
    dom.resultMsg.appendChild(label);
    dom.resultMsg.appendChild(document.createTextNode(` ${explanation}`));
  }
}

function getSelectedAnswer() {
  if (!QUESTIONS.length) return null;
  const selected = document.querySelector(`input[name="q_ui_${currentQuestionIndex}"]:checked`);
  return selected ? parseInt(selected.value, 10) : null;
}

function handleCheck() {
  if (!QUESTIONS.length) return;
  const selected = getSelectedAnswer();
  if (selected === null) {
    alert("Please select an answer.");
    return;
  }

  userAnswers[currentQuestionIndex] = selected;
  syncHiddenFor(currentQuestionIndex);

  const correctIndex = QUESTIONS[currentQuestionIndex].correct_index;
  const explanation = QUESTIONS[currentQuestionIndex].explanation || "";
  showResult(selected === correctIndex, explanation);

  if (dom.aiToggle && dom.aiToggle.checked) {
    requestAiSummary(QUESTIONS[currentQuestionIndex], selected);
  }
}

async function requestAiSummary(question, selectedIndex) {
  if (!dom.aiSummary) return;

  dom.aiSummary.className = "mt-2 text-info";
  dom.aiSummary.textContent = "Generating AI summary...";

  const payload = {
    question: question.question,
    options: question.options,
    correct_index: question.correct_index,
    selected_index: selectedIndex,
    explanation: question.explanation || ""
  };

  try {
    const response = await fetch("/api/ai-summary-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      throw new Error("Streaming unavailable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let summary = "";
    dom.aiSummary.className = "mt-2 text-light";
    dom.aiSummary.textContent = "AI Summary: ";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      summary += chunk;
      dom.aiSummary.textContent = `AI Summary: ${summary}`;
    }
    summary = summary.trim();

    if (summary) {
      lastAiSummary = summary;
      lastAiQuestionOrigIdx = indexMap[currentQuestionIndex];
      lastAiQuestionShuffledIdx = currentQuestionIndex;
      if (dom.appendAiBtn) {
        dom.appendAiBtn.classList.remove("d-none");
      }
    } else {
      dom.aiSummary.className = "mt-2 text-warning";
      dom.aiSummary.textContent = "No summary returned.";
    }
  } catch (err) {
    try {
      const fallback = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!fallback.ok) {
        const e = await fallback.json().catch(() => ({}));
        throw new Error(e.error || "Unable to generate summary.");
      }
      const data = await fallback.json();
      const summary = String(data.summary || "").trim();
      if (!summary) {
        throw new Error("No summary returned.");
      }
      lastAiSummary = summary;
      lastAiQuestionOrigIdx = indexMap[currentQuestionIndex];
      lastAiQuestionShuffledIdx = currentQuestionIndex;
      if (dom.appendAiBtn) {
        dom.appendAiBtn.classList.remove("d-none");
      }
      dom.aiSummary.className = "mt-2 text-light";
      dom.aiSummary.textContent = `AI Summary: ${summary}`;
    } catch (fallbackErr) {
      dom.aiSummary.className = "mt-2 text-warning";
      dom.aiSummary.textContent = fallbackErr.message || err.message || "Unable to generate AI summary.";
    }
  }
}

function handleManualAiSummary() {
  if (!QUESTIONS.length) return;
  const selected = getSelectedAnswer();
  requestAiSummary(QUESTIONS[currentQuestionIndex], selected);
}

async function handleAppendAiSummary() {
  if (!TEST_DATA || typeof TEST_DATA.id !== "number") return;
  if (!lastAiSummary || lastAiQuestionOrigIdx === null || lastAiQuestionOrigIdx === undefined) return;
  if (!dom.appendAiBtn || !dom.aiSummary) return;

  dom.appendAiBtn.disabled = true;
  dom.appendAiBtn.textContent = "Appending...";

  try {
    const response = await fetch(`/api/tests/${TEST_DATA.id}/questions/${lastAiQuestionOrigIdx}/append-explanation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: lastAiSummary })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Failed to append explanation.");
    }

    const updatedExplanation = String(payload.explanation || "");
    if (
      lastAiQuestionShuffledIdx !== null &&
      lastAiQuestionShuffledIdx >= 0 &&
      lastAiQuestionShuffledIdx < QUESTIONS.length
    ) {
      QUESTIONS[lastAiQuestionShuffledIdx].explanation = updatedExplanation;
    }
    dom.aiSummary.className = "mt-2 text-success";
    dom.aiSummary.textContent = "AI summary appended to this question's explanation.";
    dom.appendAiBtn.textContent = "Appended";
  } catch (err) {
    dom.appendAiBtn.disabled = false;
    dom.appendAiBtn.textContent = "Append AI Summary To Explanation";
    dom.aiSummary.className = "mt-2 text-warning";
    dom.aiSummary.textContent = err.message || "Unable to append AI summary.";
  }
}

function handlePrev() {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex -= 1;
    renderQuestion();
  }
}

function handleNext() {
  if (currentQuestionIndex < QUESTIONS.length - 1) {
    currentQuestionIndex += 1;
    renderQuestion();
    return;
  }
  if (dom.finishBtn) {
    dom.finishBtn.click();
  } else if (dom.form) {
    if (typeof dom.form.requestSubmit === "function") {
      dom.form.requestSubmit();
    } else {
      dom.form.submit();
    }
  }
}

function handleFormSubmit(e) {
  if (!QUESTIONS.length) {
    e.preventDefault();
    alert("No questions to submit.");
    return;
  }

  for (let i = 0; i < QUESTIONS.length; i++) {
    syncHiddenFor(i);
  }

  let answered = 0;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const val = userAnswers[i];
    if (val !== undefined && val !== null && val !== "") {
      answered += 1;
    }
  }

  if (answered < QUESTIONS.length) {
    const confirmSubmit = confirm(
      `You've answered ${answered} of ${QUESTIONS.length} questions.\n\nFinish the test anyway?`
    );
    if (!confirmSubmit) {
      e.preventDefault();
      return;
    }
  }

  dom.finishBtn.disabled = true;
  dom.finishBtn.textContent = "Submitting...";
  dom.finishBtn.classList.remove("btn-success");
  dom.finishBtn.classList.add("btn-secondary");
}

function setControlsDisabled(disabled) {
  [dom.checkBtn, dom.prevBtn, dom.nextBtn, dom.finishBtn].forEach(btn => {
    if (btn) {
      btn.disabled = disabled;
    }
  });
}

function showFatalError(message) {
  setControlsDisabled(true);
  dom.testTitle.textContent = "Error";
  dom.questionContainer.textContent = "";
  const alert = document.createElement("div");
  alert.className = "alert alert-danger";
  alert.textContent = message;
  dom.questionContainer.appendChild(alert);
  dom.progress.textContent = "";
}

function initQuestionShell() {
  if (!dom.questionContainer) return;
  if (!dom.questionContent) {
    dom.questionContent = dom.questionContainer.querySelector(".question-content");
  }
  if (!dom.questionContent) {
    dom.questionContent = document.createElement("div");
    dom.questionContent.className = "question-content";
    dom.questionContainer.appendChild(dom.questionContent);
  }
  if (!dom.questionTitle) {
    dom.questionTitle = document.createElement("h4");
    dom.questionContent.appendChild(dom.questionTitle);
  }
  if (!dom.questionImage) {
    dom.questionImage = document.createElement("img");
    dom.questionImage.className = "question-image my-3 d-none";
    dom.questionContent.appendChild(dom.questionImage);
  }
  if (!dom.optionsList) {
    dom.optionsList = document.createElement("div");
    dom.questionContent.appendChild(dom.optionsList);
  }
}

function setLoadingState(isLoading) {
  if (!dom.questionContainer) return;
  dom.questionContainer.classList.toggle("loading", isLoading);
}

function openImageViewer(src, alt) {
  if (!dom.imageOverlay || !dom.imageOverlayImg || !src) return;
  dom.imageOverlayImg.src = src;
  dom.imageOverlayImg.alt = alt || "Zoomed question image";
  resetZoom();
  dom.imageOverlay.classList.add("show");
  dom.imageOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeImageViewer() {
  if (!dom.imageOverlay || !dom.imageOverlayImg) return;
  if (!dom.imageOverlay.classList.contains("show")) return;
  dom.imageOverlay.classList.remove("show");
  dom.imageOverlay.setAttribute("aria-hidden", "true");
  dom.imageOverlayImg.src = "";
  document.body.classList.remove("no-scroll");
}

function applyZoom() {
  if (!dom.imageOverlayImg) return;
  dom.imageOverlayImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
}

function adjustZoom(delta) {
  const next = zoomScale + delta;
  zoomScale = Math.min(4, Math.max(0.5, next));
  applyZoom();
}

function resetZoom() {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  applyZoom();
}

function handleZoomWheel(e) {
  if (!dom.imageOverlay || !dom.imageOverlay.classList.contains("show")) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.15 : 0.15;
  adjustZoom(delta);
}

function handlePanStart(e) {
  if (!dom.imageOverlay || !dom.imageOverlay.classList.contains("show")) return;
  if (!dom.imageOverlayImg) return;
  if (e.pointerType && e.pointerType !== "mouse") return;
  isPanning = true;
  panStartX = e.clientX - panX;
  panStartY = e.clientY - panY;
  dom.imageOverlayImg.classList.add("dragging");
  dom.imageOverlayImg.setPointerCapture(e.pointerId);
}

function handlePanMove(e) {
  if (!isPanning) return;
  panX = e.clientX - panStartX;
  panY = e.clientY - panStartY;
  applyZoom();
}

function handlePanEnd(e) {
  if (!isPanning) return;
  isPanning = false;
  if (dom.imageOverlayImg) {
    dom.imageOverlayImg.classList.remove("dragging");
    try {
      dom.imageOverlayImg.releasePointerCapture(e.pointerId);
    } catch (_) {
      // ignore if not captured
    }
  }
}

function preventOverlayScroll(e) {
  if (!dom.imageOverlay || !dom.imageOverlay.classList.contains("show")) return;
  e.preventDefault();
}

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)
  );
}
