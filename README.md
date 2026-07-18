# WhenFree

A When2Meet-style scheduling tool: create a meeting with a set of dates and
an hour range, share the link, and everyone marks when they're free. Your
own grid and the group's combined availability are both visible on the same
page, updating as people add themselves.

## Stack

- **Backend:** FastAPI (`app/main.py`), SQLite for storage (`data/whenfree.db`)
- **Frontend:** static HTML/CSS/JS served directly by FastAPI (`app/static/`)
  - `index.html` / `js/index.js` — the landing page, which is the meeting-creation form
  - `meeting.html` / `js/meeting.js` — a meeting's page: your editable availability grid + the group heatmap
  - `js/common.js` — shared helpers (API client, date/grid math, the drag-select behavior)
- **Persistence:** SQLite file on a mounted Docker volume, so data survives
  container restarts/rebuilds

## Run it with Docker

```bash
docker compose up --build
```

Then open **http://localhost:8000**.

The SQLite database lives at `./data/whenfree.db` on the host (mounted into
the container), so `docker compose down` / `up` again won't lose any meetings.

## Run it with uv (dev)

```bash
uv run uvicorn app.main:app --reload
```

## API

- `POST /api/meetings` — create a meeting `{title, start_min, end_min, dates: [ISO dates]}` → `{id}`. `start_min`/`end_min` are minutes since midnight and must be whole hours (e.g. `9:00` = `540`).
- `GET /api/meetings/{id}` — fetch a meeting: title, hours, dates, participants, and everyone's availability
- `POST /api/meetings/{id}/availability` — upsert one person's availability `{name, password, cells: ["YYYY-MM-DD_<minutesFromMidnight>", ...]}` (15-minute increments) and get back the full, freshly-recomputed meeting state in the same response — the frontend uses this to update both the editable grid and the group heatmap without a second request. `password` is optional and plaintext - it's a light deterrent against someone else overwriting your marks by typing your name, not real security. The first save under a name claims whatever password (or none) it was given; later saves for that name must match, or the request is rejected with 403.
- `GET /meeting/{id}` — serves the meeting page shell so shared links land directly on it

The meeting code is an 8-character ID; shared links look like
`https://your-host/meeting/QK9PXR3H`.
