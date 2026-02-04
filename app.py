from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify, send_from_directory # type: ignore
from werkzeug.utils import secure_filename
import json
import os
import io
from uuid import uuid4
import requests

app = Flask(__name__)

DATA_FOLDER = "data"
os.makedirs(DATA_FOLDER, exist_ok=True)
UPLOAD_FOLDER = os.path.join(DATA_FOLDER, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

DATA_FILE = os.path.join(DATA_FOLDER, "data.json")
RESULT_CACHE = {}
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "30"))
AI_CONFIG_FILE = os.path.join(DATA_FOLDER, "ai_config.json")


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
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"tests": []}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

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

        result_payload = {
            "test_title": test["title"],
            "score": correct_count,
            "total": len(test["questions"]),
            "answers": user_answers
        }

        token = str(uuid4())
        RESULT_CACHE[token] = result_payload
        # Basic cleanup to prevent unlimited growth
        while len(RESULT_CACHE) > 50:
            oldest_key = next(iter(RESULT_CACHE))
            RESULT_CACHE.pop(oldest_key, None)
        return redirect(url_for("results_page", token=token))

    return render_template("test_taker.html", test=test, test_id=test_id)


@app.route("/api/tests", methods=["GET"])
def api_list_tests():
    data = load_data()
    tests = [
        {
            "id": idx,
            "title": test.get("title", "Untitled"),
            "question_count": len(test.get("questions", []))
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
    include_raw = bool(payload.get("include_raw", False))

    if not question or not isinstance(options, list) or not options:
        return jsonify({"error": "Invalid question payload."}), 400

    if not isinstance(correct_index, int) or not (0 <= correct_index < len(options)):
        return jsonify({"error": "Invalid correct index."}), 400

    correct_answer = options[correct_index]
    selected_answer = ""
    if isinstance(selected_index, int) and 0 <= selected_index < len(options):
        selected_answer = options[selected_index]

    option_lines = "\n".join([f"{idx + 1}. {opt}" for idx, opt in enumerate(options)])
    cfg = load_ai_config()
    ollama_url = str(cfg.get("ollama_url", OLLAMA_URL)).strip().rstrip("/")
    ollama_model = str(cfg.get("ollama_model", OLLAMA_MODEL)).strip()

    system_prompt = (
        "You are a precise tutor. Write a brief explanation (2-4 sentences) that connects the question to the correct answer. "
        "Use at least one specific clue or phrase from the question or options. "
        "If the student chose incorrectly, add one short contrast about why the correct answer fits better. "
        "Do not mention being an AI, do not use markdown, and do not say 'it's correct because it is correct'."
    )
    user_prompt = (
        f"Question:\n{question}\n\nOptions:\n{option_lines}\n\n"
        f"Correct answer:\n{correct_answer}\n\n"
        f"Student selected:\n{selected_answer or 'No selection'}\n\n"
        f"Provided explanation:\n{explanation or 'None'}"
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

@app.route("/delete/<int:test_id>")
def delete_test(test_id):
    data = load_data()
    if 0 <= test_id < len(data["tests"]):
        del data["tests"][test_id]
        save_data(data)
    return redirect(url_for("index"))

# NEW: Export all tests as data.json
@app.route("/export")
def export_tests():
    data = load_data()
    buffer = io.BytesIO()
    buffer.write(json.dumps(data, indent=4, ensure_ascii=False).encode('utf-8'))
    buffer.seek(0)
    return send_file(
        buffer,
        as_attachment=True,
        download_name="data.json",
        mimetype="application/json"
    )

@app.route("/import", methods=["POST"])
def import_tests():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '' or not file.filename.lower().endswith('.json'):
        return jsonify({"success": False, "error": "Invalid file"}), 400

    try:
        uploaded_data = json.load(file)
        
        if not isinstance(uploaded_data, dict) or "tests" not in uploaded_data or not isinstance(uploaded_data["tests"], list):
            return jsonify({"success": False, "error": "Invalid data.json format"}), 400

        current_data = load_data()
        imported_tests = uploaded_data["tests"]

        # Track existing titles (case-insensitive)
        title_to_index = {t["title"].strip().lower(): i for i, t in enumerate(current_data["tests"])}

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

        message = "Import complete: " + ", ".join(message_parts).capitalize() + " test(s)."

        return jsonify({
            "success": True,
            "message": message.strip(".") + ".",
            "added": added,
            "updated": updated,
            "total_now": len(current_data["tests"])
        })

    except json.JSONDecodeError:
        return jsonify({"success": False, "error": "Invalid JSON"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": f"Error: {str(e)}"}), 5000


@app.route("/results")
@app.route("/results/<token>")
def results_page(token=None):
    return render_template("results.html")


@app.route("/api/results/<token>")
def api_results(token):
    payload = RESULT_CACHE.get(token)
    if payload is None:
        return jsonify({"error": "Results not found"}), 404
    return jsonify(payload)

@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
