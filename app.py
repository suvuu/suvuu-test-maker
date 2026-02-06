from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, send_from_directory, Response, stream_with_context # type: ignore
from werkzeug.utils import secure_filename
import json
import os
import io
import base64
from uuid import uuid4
import requests
import zipfile
from datetime import datetime, timezone

app = Flask(__name__)

DATA_FOLDER = "data"
os.makedirs(DATA_FOLDER, exist_ok=True)
UPLOAD_FOLDER = os.path.join(DATA_FOLDER, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

DATA_FILE = os.path.join(DATA_FOLDER, "data.json")
RESULT_CACHE = {}
ATTEMPTS_FILE = os.path.join(DATA_FOLDER, "attempts.json")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "30"))
AI_CONFIG_FILE = os.path.join(DATA_FOLDER, "ai_config.json")
MAX_STORED_ATTEMPTS = 2000


def load_ai_config():
    default_config = {
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL
    }
    if os.path.exists(AI_CONFIG_FILE):
        try:
            with open(AI_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return {
                    "ollama_url": str(data.get("ollama_url", default_config["ollama_url"])).strip() or default_config["ollama_url"],
                    "ollama_model": str(data.get("ollama_model", default_config["ollama_model"])).strip() or default_config["ollama_model"]
                }
        except (json.JSONDecodeError, OSError):
            pass
    return default_config


def save_ai_config(cfg):
    payload = {
        "ollama_url": str(cfg.get("ollama_url", "")).strip(),
        "ollama_model": str(cfg.get("ollama_model", "")).strip()
    }
    with open(AI_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
    return payload


def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {"tests": []}
    return {"tests": []}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def load_attempts():
    if os.path.exists(ATTEMPTS_FILE):
        try:
            with open(ATTEMPTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("attempts"), list):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"attempts": []}

def save_attempts(data):
    attempts = data.get("attempts", [])
    if not isinstance(attempts, list):
        attempts = []
    with open(ATTEMPTS_FILE, "w", encoding="utf-8") as f:
        json.dump({"attempts": attempts}, f, indent=4, ensure_ascii=False)

def persist_attempt(payload):
    attempts_data = load_attempts()
    attempts = attempts_data.get("attempts", [])
    if not isinstance(attempts, list):
        attempts = []
    attempts.append(payload)
    if len(attempts) > MAX_STORED_ATTEMPTS:
        attempts = attempts[-MAX_STORED_ATTEMPTS:]
    attempts_data["attempts"] = attempts
    save_attempts(attempts_data)

def get_attempt_by_token(token):
    attempts_data = load_attempts()
    attempts = attempts_data.get("attempts", [])
    if not isinstance(attempts, list):
        return None
    for attempt in reversed(attempts):
        if isinstance(attempt, dict) and str(attempt.get("id", "")) == token:
            return attempt
    return None

def delete_attempt_by_token(token):
    attempts_data = load_attempts()
    attempts = attempts_data.get("attempts", [])
    if not isinstance(attempts, list):
        attempts = []

    token_str = str(token).strip()
    kept = []
    removed = 0
    for attempt in attempts:
        if not isinstance(attempt, dict):
            continue
        if str(attempt.get("id", "")).strip() == token_str:
            removed += 1
            continue
        kept.append(attempt)

    if removed > 0:
        attempts_data["attempts"] = kept
        save_attempts(attempts_data)

    RESULT_CACHE.pop(token_str, None)
    return removed

def clear_attempts():
    attempts_data = load_attempts()
    attempts = attempts_data.get("attempts", [])
    if not isinstance(attempts, list):
        attempts = []
    removed = len(attempts)
    attempts_data["attempts"] = []
    save_attempts(attempts_data)
    RESULT_CACHE.clear()
    return removed

def is_allowed_image(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in ALLOWED_IMAGE_EXTENSIONS

def save_uploaded_image(file_storage):
    if not file_storage or not file_storage.filename:
        return None
    if not is_allowed_image(file_storage.filename):
        return None
    original = secure_filename(file_storage.filename)
    _, ext = os.path.splitext(original)
    filename = f"{uuid4().hex}{ext.lower()}"
    path = os.path.join(UPLOAD_FOLDER, filename)
    file_storage.save(path)
    return filename

def parse_ai_generated_question(raw_text):
    text = str(raw_text or "").strip()
    if not text:
        return None

    candidate = text
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        snippet = candidate[start:end + 1]
        try:
            data = json.loads(snippet)
        except json.JSONDecodeError:
            return None

    if not isinstance(data, dict):
        return None

    question = str(data.get("question", "")).strip()
    options = data.get("options", [])
    explanation = str(data.get("explanation", "")).strip()
    correct_index = data.get("correct_index")

    if not question or not isinstance(options, list):
        return None

    cleaned_options = []
    for opt in options:
        value = str(opt).strip()
        if value:
            cleaned_options.append(value)

    if len(cleaned_options) < 2:
        return None

    try:
        correct_index = int(correct_index)
    except (TypeError, ValueError):
        return None

    if correct_index < 0 or correct_index >= len(cleaned_options):
        return None

    cleaned_options, correct_index = merge_split_option_fragments(cleaned_options, correct_index)
    if len(cleaned_options) < 2:
        return None

    return {
        "question": question,
        "options": cleaned_options,
        "correct_index": correct_index,
        "explanation": explanation
    }

def looks_like_option_fragment(text):
    s = str(text or "").strip()
    if not s:
        return False
    lowered = s.lower()
    if lowered.startswith(("and ", "or ", "to ", "for ", "with ", "that ", "which ", "because ", "so ", "as ", "by ", "in ", "on ")):
        return True
    if s[0] in ",;:.)]":
        return True
    for ch in s:
        if ch.isalpha():
            return ch.islower()
        if ch.isdigit():
            return False
    return False

def merge_split_option_fragments(options, correct_index):
    # Heuristic repair: when OCR/model splits one option sentence into multiple options.
    if not isinstance(options, list) or len(options) < 5:
        return options, correct_index

    merged = []
    new_correct = correct_index
    for i, opt in enumerate(options):
        current = str(opt).strip()
        if not current:
            continue

        should_merge = False
        if merged:
            prev = merged[-1]
            prev_complete = prev.rstrip().endswith((".", "!", "?", ")"))
            if looks_like_option_fragment(current) and not prev_complete:
                should_merge = True

        if should_merge:
            merged[-1] = f"{merged[-1]} {current}".strip()
            prev_idx = len(merged) - 1
            if new_correct == i:
                new_correct = prev_idx
            elif new_correct > i:
                new_correct -= 1
        else:
            merged.append(current)

    if not merged:
        return options, correct_index
    if new_correct < 0 or new_correct >= len(merged):
        new_correct = 0
    return merged, new_correct

def extract_ollama_text(payload):
    if not isinstance(payload, dict):
        return ""
    message = payload.get("message")
    if isinstance(message, dict):
        content = str(message.get("content", "")).strip()
        if content:
            return content
    response_text = str(payload.get("response", "")).strip()
    if response_text:
        return response_text
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                content = str(msg.get("content", "")).strip()
                if content:
                    return content
            text = str(first.get("text", "")).strip()
            if text:
                return text
    return ""

def build_ai_summary_prompts(question, options, correct_answer, selected_answer, explanation):
    option_lines = "\n".join([f"{idx + 1}. {opt}" for idx, opt in enumerate(options)])
    system_prompt = (
        "You are an expert tutor. Explain WHY the correct answer is correct so the student learns the concept, not just the result. "
        "Write at most 3 sentences in plain text. "
        "Requirements: "
        "1) State the core concept or rule being tested. "
        "2) Use at least one concrete clue from the question/options. "
        "3) Explain why the correct option fits that clue. "
        "4) End with one short takeaway the student can reuse on similar questions. "
        "Do not use markdown, bullet points, or generic filler. Never exceed 3 sentences. "
        "Do not mention wrong options, incorrect choices, or why any other option is wrong."
    )
    user_prompt = (
        f"Question:\n{question}\n\nOptions:\n{option_lines}\n\n"
        f"Correct answer:\n{correct_answer}\n\n"
        f"Student selected:\n{selected_answer or 'No selection'}\n\n"
        f"Provided explanation:\n{explanation or 'None'}"
    )
    return system_prompt, user_prompt

def delete_image_file(filename):
    if not filename:
        return
    path = os.path.join(UPLOAD_FOLDER, filename)
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass

def parse_test_form(form, files):
    title = form.get('title', '').strip()
    questions = []
    idx = 0

    while True:
        q = form.get(f'question_{idx}')
        if q is None:
            break

        q = q.strip()

        # collect options
        opts = []
        opt_i = 0
        while True:
            key = f'option_{opt_i}_{idx}'
            val = form.get(key)
            if val is None:
                break
            val = val.strip()
            if val:
                opts.append(val)
            opt_i += 1

        # editor sends ZERO-BASED correct values
        correct_raw = form.get(f'correct_{idx}', '0')

        try:
            correct = int(correct_raw)
        except ValueError:
            correct = 0

        # clamp
        if opts:
            correct = max(0, min(correct, len(opts) - 1))
        else:
            correct = 0

        explanation = form.get(f'explanation_{idx}', '').strip()

        existing_image = form.get(f'existing_image_{idx}', '').strip()
        remove_image = form.get(f'remove_image_{idx}', '').strip().lower() == "on"
        uploaded_file = files.get(f'image_{idx}')

        image_filename = existing_image or ""
        if remove_image:
            image_filename = ""
            delete_image_file(existing_image)

        if uploaded_file and uploaded_file.filename:
            new_image = save_uploaded_image(uploaded_file)
            if new_image:
                if existing_image and existing_image != new_image:
                    delete_image_file(existing_image)
                image_filename = new_image

        questions.append({
            "question": q,
            "options": opts,
            "correct_index": correct,
            "explanation": explanation,
            "image": image_filename
        })

        idx += 1

    return {
        "title": title,
        "questions": questions
    }


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        # Some clients post to "/" (e.g., form without action). Return 204 to avoid extra GET noise.
        return ("", 204)
    return render_template("index.html")

@app.route("/new", methods=["GET", "POST"])
def new_test():
    if request.method == "POST":
        data = load_data()
        test = parse_test_form(request.form, request.files)
        data["tests"].append(test)
        save_data(data)
        return redirect(url_for("index"))
    return render_template("test_editor.html", test=None)

@app.route("/edit/<int:test_id>", methods=["GET", "POST"])
def edit_test(test_id):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return "Test not found", 404

    if request.method == "POST":
        test = parse_test_form(request.form, request.files)
        data["tests"][test_id] = test
        save_data(data)
        return redirect(url_for("index"))

    return render_template("test_editor.html", test=data["tests"][test_id])

@app.route("/take/<int:test_id>", methods=["GET", "POST"])
def take_test(test_id):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return "Test not found", 404

    test = data["tests"][test_id]

    if request.method == "POST":
        user_answers = []
        correct_count = 0

        for i, q in enumerate(test["questions"]):
            selected_raw = request.form.get(f"q{i}")
            try:
                selected = int(selected_raw) if selected_raw not in (None, "") else None
            except ValueError:
                selected = None

            correct = q["correct_index"]
            is_correct = selected == correct

            user_answers.append({
                "question": q["question"],
                "options": q["options"],
                "selected": selected,
                "correct": correct,
                "is_correct": is_correct,
                "explanation": q.get("explanation", ""),
                "image": q.get("image", "")
            })

            if is_correct:
                correct_count += 1

        token = str(uuid4())
        result_payload = {
            "id": token,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "test_id": test_id,
            "test_title": test["title"],
            "score": correct_count,
            "total": len(test["questions"]),
            "answers": user_answers
        }
        persist_attempt(result_payload)
        RESULT_CACHE[token] = result_payload
        # Basic cleanup to prevent unlimited growth
        while len(RESULT_CACHE) > 50:
            oldest_key = next(iter(RESULT_CACHE))
            RESULT_CACHE.pop(oldest_key, None)
        return redirect(url_for("results_page", token=token))

    return render_template("test_taker.html", test=test, test_id=test_id)

@app.route("/flashcards/<int:test_id>")
def flashcards_page(test_id):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return "Test not found", 404
    return render_template("flashcards.html", test_id=test_id)


@app.route("/api/tests", methods=["GET"])
def api_list_tests():
    data = load_data()
    tests = [
        {
            "id": idx,
            "title": test.get("title", "Untitled"),
            "question_count": len(test.get("questions", [])) if isinstance(test.get("questions", []), list) else 0
        }
        for idx, test in enumerate(data["tests"])
    ]
    return jsonify({"tests": tests})


@app.route("/api/tests/<int:test_id>")
def api_get_test(test_id):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return jsonify({"error": "Test not found"}), 404

    test = data["tests"][test_id]
    # include id for reference on the client
    return jsonify({"id": test_id, **test})

@app.route("/api/tests/<int:test_id>/questions/<int:question_idx>/append-explanation", methods=["POST"])
def api_append_explanation(test_id, question_idx):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return jsonify({"error": "Test not found"}), 404

    test = data["tests"][test_id]
    questions = test.get("questions", [])
    if not isinstance(questions, list) or question_idx < 0 or question_idx >= len(questions):
        return jsonify({"error": "Question not found"}), 404

    payload = request.get_json(silent=True) or {}
    ai_summary = str(payload.get("summary", "")).strip()
    if not ai_summary:
        return jsonify({"error": "Summary is required."}), 400
    if len(ai_summary) > 4000:
        return jsonify({"error": "Summary is too long."}), 400

    question = questions[question_idx]
    if not isinstance(question, dict):
        return jsonify({"error": "Invalid question format."}), 400

    # Replace existing explanation with the AI summary.
    updated = ai_summary
    question["explanation"] = updated
    save_data(data)
    return jsonify({"success": True, "explanation": updated})

@app.route("/api/tests/<int:test_id>/ai-import-question", methods=["POST"])
def api_ai_import_question_from_image(test_id):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return jsonify({"error": "Test not found"}), 404

    image_file = request.files.get("image")
    if not image_file or not image_file.filename:
        return jsonify({"error": "Image is required."}), 400
    if not is_allowed_image(image_file.filename):
        return jsonify({"error": "Unsupported image format."}), 400

    image_bytes = image_file.read()
    if not image_bytes:
        return jsonify({"error": "Image file is empty."}), 400

    attach_source_image = str(request.form.get("attach_source_image", "on")).strip().lower() in ("on", "true", "1", "yes")
    source_image_name = ""
    if attach_source_image:
        image_file.stream.seek(0)
        saved = save_uploaded_image(image_file)
        if saved:
            source_image_name = saved

    cfg = load_ai_config()
    ollama_url = str(cfg.get("ollama_url", OLLAMA_URL)).strip().rstrip("/")
    ollama_model = str(cfg.get("ollama_model", OLLAMA_MODEL)).strip()

    system_prompt = (
        "You extract one multiple-choice question from an image. "
        "Return strict JSON only, with keys: question, options, correct_index, explanation. "
        "Rules: options must be an array of strings (2+ items), correct_index is 0-based integer, "
        "each option must be one complete choice exactly as shown, and never split one choice into multiple options. "
        "explanation must be extracted verbatim from the image if present, with no paraphrasing or rewriting. "
        "If no explanation text is present in the image, use an empty string for explanation. "
        "Do not include markdown."
    )
    user_prompt = (
        "Read the uploaded image and extract exactly one complete MCQ from it. "
        "If the image has multiple items, pick the clearest single question. "
        "Preserve option boundaries from labels like A/B/C/D or 1/2/3/4 and do not break one option into fragments. "
        "Copy the explanation exactly as written in the image. "
        "Output JSON only."
    )

    image_b64 = base64.b64encode(image_bytes).decode("ascii")

    try:
        first_response = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt, "images": [image_b64]}
                ],
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 400,
                    "top_p": 0.9
                }
            },
            timeout=OLLAMA_TIMEOUT
        )
    except requests.RequestException:
        if source_image_name:
            delete_image_file(source_image_name)
        return jsonify({"error": "AI server is unavailable."}), 502

    if first_response.status_code != 200:
        if source_image_name:
            delete_image_file(source_image_name)
        return jsonify({"error": "AI server error. Use a vision-capable Ollama model (e.g., llava)."}), 502

    try:
        first_payload = first_response.json() if first_response.content else {}
    except ValueError:
        if source_image_name:
            delete_image_file(source_image_name)
        return jsonify({"error": "AI server returned invalid response."}), 502

    first_content = extract_ollama_text(first_payload)
    first_parsed = parse_ai_generated_question(first_content)
    if not first_parsed:
        if source_image_name:
            delete_image_file(source_image_name)
        return jsonify({"error": "Could not parse a valid question from pass 1. Try a clearer image or different model."}), 422

    second_system_prompt = (
        "You are correcting OCR mistakes in an extracted MCQ using the original image. "
        "Return strict JSON only with keys: question, options, correct_index, explanation. "
        "Keep text faithful to the image. Keep correct_index aligned with options. "
        "Do not split one answer option into multiple options; preserve each choice as a complete unit. "
        "Explanation must remain verbatim from the image (correct OCR only), with no paraphrasing."
    )
    second_user_prompt = (
        "Re-read the image and correct spelling/wording mistakes in this extracted draft JSON. "
        "If draft is already correct, return equivalent corrected JSON. "
        "Do not rewrite explanation style; only OCR-correct it against the image.\n\n"
        f"Draft JSON:\n{json.dumps(first_parsed, ensure_ascii=False)}"
    )

    second_parsed = None
    try:
        second_response = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": ollama_model,
                "messages": [
                    {"role": "system", "content": second_system_prompt},
                    {"role": "user", "content": second_user_prompt, "images": [image_b64]}
                ],
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 400,
                    "top_p": 0.9
                }
            },
            timeout=OLLAMA_TIMEOUT
        )
        if second_response.status_code == 200:
            second_payload = second_response.json() if second_response.content else {}
            second_content = extract_ollama_text(second_payload)
            second_parsed = parse_ai_generated_question(second_content)
    except (requests.RequestException, ValueError):
        second_parsed = None

    final_parsed = second_parsed or first_parsed
    question_obj = {
        "question": final_parsed["question"],
        "options": final_parsed["options"],
        "correct_index": final_parsed["correct_index"],
        "explanation": final_parsed.get("explanation", ""),
        "image": source_image_name
    }

    return jsonify({
        "success": True,
        "message": "AI ran 2 passes and generated a draft. Review before saving.",
        "question": question_obj,
        "test_id": test_id,
        "passes": 2
    })

@app.route("/api/tests/<int:test_id>/ai-import-question/commit", methods=["POST"])
def api_ai_import_question_commit(test_id):
    data = load_data()
    if test_id < 0 or test_id >= len(data["tests"]):
        return jsonify({"error": "Test not found"}), 404

    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question", "")).strip()
    options_raw = payload.get("options", [])
    explanation = str(payload.get("explanation", "")).strip()
    image_name = str(payload.get("image", "")).strip()

    if not question:
        return jsonify({"error": "Question is required."}), 400
    if not isinstance(options_raw, list):
        return jsonify({"error": "Options must be a list."}), 400

    options = []
    for opt in options_raw:
        val = str(opt).strip()
        if val:
            options.append(val)
    if len(options) < 2:
        return jsonify({"error": "At least 2 options are required."}), 400

    try:
        correct_index = int(payload.get("correct_index"))
    except (TypeError, ValueError):
        return jsonify({"error": "Correct index is invalid."}), 400

    if correct_index < 0 or correct_index >= len(options):
        return jsonify({"error": "Correct index out of range."}), 400

    if image_name:
        safe_name = secure_filename(os.path.basename(image_name))
        if not safe_name or not is_allowed_image(safe_name):
            image_name = ""
        else:
            image_name = safe_name
            if not os.path.exists(os.path.join(UPLOAD_FOLDER, image_name)):
                image_name = ""

    question_obj = {
        "question": question,
        "options": options,
        "correct_index": correct_index,
        "explanation": explanation,
        "image": image_name
    }

    data["tests"][test_id].setdefault("questions", [])
    if not isinstance(data["tests"][test_id]["questions"], list):
        data["tests"][test_id]["questions"] = []
    data["tests"][test_id]["questions"].append(question_obj)
    save_data(data)

    return jsonify({"success": True, "message": "Question saved to test.", "question": question_obj})

@app.route("/api/ai-config", methods=["GET", "POST"])
def api_ai_config():
    if request.method == "GET":
        cfg = load_ai_config()
        return jsonify(cfg)

    payload = request.get_json(silent=True) or {}
    ollama_url = str(payload.get("ollama_url", "")).strip()
    ollama_model = str(payload.get("ollama_model", "")).strip()

    if not ollama_url:
        return jsonify({"error": "Ollama URL is required."}), 400
    if not ollama_model:
        return jsonify({"error": "Model name is required."}), 400

    saved = save_ai_config({
        "ollama_url": ollama_url.rstrip("/"),
        "ollama_model": ollama_model
    })
    return jsonify(saved)

@app.route("/api/ai-summary", methods=["POST"])
def api_ai_summary():
    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question", "")).strip()
    options = payload.get("options", [])
    correct_index = payload.get("correct_index")
    selected_index = payload.get("selected_index")
    explanation = str(payload.get("explanation", "")).strip()

    if not question or not isinstance(options, list) or not options:
        return jsonify({"error": "Invalid question payload."}), 400

    if not isinstance(correct_index, int) or not (0 <= correct_index < len(options)):
        return jsonify({"error": "Invalid correct index."}), 400

    correct_answer = options[correct_index]
    selected_answer = ""
    if isinstance(selected_index, int) and 0 <= selected_index < len(options):
        selected_answer = options[selected_index]

    cfg = load_ai_config()
    ollama_url = str(cfg.get("ollama_url", OLLAMA_URL)).strip().rstrip("/")
    ollama_model = str(cfg.get("ollama_model", OLLAMA_MODEL)).strip()
    system_prompt, user_prompt = build_ai_summary_prompts(
        question=question,
        options=options,
        correct_answer=correct_answer,
        selected_answer=selected_answer,
        explanation=explanation
    )

    try:
        response = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "stream": False,
                "options": {
                    "temperature": 0.2,
                    "num_predict": 180,
                    "top_p": 0.9,
                    "repeat_penalty": 1.1
                }
            },
            timeout=OLLAMA_TIMEOUT
        )
    except requests.RequestException:
        return jsonify({"error": "AI server is unavailable."}), 502

    if response.status_code != 200:
        return jsonify({"error": "AI server error."}), 502

    try:
        data = response.json() if response.content else {}
    except ValueError:
        preview = response.text[:200] if response.text else "Empty response"
        return jsonify({"error": f"AI server returned non-JSON response: {preview}"}), 502

    if isinstance(data, dict) and data.get("error"):
        return jsonify({"error": str(data.get('error'))}), 502

    summary = ""
    thinking = ""
    if isinstance(data, dict):
        msg = data.get("message")
        if isinstance(msg, dict):
            summary = str(msg.get("content", "")).strip()
        if not summary:
            choices = data.get("choices")
            if isinstance(choices, list) and choices:
                first = choices[0]
                if isinstance(first, dict):
                    msg = first.get("message")
                    if isinstance(msg, dict):
                        summary = str(msg.get("content", "")).strip()
                    if not summary:
                        summary = str(first.get("text", "")).strip()
        if not summary:
            summary = str(data.get("response", "")).strip()
        thinking = str(data.get("thinking", "")).strip()

    if not summary and isinstance(data, dict):
        message = data.get("message")
        if isinstance(message, dict):
            summary = str(message.get("content", "")).strip()

    if not summary and isinstance(data, dict):
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                msg = first.get("message")
                if isinstance(msg, dict):
                    summary = str(msg.get("content", "")).strip()
                if not summary:
                    summary = str(first.get("text", "")).strip()

    if not summary:
        try:
            fallback = requests.post(
                f"{ollama_url}/api/generate",
                json={
                    "model": ollama_model,
                    "prompt": user_prompt,
                    "system": system_prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.2,
                        "num_predict": 180,
                        "top_p": 0.9,
                        "repeat_penalty": 1.1
                    }
                },
                timeout=OLLAMA_TIMEOUT
            )
        except requests.RequestException:
            return jsonify({"error": "AI server is unavailable."}), 502

        if fallback.status_code != 200:
            return jsonify({"error": "AI server error."}), 502

        try:
            fb_data = fallback.json() if fallback.content else {}
        except ValueError:
            preview = fallback.text[:200] if fallback.text else "Empty response"
            return jsonify({"error": f"AI server returned non-JSON response: {preview}"}), 502

        if isinstance(fb_data, dict):
            summary = str(fb_data.get("response", "")).strip()
            if not summary:
                msg = fb_data.get("message")
                if isinstance(msg, dict):
                    summary = str(msg.get("content", "")).strip()
            if not thinking:
                thinking = str(fb_data.get("thinking", "")).strip()

    if not summary and thinking:
        return jsonify({
            "error": "Model returned only 'thinking' without a usable answer.",
            "debug": {
                "provider": "ollama",
                "model": ollama_model,
                "endpoint": f"{ollama_url}/api/chat",
                "hint": "This model may be configured to output chain-of-thought only. Try a model that returns a 'response' or 'message.content'."
            }
        }), 502

    if not summary:
        keys = ", ".join(sorted([str(k) for k in data.keys()])) if isinstance(data, dict) else "unknown"
        return jsonify({
            "error": f"No summary returned. Response keys: {keys}",
            "debug": {
                "provider": "ollama",
                "model": ollama_model,
                "endpoint": f"{ollama_url}/api/chat",
                "hint": "Expected 'message.content' (chat) or 'response' (generate)."
            }
        }), 502

    return jsonify({"summary": summary})

@app.route("/api/ai-summary-stream", methods=["POST"])
def api_ai_summary_stream():
    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question", "")).strip()
    options = payload.get("options", [])
    correct_index = payload.get("correct_index")
    selected_index = payload.get("selected_index")
    explanation = str(payload.get("explanation", "")).strip()

    if not question or not isinstance(options, list) or not options:
        return jsonify({"error": "Invalid question payload."}), 400

    if not isinstance(correct_index, int) or not (0 <= correct_index < len(options)):
        return jsonify({"error": "Invalid correct index."}), 400

    correct_answer = options[correct_index]
    selected_answer = ""
    if isinstance(selected_index, int) and 0 <= selected_index < len(options):
        selected_answer = options[selected_index]

    cfg = load_ai_config()
    ollama_url = str(cfg.get("ollama_url", OLLAMA_URL)).strip().rstrip("/")
    ollama_model = str(cfg.get("ollama_model", OLLAMA_MODEL)).strip()
    system_prompt, user_prompt = build_ai_summary_prompts(
        question=question,
        options=options,
        correct_answer=correct_answer,
        selected_answer=selected_answer,
        explanation=explanation
    )

    try:
        upstream = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "stream": True,
                "options": {
                    "temperature": 0.2,
                    "num_predict": 180,
                    "top_p": 0.9,
                    "repeat_penalty": 1.1
                }
            },
            timeout=OLLAMA_TIMEOUT,
            stream=True
        )
    except requests.RequestException:
        return jsonify({"error": "AI server is unavailable."}), 502

    if upstream.status_code != 200:
        return jsonify({"error": "AI server error."}), 502

    @stream_with_context
    def generate():
        for raw_line in upstream.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            try:
                chunk = json.loads(raw_line)
            except ValueError:
                continue
            if isinstance(chunk, dict) and chunk.get("error"):
                continue
            delta = ""
            if isinstance(chunk, dict):
                msg = chunk.get("message")
                if isinstance(msg, dict):
                    delta = str(msg.get("content", ""))
                if not delta:
                    delta = str(chunk.get("response", ""))
            if delta:
                yield delta

    return Response(generate(), mimetype="text/plain; charset=utf-8")

@app.route("/delete/<int:test_id>")
def delete_test(test_id):
    data = load_data()
    if 0 <= test_id < len(data["tests"]):
        test = data["tests"][test_id]
        for q in test.get("questions", []):
            delete_image_file(q.get("image", ""))
        del data["tests"][test_id]
        save_data(data)
    return redirect(url_for("index"))

# NEW: Export all tests as data.json
@app.route("/export")
def export_tests():
    data = load_data()
    buffer = io.BytesIO()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("data.json", json.dumps(data, indent=4, ensure_ascii=False))

        if os.path.isdir(UPLOAD_FOLDER):
            for filename in os.listdir(UPLOAD_FOLDER):
                src = os.path.join(UPLOAD_FOLDER, filename)
                if os.path.isfile(src):
                    zf.write(src, arcname=f"uploads/{filename}")

    buffer.seek(0)
    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"suvuu_backup_{timestamp}.zip",
        mimetype="application/zip"
    )

@app.route("/import", methods=["POST"])
def import_tests():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "Invalid file"}), 400

    filename_lower = file.filename.lower()
    if not (filename_lower.endswith('.json') or filename_lower.endswith('.zip')):
        return jsonify({"success": False, "error": "Use a .json or .zip backup file"}), 400

    try:
        uploaded_data = None
        image_map = {}

        if filename_lower.endswith('.json'):
            uploaded_data = json.load(file)
        else:
            archive_bytes = file.read()
            with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as zf:
                names = set(zf.namelist())
                if "data.json" not in names:
                    return jsonify({"success": False, "error": "Backup zip missing data.json"}), 400

                uploaded_data = json.loads(zf.read("data.json").decode("utf-8"))

        if not isinstance(uploaded_data, dict) or "tests" not in uploaded_data or not isinstance(uploaded_data["tests"], list):
            return jsonify({"success": False, "error": "Invalid data.json format"}), 400

        current_data = load_data()
        imported_tests = uploaded_data["tests"]

        if filename_lower.endswith(".zip"):
            referenced_images = set()
            for test in imported_tests:
                if not isinstance(test, dict):
                    continue
                questions = test.get("questions", [])
                if not isinstance(questions, list):
                    continue
                for q in questions:
                    if not isinstance(q, dict):
                        continue
                    image_name = str(q.get("image", "")).strip()
                    if image_name:
                        referenced_images.add(image_name)

            with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as zf:
                archive_names = set(zf.namelist())
                restored_images = 0
                missing_images = 0
                for original_name in referenced_images:
                    normalized_name = secure_filename(os.path.basename(original_name))
                    if not normalized_name or not is_allowed_image(normalized_name):
                        image_map[original_name] = ""
                        missing_images += 1
                        continue

                    upload_member = f"uploads/{normalized_name}"
                    if upload_member not in archive_names:
                        image_map[original_name] = ""
                        missing_images += 1
                        continue

                    payload = zf.read(upload_member)
                    target_name = normalized_name
                    target_path = os.path.join(UPLOAD_FOLDER, target_name)

                    if os.path.exists(target_path):
                        try:
                            with open(target_path, "rb") as existing_file:
                                existing_payload = existing_file.read()
                        except OSError:
                            existing_payload = b""
                        if existing_payload != payload:
                            _, ext = os.path.splitext(normalized_name)
                            target_name = f"{uuid4().hex}{ext.lower()}"
                            target_path = os.path.join(UPLOAD_FOLDER, target_name)

                    with open(target_path, "wb") as out:
                        out.write(payload)
                    image_map[original_name] = target_name
                    restored_images += 1

                for test in imported_tests:
                    if not isinstance(test, dict):
                        continue
                    questions = test.get("questions", [])
                    if not isinstance(questions, list):
                        continue
                    for q in questions:
                        if not isinstance(q, dict):
                            continue
                        original_name = str(q.get("image", "")).strip()
                        if not original_name:
                            continue
                        q["image"] = image_map.get(original_name, "")

        # Track existing titles (case-insensitive)
        title_to_index = {}
        for i, t in enumerate(current_data["tests"]):
            title_val = t.get("title")
            if isinstance(title_val, str) and title_val.strip():
                title_to_index[title_val.strip().lower()] = i

        added = 0
        updated = 0
        skipped_invalid = 0

        for test in imported_tests:
            if not isinstance(test, dict) or "title" not in test or "questions" not in test:
                skipped_invalid += 1
                continue

            title_key = test["title"].strip().lower()

            if title_key in title_to_index:
                # UPDATE existing test (same title = newer version)
                current_data["tests"][title_to_index[title_key]] = test
                updated += 1
            else:
                # ADD new test
                current_data["tests"].append(test)
                title_to_index[title_key] = len(current_data["tests"]) - 1
                added += 1

        save_data(current_data)

        message_parts = []
        if added:   message_parts.append(f"added {added} new")
        if updated: message_parts.append(f"updated {updated} existing")
        if skipped_invalid: message_parts.append(f"skipped {skipped_invalid} invalid")
        if filename_lower.endswith(".zip"):
            restored_count = len([v for v in image_map.values() if v])
            missing_count = len([v for v in image_map.values() if not v])
            if restored_count:
                message_parts.append(f"restored {restored_count} images")
            if missing_count:
                message_parts.append(f"missing {missing_count} images")

        if message_parts:
            message = "Import complete: " + ", ".join(message_parts) + "."
        else:
            message = "Import complete: no changes detected."

        return jsonify({
            "success": True,
            "message": message,
            "added": added,
            "updated": updated,
            "total_now": len(current_data["tests"])
        })

    except json.JSONDecodeError:
        return jsonify({"success": False, "error": "Invalid JSON"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": f"Error: {str(e)}"}), 500


@app.route("/results")
@app.route("/results/<token>")
def results_page(token=None):
    return render_template("results.html")

@app.route("/history")
def history_page():
    return render_template("history.html")

@app.route("/api/attempts")
def api_attempts():
    attempts_data = load_attempts()
    attempts = attempts_data.get("attempts", [])
    if not isinstance(attempts, list):
        attempts = []

    try:
        limit = int(request.args.get("limit", "200"))
    except ValueError:
        limit = 200
    limit = max(1, min(limit, 1000))

    items = []
    for attempt in reversed(attempts):
        if not isinstance(attempt, dict):
            continue

        score_raw = attempt.get("score", 0)
        total_raw = attempt.get("total", 0)
        try:
            score = int(score_raw)
        except (TypeError, ValueError):
            score = 0
        try:
            total = int(total_raw)
        except (TypeError, ValueError):
            total = 0
        if score < 0:
            score = 0
        if total < 0:
            total = 0

        percent = round((score / total) * 100, 1) if total > 0 else 0.0
        items.append({
            "id": str(attempt.get("id", "")).strip(),
            "created_at": str(attempt.get("created_at", "")).strip(),
            "test_id": attempt.get("test_id"),
            "test_title": str(attempt.get("test_title", "Untitled Test")),
            "score": score,
            "total": total,
            "percent": percent
        })

        if len(items) >= limit:
            break

    return jsonify({"attempts": items, "total": len(items)})

@app.route("/api/attempts/<token>", methods=["DELETE"])
def api_delete_attempt(token):
    token_str = str(token).strip()
    if not token_str:
        return jsonify({"error": "Attempt id is required."}), 400
    removed = delete_attempt_by_token(token_str)
    if removed <= 0:
        return jsonify({"error": "Attempt not found."}), 404
    return jsonify({"success": True, "deleted": removed})

@app.route("/api/attempts", methods=["DELETE"])
def api_clear_attempts():
    removed = clear_attempts()
    return jsonify({"success": True, "deleted": removed})


@app.route("/api/results/<token>")
def api_results(token):
    payload = RESULT_CACHE.get(token)
    if payload is None:
        payload = get_attempt_by_token(token)
    if payload is None:
        return jsonify({"error": "Results not found"}), 404
    return jsonify(payload)

@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
