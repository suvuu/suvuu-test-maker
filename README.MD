# **Suvuu’s Test Maker — Self-Hosted Quiz & Study Tool (Desktop + Mobile)**

A lightweight, offline web app for creating, taking, and managing multiple-choice quizzes.
Runs entirely on your machine. Perfect for students, exam prep, or anyone who wants a simple but effective local study tool.

Built to be **fast**, **minimal**, and **noob-friendly**.

---

## Features

* **Unlimited tests** – Add as many questions as you want
* **Clean test editor** – Collapsible questions, dynamic answer options, explanations included
* **Randomization** – Questions and answers shuffle automatically when taking a test
* **Instant feedback** – See correct answers + explanations immediately
* **Import / Export support** – All tests stored in a simple `data.json` file
* **Fully offline** – No external server, no cloud
* **Docker support** – Spin it up in seconds on any system
* **Zero database needed** – Entire app runs off one JSON file
* **Desktop & mobile friendly** – Works great on phones, tablets, and laptops

---

# Quick Start (No Docker Needed)

```bash
# 1. Clone the repo
git clone https://github.com/suvuu/suvuu-test-maker.git
cd suvuu-test-maker

# 2. Create a virtual environment (recommended)
python3 -m venv venv       # Windows: if command fails, install python by running 'python3'
source venv/bin/activate   # Windows: venv\Scripts\activate

# 3. Install Flask
pip install flask

# 4. Run the app
python app.py
```

Open **[http://localhost:5000](http://localhost:5000)** in your browser. (or the ip of the device the app is running on followed by port 5000)

On first launch you’ll see an empty list — click **New Test** to create your first quiz.

---

# Docker (Recommended for Easy Deployment)


```bash
git clone https://github.com/suvuu/suvuu-test-maker.git
cd suvuu-test-maker
```
```bash
docker-compose up -d --build
```
Open **[http://localhost:5000](http://localhost:5000)** in your browser. (or the ip of the device the app is running on followed by port 5000)

All tests persist in the `./data` folder in the container.


---

# Project Structure

```bash
suvuu-test-maker/
│
├── app.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── README.md
│
├── data/
│   └── data.json 
│
├── static/
│   └── test.js
│
└── templates/
    ├── index.html
    ├── results.html
    ├── test_editor.html
    └── test_taker.html
```

---

# Importing & Exporting Tests

## Export

Click **“Export All Tests (data.json)”** on the homepage
→ Saves all your quizzes into one file
→ Great for backups

## Import

Click **“Import Tests”** and select a `data.json` file
→ This will **replace** your current tests (useful for syncing or restoring)

---

# Deploy Anywhere

Because it’s lightweight and self-contained, you can deploy it on:

* A laptop or desktop
* A server

Your data never leaves your machine.

---

# Why This Exists

Made to help students and/or anyone studying to create simple practice exams.
Everything is local, private, and easy to modify, perfect for learning.
