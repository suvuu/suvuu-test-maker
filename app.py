from flask import Flask, render_template, request, redirect, url_for, send_file, jsonify # type: ignore
import json
import os
import io
from uuid import uuid4

app = Flask(__name__)

DATA_FOLDER = "data"
os.makedirs(DATA_FOLDER, exist_ok=True)

DATA_FILE = os.path.join(DATA_FOLDER, "data.json")
RESULT_CACHE = {}


def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"tests": []}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

def parse_test_form(form):
    title = form.get('title', '').strip()
    questions = []
    idx = 0

    while True:
        q = form.get(f'question_{idx}')
        if q is None:
            break

        q = q.strip()
        if not q:
            idx += 1
            continue

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

        questions.append({
            "question": q,
            "options": opts,
            "correct_index": correct,
            "explanation": explanation
        })

        idx += 1

    return {
        "title": title,
        "questions": questions
    }


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/new", methods=["GET", "POST"])
def new_test():
    if request.method == "POST":
        data = load_data()
        test = parse_test_form(request.form)
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
        test = parse_test_form(request.form)
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
                "explanation": q.get("explanation", "")
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

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
