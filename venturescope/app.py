import os
import re
import sys
import logging
import sqlite3
import hashlib
import hmac
import time
from datetime import datetime, timezone
from functools import wraps

import requests
from flask import Flask, request, jsonify, render_template, session, g

# ─── Startup environment validation ───────────────────────────────────────────
REQUIRED_WARNINGS = []
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    SECRET_KEY = os.urandom(24)
    REQUIRED_WARNINGS.append("SECRET_KEY not set — using random key (sessions reset on restart).")

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not OPENROUTER_API_KEY:
    REQUIRED_WARNINGS.append("OPENROUTER_API_KEY not set — AI summaries will use rule-based fallback.")

# ─── App setup ────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Set Secure=True in production behind HTTPS
# app.config["SESSION_COOKIE_SECURE"] = True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

for w in REQUIRED_WARNINGS:
    logger.warning(w)

# ─── Database ─────────────────────────────────────────────────────────────────
DB_PATH = os.environ.get("DB_PATH", "/tmp/venturescope.db")

def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
    return db

@app.teardown_appcontext
def close_db(exc):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT    UNIQUE NOT NULL,
                password_hash TEXT  NOT NULL,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS analyses (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                -- inputs
                funding     REAL, team_size REAL, revenue REAL,
                burn_rate   REAL, growth_rate REAL,
                -- outputs
                score       REAL, risk REAL, runway REAL,
                stage       TEXT, failure_risk REAL,
                decision    TEXT, investment_action TEXT,
                future_score REAL, future_outlook TEXT,
                summary     TEXT,
                raw_json    TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
            CREATE INDEX IF NOT EXISTS idx_analyses_date ON analyses(created_at);

            CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT    NOT NULL,
                window_start INTEGER NOT NULL,
                count       INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (key, window_start)
            );
        """)
        db.commit()

        # Seed default users from env (or defaults)
        _seed_users(db)

def _hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"{salt}${h.hex()}"

def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$", 1)
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
        return hmac.compare_digest(expected.hex(), h)
    except Exception:
        return False

def _seed_users(db):
    users = [
        (os.environ.get("APP_USERNAME", "admin"),
         os.environ.get("APP_PASSWORD", "venture2024")),
    ]
    extra = os.environ.get("EXTRA_USERS", "")
    for pair in extra.split(","):
        pair = pair.strip()
        if ":" in pair:
            u, p = pair.split(":", 1)
            users.append((u.strip(), p.strip()))

    for username, password in users:
        existing = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if not existing:
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, _hash_password(password))
            )
    db.commit()

# ─── Rate limiting ─────────────────────────────────────────────────────────────
RATE_LIMITS = {
    "login":   (10, 60),    # 10 attempts per 60s per IP
    "predict": (30, 60),    # 30 predictions per 60s per user
}

def check_rate_limit(key: str, limit: int, window: int) -> bool:
    """Returns True if allowed, False if rate-limited."""
    db  = get_db()
    now = int(time.time())
    win = now - (now % window)
    row = db.execute(
        "SELECT count FROM rate_limits WHERE key=? AND window_start=?", (key, win)
    ).fetchone()
    if row is None:
        db.execute(
            "INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)", (key, win)
        )
        db.commit()
        return True
    if row["count"] >= limit:
        return False
    db.execute(
        "UPDATE rate_limits SET count=count+1 WHERE key=? AND window_start=?", (key, win)
    )
    db.commit()
    return True

def rate_limit(limit_type: str):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            lim, win = RATE_LIMITS.get(limit_type, (60, 60))
            key_id = session.get("user_id") or request.remote_addr
            key = f"{limit_type}:{key_id}"
            if not check_rate_limit(key, lim, win):
                return jsonify({"error": "Too many requests. Please slow down."}), 429
            return f(*args, **kwargs)
        return wrapped
    return decorator

# ─── Auth helpers ──────────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/login", methods=["POST"])
@rate_limit("login")
def login():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    db   = get_db()
    user = db.execute(
        "SELECT id, username, password_hash FROM users WHERE username=?", (username,)
    ).fetchone()

    if not user or not _verify_password(password, user["password_hash"]):
        logger.warning(f"Failed login attempt for username='{username}' from {request.remote_addr}")
        return jsonify({"error": "Invalid credentials"}), 401

    session.clear()
    session["logged_in"] = True
    session["user_id"]   = user["id"]
    session["username"]  = user["username"]
    logger.info(f"User '{username}' logged in from {request.remote_addr}")
    return jsonify({"success": True, "username": user["username"]})


@app.route("/logout", methods=["POST"])
def logout():
    username = session.get("username", "unknown")
    session.clear()
    logger.info(f"User '{username}' logged out")
    return jsonify({"success": True})


@app.route("/me")
@login_required
def me():
    return jsonify({
        "username": session.get("username"),
        "user_id":  session.get("user_id"),
    })


# ─── History ───────────────────────────────────────────────────────────────────
@app.route("/history")
@login_required
def history():
    db   = get_db()
    rows = db.execute(
        """SELECT id, created_at, funding, team_size, revenue, burn_rate, growth_rate,
                  score, risk, runway, stage, decision, investment_action, future_score
           FROM analyses
           WHERE user_id=?
           ORDER BY created_at DESC
           LIMIT 50""",
        (session["user_id"],)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/history/<int:analysis_id>")
@login_required
def history_detail(analysis_id):
    db  = get_db()
    row = db.execute(
        "SELECT * FROM analyses WHERE id=? AND user_id=?",
        (analysis_id, session["user_id"])
    ).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    import json
    data = dict(row)
    if data.get("raw_json"):
        data["full"] = json.loads(data["raw_json"])
    return jsonify(data)


@app.route("/history/<int:analysis_id>", methods=["DELETE"])
@login_required
def delete_analysis(analysis_id):
    db = get_db()
    db.execute(
        "DELETE FROM analyses WHERE id=? AND user_id=?",
        (analysis_id, session["user_id"])
    )
    db.commit()
    return jsonify({"success": True})


# ─── AI Summary ───────────────────────────────────────────────────────────────
def generate_ai_summary(score, revenue, burn, growth, stage, risk, runway, funding, team):
    if not OPENROUTER_API_KEY:
        return generate_fallback_summary(score, revenue, burn, growth)
    try:
        prompt = f"""You are a senior VC analyst at a top-tier fund. Analyze this startup and write a concise 3-sentence investment analysis.

Startup Data:
- Funding: ${funding:,.0f}
- Team Size: {team:.0f} people
- Monthly Revenue: ${revenue:,.0f}
- Monthly Burn Rate: ${burn:,.0f}
- Growth Rate: {growth}%/month
- Composite Score: {score}/100
- Risk Level: {risk}%
- Stage: {stage}
- Runway: {runway} months

Write exactly 3 sentences:
1. Key strengths and competitive advantages based on the data
2. Primary risks and concerns that could derail success
3. Specific, actionable recommendation for investors

Be data-driven, direct, and specific. No generic statements. No fluff."""

        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
            json={"model": "mistralai/mistral-7b-instruct",
                  "messages": [{"role": "user", "content": prompt}],
                  "max_tokens": 300},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except requests.exceptions.Timeout:
        logger.error("OpenRouter timeout")
    except requests.exceptions.RequestException as e:
        logger.error(f"OpenRouter request failed: {e}")
    except (KeyError, IndexError) as e:
        logger.error(f"OpenRouter parse error: {e}")
    return generate_fallback_summary(score, revenue, burn, growth)


def generate_fallback_summary(score, revenue, burn, growth):
    if score >= 85:
        return ("Exceptional execution with strong revenue efficiency and scalable growth signals across all key metrics. "
                "Primary watch item is maintaining burn discipline as the team scales to meet demand. "
                "This represents a high-conviction investment opportunity — allocate at current valuation before next round pricing.")
    elif score >= 70:
        if burn > revenue * 1.5:
            return ("Strong revenue signals are undermined by a burn rate exceeding monthly revenue by over 50%, creating dangerous cash-flow pressure. "
                    "The business faces imminent liquidity risk within the current runway window without corrective action. "
                    "Condition any investment on a credible 90-day plan to bring burn below 1.2× revenue before deploying capital.")
        return ("Solid revenue-to-burn efficiency indicates genuine product-market fit with a defensible growth trajectory. "
                "Sustainability depends on maintaining current unit economics as the company scales headcount and marketing spend. "
                "A watchful investment with milestone-based tranches is appropriate — revisit in 60–90 days for full commitment.")
    elif score >= 50:
        return ("Moderate traction exists but metrics show inconsistency across revenue, burn, and growth efficiency. "
                "Without structural improvements to the monetization model, current burn levels are unsustainable past the existing runway. "
                "Pass for now and revisit if the team can demonstrate 3 consecutive months of improving unit economics.")
    return ("Weak execution signals across the board with excessive dependency on external capital to fund operations. "
            "Revenue generation is critically insufficient relative to burn rate, indicating a broken or unvalidated business model. "
            "Do not invest at current stage — recommend a full strategic pivot or wind-down assessment within 30 days.")


# ─── Predict ──────────────────────────────────────────────────────────────────
@app.route("/predict", methods=["POST"])
@login_required
@rate_limit("predict")
def predict():
    import json as _json
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON body"}), 400

        for field in ["funding", "team_size", "revenue", "burn_rate", "growth_rate"]:
            if field not in data:
                return jsonify({"error": f"Missing field: {field}"}), 400

        try:
            funding = float(data["funding"])
            team    = float(data["team_size"])
            revenue = float(data["revenue"])
            burn    = float(data["burn_rate"])
            growth  = float(data["growth_rate"])
        except (ValueError, TypeError):
            return jsonify({"error": "All fields must be numeric"}), 400

        if any(v < 0 for v in [funding, team, revenue, burn]):
            return jsonify({"error": "Values cannot be negative"}), 400
        if not (-100 <= growth <= 1000):
            return jsonify({"error": "Growth rate must be between -100 and 1000"}), 400
        if team > 100_000:
            return jsonify({"error": "Team size seems unrealistic"}), 400

        # Scoring
        revenue_ratio = revenue / max(funding, 1)
        burn_ratio    = burn / max(revenue, 1)
        revenue_score = min(revenue_ratio * 60, 100)
        growth_score  = min(growth * 1.2, 100)
        burn_score    = max(0, 100 - burn_ratio * 80)
        team_score    = min(team * 7, 100)
        score = round(min((revenue_score*0.30 + growth_score*0.25 + burn_score*0.25 + team_score*0.20), 100), 2)

        # Risk
        cash_risk   = min((burn / max(revenue, 1)) * 50, 100)
        growth_risk = max(0, 50 - growth)
        burn_risk   = min((burn / max(funding, 1)) * 50, 100)
        risk = round(min(max((cash_risk + growth_risk + burn_risk) / 3 * 2, 5), 95), 2)

        runway       = round(min(funding / max(burn, 1), 120), 1)
        failure_risk = round(min(risk * 0.8 + (100 - min(growth, 100)) * 0.2, 95), 2)

        stage = ("Idea Stage"    if revenue < 1_000  else
                 "Early Stage"   if revenue < 20_000 else
                 "Growth Stage"  if revenue < 100_000 else
                 "Scaling Stage")

        if score >= 85 and risk < 25:
            decision, emoji = "Strong Investment", "🔥"
        elif score >= 70:
            decision, emoji = "Good Startup", "🟢"
        elif score >= 50:
            decision, emoji = "Watchlist", "🟡"
        else:
            decision, emoji = "High Risk", "🔴"

        if score >= 80 and risk < 25:
            action = "INVEST"
        elif score >= 65:
            action = "WAIT"
        elif risk >= 70 or score < 40:
            action = "REJECT"
        else:
            action = "EMERGENCY FUNDING"

        future_score   = round(max(0, min(score + (growth*0.3) - (risk*0.2), 100)), 2)
        future_outlook = ("Strong scaling expected" if future_score > 80
                          else "Stable growth likely" if future_score > 60
                          else "High risk of slowdown")

        score_breakdown = [
            {"factor": "Revenue Strength", "impact": round(revenue_score, 2)},
            {"factor": "Growth Potential",  "impact": round(growth_score, 2)},
            {"factor": "Burn Efficiency",   "impact": round(burn_score, 2)},
            {"factor": "Team Capability",   "impact": round(team_score, 2)},
        ]
        risk_breakdown = {
            "cash_risk":   round(min(cash_risk, 100), 2),
            "growth_risk": round(min(growth_risk, 100), 2),
            "burn_risk":   round(min(burn_risk, 100), 2),
        }

        summary = generate_ai_summary(score, revenue, burn, growth, stage, risk, runway, funding, team)

        result = {
            "score": score, "risk": risk, "runway": runway,
            "stage": stage, "failure_risk": failure_risk,
            "decision": decision, "decision_emoji": emoji,
            "summary": summary, "score_breakdown": score_breakdown,
            "investment_action": action,
            "future_score": future_score, "future_outlook": future_outlook,
            "risk_breakdown": risk_breakdown,
        }

        # Persist to history
        db = get_db()
        db.execute(
            """INSERT INTO analyses
               (user_id, funding, team_size, revenue, burn_rate, growth_rate,
                score, risk, runway, stage, failure_risk, decision, investment_action,
                future_score, future_outlook, summary, raw_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (session["user_id"], funding, team, revenue, burn, growth,
             score, risk, runway, stage, failure_risk, decision, action,
             future_score, future_outlook, summary, _json.dumps(result))
        )
        db.commit()

        return jsonify(result)

    except Exception as e:
        logger.error(f"Predict error: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


# ─── Init & run ───────────────────────────────────────────────────────────────
init_db()

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    logger.info("VentureScope starting up...")
    logger.info(f"Database: {DB_PATH}")
    logger.info(f"Debug mode: {debug}")
    app.run(debug=debug, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
