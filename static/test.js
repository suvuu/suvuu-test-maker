let currentQuestionIndex = 0;
let userAnswers = {};

// --- SHUFFLE HELPERS ---
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- BUILD SHUFFLED QUESTIONS + MAPS TO ORIGINAL INDICES ---
const { QUESTIONS, indexMap, optionMap } = (() => {
  // For each question, shuffle options; keep a map from shuffled -> original option index
  const withShuffledOptions = TEST_DATA.questions.map((q, origIdx) => {
    const order = q.options.map((_, i) => i);    // [0,1,2,...] original indices
    shuffleInPlace(order);
    const options = order.map(i => q.options[i]);
    const correct_index = order.indexOf(q.correct_index); // remapped for client-side checking
    return { ...q, options, correct_index, __origIdx: origIdx, __optionMap: order };
  });

  // Shuffle question order
  shuffleInPlace(withShuffledOptions);

  // Build maps aligned to the shuffled order
  const mapQ = withShuffledOptions.map(q => q.__origIdx);       // shuffled question idx -> original question idx
  const mapOpt = withShuffledOptions.map(q => q.__optionMap);   // for each shuffled question: shuffled option idx -> original option idx

  // Strip helpers from QUESTIONS objects used for rendering
  const qs = withShuffledOptions.map(({ __origIdx, __optionMap, ...rest }) => rest);

  return { QUESTIONS: qs, indexMap: mapQ, optionMap: mapOpt };
})();

// --- HIDDEN INPUTS (ONE PER ORIGINAL QUESTION INDEX) ---
function initHiddenInputs() {
  const hidden = document.getElementById("hidden-answers");
  hidden.innerHTML = "";
  for (let orig = 0; orig < TEST_DATA.questions.length; orig++) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = `q${orig}`;      // IMPORTANT: original index naming for Flask
    input.id = `hidden_q${orig}`;
    hidden.appendChild(input);
  }
}
initHiddenInputs();

// sync hidden value for the *current shuffled index* -> original index
function syncHiddenFor(shuffledIdx) {
  const origQ = indexMap[shuffledIdx];             // original question index
  const shuffledOpt = userAnswers[shuffledIdx];    // selected option in shuffled order
  const hidden = document.getElementById(`hidden_q${origQ}`);

  if (shuffledOpt === undefined || shuffledOpt === null || shuffledOpt === "") {
    hidden.value = "";
  } else {
    const origOpt = optionMap[shuffledIdx][shuffledOpt]; // convert to original option index
    hidden.value = String(origOpt);
  }
}


function renderQuestion() {
  const question = QUESTIONS[currentQuestionIndex]; // use shuffled
  const container = document.getElementById("question-container");
  container.innerHTML = "";

  const qEl = document.createElement("div");
  qEl.classList.add("mb-4");

  const qTitle = document.createElement("h4");
  qTitle.textContent = `Question ${currentQuestionIndex + 1}: ${question.question}`;
  qEl.appendChild(qTitle);

  const optionsList = document.createElement("div");

  question.options.forEach((opt, idx) => {
    const optDiv = document.createElement("div");
    optDiv.classList.add("form-check", "my-2");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `q_ui_${currentQuestionIndex}`; // UI-only group name
    radio.id = `q${currentQuestionIndex}_opt${idx}`;
    radio.value = idx;
    radio.classList.add("form-check-input");

    radio.addEventListener("change", () => {
      userAnswers[currentQuestionIndex] = idx; // store by shuffled index
      syncHiddenFor(currentQuestionIndex);     // write to hidden original-index input
    });

    if (userAnswers[currentQuestionIndex] == idx) {
      radio.checked = true;
    }

    const label = document.createElement("label");
    label.classList.add("form-check-label");
    label.setAttribute("for", radio.id);
    label.textContent = opt;

    optDiv.appendChild(radio);
    optDiv.appendChild(label);
    optionsList.appendChild(optDiv);
  });

  qEl.appendChild(optionsList);
  container.appendChild(qEl);

  updateProgress();
  clearResult();
}

function updateProgress() {
  const p = document.getElementById("progress");
  p.textContent = `Question ${currentQuestionIndex + 1} of ${QUESTIONS.length}`;
}

function clearResult() {
  const resultBox = document.getElementById("result-msg");
  resultBox.innerHTML = "";
  resultBox.className = "mt-2";
}

function showResult(isCorrect, explanation) {
  const resultBox = document.getElementById("result-msg");
  resultBox.classList.remove("text-success", "text-danger");
  if (isCorrect) {
    resultBox.innerHTML = `<span class="text-success">✅ Correct!</span><br><em>Explanation:</em> ${explanation}`;
  } else {
    resultBox.innerHTML = `<span class="text-danger">❌ Incorrect.</span><br><em>Explanation:</em> ${explanation}`;
  }
}

function getSelectedAnswer() {
  const selected = document.querySelector(`input[name="q_ui_${currentQuestionIndex}"]:checked`);
  return selected ? parseInt(selected.value) : null;
}

document.getElementById("check-btn").addEventListener("click", () => {
  const selected = getSelectedAnswer();
  if (selected === null) {
    alert("Please select an answer.");
    return;
  }
  userAnswers[currentQuestionIndex] = selected;
  syncHiddenFor(currentQuestionIndex);

  const correctIndex = QUESTIONS[currentQuestionIndex].correct_index; // from shuffled
  const explanation = QUESTIONS[currentQuestionIndex].explanation;
  showResult(selected === correctIndex, explanation);
});

document.getElementById("prev-btn").addEventListener("click", () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    renderQuestion();
  }
});

document.getElementById("next-btn").addEventListener("click", () => {
  if (currentQuestionIndex < QUESTIONS.length - 1) {
    currentQuestionIndex++;
    renderQuestion();
  }
});

// On submit, ensure all hidden inputs reflect current selections
document.getElementById("test-form").addEventListener("submit", () => {
  for (let i = 0; i < QUESTIONS.length; i++) {
    syncHiddenFor(i);
  }
});

// Initial render
renderQuestion();
