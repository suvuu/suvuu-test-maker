let TEST_DATA = null;
let QUESTIONS = [];
let currentIndex = 0;
let lastAiSummary = "";

const dom = {};

function cacheDom() {
  dom.title = document.getElementById("flashcards-title");
  dom.progress = document.getElementById("flashcards-progress");
  dom.error = document.getElementById("flashcards-error");
  dom.shell = document.getElementById("flashcard-shell");
  dom.question = document.getElementById("flashcard-question");
  dom.image = document.getElementById("flashcard-image");
  dom.reveal = document.getElementById("flashcard-reveal");
  dom.aiSummaryBtn = document.getElementById("flashcard-ai-summary");
  dom.appendAiBtn = document.getElementById("flashcard-append-ai");
  dom.aiSummaryText = document.getElementById("flashcard-ai-summary-text");
  dom.answer = document.getElementById("flashcard-answer");
  dom.explanation = document.getElementById("flashcard-explanation");
  dom.prev = document.getElementById("flashcard-prev");
  dom.next = document.getElementById("flashcard-next");
}

function getTestId() {
  const match = window.location.pathname.match(/\/flashcards\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function showError(message) {
  if (dom.error) {
    dom.error.textContent = message;
    dom.error.classList.remove("d-none");
  }
  if (dom.shell) {
    dom.shell.classList.add("d-none");
  }
}

function getCorrectAnswer(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  const idx = Number(question.correct_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
    return "Correct answer not available.";
  }
  return options[idx];
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderCard() {
  if (!QUESTIONS.length) {
    showError("No questions available in this test.");
    return;
  }

  const q = QUESTIONS[currentIndex];
  dom.shell.classList.remove("d-none");
  dom.question.textContent = `Question ${currentIndex + 1}: ${q.question || "Untitled question"}`;
  dom.answer.innerHTML = `<strong>Answer:</strong> ${getCorrectAnswer(q)}`;
  dom.answer.classList.add("d-none");
  dom.explanation.classList.add("d-none");
  if (dom.aiSummaryText) {
    dom.aiSummaryText.textContent = "";
    dom.aiSummaryText.className = "mt-3 text-info d-none";
  }
  if (dom.appendAiBtn) {
    dom.appendAiBtn.classList.add("d-none");
    dom.appendAiBtn.disabled = false;
    dom.appendAiBtn.textContent = "Append AI Summary To Explanation";
  }
  lastAiSummary = "";
  if (dom.reveal) {
    dom.reveal.disabled = false;
    dom.reveal.textContent = "Reveal Answer";
  }

  if (q.image) {
    dom.image.src = `/uploads/${encodeURIComponent(q.image)}`;
    dom.image.classList.remove("d-none");
  } else {
    dom.image.src = "";
    dom.image.classList.add("d-none");
  }

  if (q.explanation) {
    dom.explanation.innerHTML = `<strong>Explanation:</strong> ${q.explanation}`;
  } else {
    dom.explanation.textContent = "";
  }

  dom.progress.textContent = `${currentIndex + 1} / ${QUESTIONS.length}`;
  dom.prev.disabled = currentIndex === 0;
  dom.next.disabled = currentIndex >= QUESTIONS.length - 1;
}

function revealCurrentAnswer() {
  if (!QUESTIONS.length) return;
  const q = QUESTIONS[currentIndex] || {};
  dom.answer.classList.remove("d-none");
  if (q.explanation && String(q.explanation).trim()) {
    dom.explanation.classList.remove("d-none");
  }
  if (dom.reveal) {
    dom.reveal.disabled = true;
    dom.reveal.textContent = "Answer Revealed";
  }
}

async function generateAiSummary() {
  if (!TEST_DATA || !QUESTIONS.length || !dom.aiSummaryText) return;
  const q = QUESTIONS[currentIndex];

  dom.aiSummaryText.className = "mt-3 text-info";
  dom.aiSummaryText.textContent = "Generating AI summary...";
  if (dom.aiSummaryBtn) {
    dom.aiSummaryBtn.disabled = true;
  }

  try {
    const response = await fetch("/api/ai-summary-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        selected_index: null,
        explanation: q.explanation || ""
      })
    });

    if (!response.ok || !response.body) {
      throw new Error("Streaming unavailable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let summary = "";
    dom.aiSummaryText.className = "mt-3 text-light";
    dom.aiSummaryText.textContent = "AI Summary: ";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      summary += chunk;
      dom.aiSummaryText.textContent = `AI Summary: ${summary}`;
    }
    summary = summary.trim();

    if (!summary) {
      throw new Error("No summary returned.");
    }

    lastAiSummary = summary;
    if (dom.appendAiBtn) {
      dom.appendAiBtn.classList.remove("d-none");
    }
  } catch (err) {
    try {
      const fallback = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.question,
          options: q.options,
          correct_index: q.correct_index,
          selected_index: null,
          explanation: q.explanation || ""
        })
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
      dom.aiSummaryText.className = "mt-3 text-light";
      dom.aiSummaryText.textContent = `AI Summary: ${summary}`;
      if (dom.appendAiBtn) {
        dom.appendAiBtn.classList.remove("d-none");
      }
    } catch (fallbackErr) {
      dom.aiSummaryText.className = "mt-3 text-warning";
      dom.aiSummaryText.textContent = fallbackErr.message || err.message || "Unable to generate AI summary.";
    }
  } finally {
    if (dom.aiSummaryBtn) {
      dom.aiSummaryBtn.disabled = false;
    }
  }
}

async function appendAiSummaryToExplanation() {
  if (!TEST_DATA || typeof TEST_DATA.id !== "number") return;
  if (!lastAiSummary || !QUESTIONS.length) return;
  const q = QUESTIONS[currentIndex];
  const originalIndex = Number(q.__origIdx);
  if (!Number.isInteger(originalIndex) || originalIndex < 0) return;
  if (!dom.appendAiBtn || !dom.aiSummaryText) return;

  dom.appendAiBtn.disabled = true;
  dom.appendAiBtn.textContent = "Appending...";

  try {
    const response = await fetch(`/api/tests/${TEST_DATA.id}/questions/${originalIndex}/append-explanation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: lastAiSummary })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Failed to append explanation.");
    }

    q.explanation = String(data.explanation || "");
    if (q.explanation && String(q.explanation).trim()) {
      dom.explanation.innerHTML = `<strong>Explanation:</strong> ${q.explanation}`;
      dom.explanation.classList.remove("d-none");
    }
    dom.answer.classList.remove("d-none");
    dom.aiSummaryText.className = "mt-3 text-info d-none";
    dom.aiSummaryText.textContent = "";
    dom.appendAiBtn.textContent = "Appended";
  } catch (err) {
    dom.appendAiBtn.disabled = false;
    dom.appendAiBtn.textContent = "Append AI Summary To Explanation";
    dom.aiSummaryText.className = "mt-3 text-warning";
    dom.aiSummaryText.textContent = err.message || "Unable to append AI summary.";
  }
}

async function loadTest(testId) {
  try {
    const response = await fetch(`/api/tests/${testId}`);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Test not found." : "Failed to load test.");
    }
    const data = await response.json();
    TEST_DATA = data;
    const source = Array.isArray(data.questions) ? data.questions : [];
    QUESTIONS = source.map((q, idx) => ({ ...q, __origIdx: idx }));
    shuffleInPlace(QUESTIONS);
    currentIndex = 0;
    dom.title.textContent = data.title || "Untitled Test";
    document.title = `${dom.title.textContent} - Flashcards`;
    renderCard();
  } catch (err) {
    showError(err.message || "Failed to load flashcards.");
  }
}

function attachHandlers() {
  dom.reveal.addEventListener("click", revealCurrentAnswer);
  if (dom.aiSummaryBtn) {
    dom.aiSummaryBtn.addEventListener("click", generateAiSummary);
  }
  if (dom.appendAiBtn) {
    dom.appendAiBtn.addEventListener("click", appendAiSummaryToExplanation);
  }
  dom.prev.addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderCard();
    }
  });
  dom.next.addEventListener("click", () => {
    if (currentIndex < QUESTIONS.length - 1) {
      currentIndex += 1;
      renderCard();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && currentIndex > 0) {
      currentIndex -= 1;
      renderCard();
    } else if (e.key === "ArrowRight" && currentIndex < QUESTIONS.length - 1) {
      currentIndex += 1;
      renderCard();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  attachHandlers();
  const testId = getTestId();
  if (testId === null) {
    showError("Invalid flashcards URL.");
    return;
  }
  loadTest(testId);
});
