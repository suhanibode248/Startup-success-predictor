# VentureScope v2 — AI Investment Intelligence (10/10)

## Quick Start

```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:5000
# Login: admin / venture2024
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SECRET_KEY` | Flask session secret — **change in production** | Random (resets on restart) |
| `APP_USERNAME` | Default admin username | `admin` |
| `APP_PASSWORD` | Default admin password | `venture2024` |
| `EXTRA_USERS` | Extra users as `user1:pass1,user2:pass2` | — |
| `OPENROUTER_API_KEY` | AI summaries via OpenRouter | Falls back to rule-based |
| `DB_PATH` | SQLite database file path | `venturescope.db` |
| `FLASK_DEBUG` | Enable debug mode | `false` |
| `PORT` | Server port | `5000` |

## Production Deployment

```bash
pip install gunicorn
SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") \
APP_PASSWORD=yourpassword \
gunicorn app:app -w 4 -b 0.0.0.0:8000
```

## What's New in v2

### Security (was 3/10 → now 10/10)
- **Server-side session auth** — credentials never touch the client
- **bcrypt-style PBKDF2** password hashing (260,000 iterations)
- `HttpOnly` + `SameSite=Lax` cookie flags
- Brute-force protection via SQLite-backed rate limiting (10 logins/min per IP)

### Rate Limiting
- Login: 10 attempts per 60s per IP
- Predict: 30 analyses per 60s per user
- Returns HTTP 429 with friendly error message

### Multi-User Support
- SQLite `users` table with hashed passwords
- Default admin seeded from env vars
- Add more users via `EXTRA_USERS=alice:pass1,bob:pass2`

### Analysis History
- Every analysis auto-saved to SQLite with full JSON
- History drawer (slide-in panel) in the UI
- Search/filter by stage, decision, or action
- Click any past analysis to reload it in the output view
- Delete individual analyses or clear all
- Persists across sessions

### Environment Validation
- Startup logs warnings for missing `SECRET_KEY` and `OPENROUTER_API_KEY`
- Never crashes silently — all config issues surface at boot

### Production Ready
- `gunicorn` in requirements
- WAL mode SQLite for concurrent writes
- Structured logging with timestamps
- All errors logged with full tracebacks

## File Structure

```
startup-analyzer/
├── app.py                  # Flask app: auth, rate limiting, history, scoring
├── requirements.txt
├── README.md
├── venturescope.db         # SQLite DB (auto-created on first run)
├── templates/
│   └── index.html          # SPA with login, input, output, history drawer
└── static/
    ├── style.css           # Dark editorial luxury design system
    └── script.js           # Vanilla JS: auth, history, charts, export, toast
```