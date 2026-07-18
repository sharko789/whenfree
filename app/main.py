import json
import random
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "whenfree.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
STATIC_DIR = Path(__file__).parent / "static"

ID_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no ambiguous 0/O/1/I/L
ID_LENGTH = 8


def gen_id(n: int = ID_LENGTH) -> str:
    return "".join(random.choice(ID_CHARS) for _ in range(n))


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                start_min INTEGER NOT NULL,
                end_min INTEGER NOT NULL,
                dates TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS availability (
                meeting_id TEXT NOT NULL,
                name TEXT NOT NULL,
                cells TEXT NOT NULL,
                password TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (meeting_id, name),
                FOREIGN KEY (meeting_id) REFERENCES meetings(id)
            )
            """
        )
        conn.commit()


# start/end are whole hours only (0-24), stored as minutes-from-midnight
# (0, 60, 120, ... 1440) so the rest of the schema doesn't need to change.
class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_min: int = Field(ge=0, le=1380)
    end_min: int = Field(ge=60, le=1440)
    dates: List[str] = Field(min_length=1)


class AvailabilityIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    cells: List[str] = Field(default_factory=list)
    # Optional, plaintext, not meant to be real security - just enough of a
    # hurdle that someone can't casually overwrite another participant's
    # marks by typing their name. First save under a name "claims" whatever
    # password (or none) it was given; later saves must match.
    password: str = Field(default="", max_length=100)


app = FastAPI(title="WhenFree API")


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health():
    return {"ok": True}


def meeting_payload(conn: sqlite3.Connection, meeting_id: str) -> dict:
    row = conn.execute("SELECT * FROM meetings WHERE id=?", (meeting_id,)).fetchone()
    if not row:
        raise HTTPException(404, "No meeting found with that code.")
    avail_rows = conn.execute(
        "SELECT name, cells FROM availability WHERE meeting_id=? ORDER BY updated_at ASC",
        (meeting_id,),
    ).fetchall()
    availability: Dict[str, List[str]] = {r["name"]: json.loads(r["cells"]) for r in avail_rows}
    return {
        "id": row["id"],
        "title": row["title"],
        "start_min": row["start_min"],
        "end_min": row["end_min"],
        "dates": json.loads(row["dates"]),
        "participants": list(availability.keys()),
        "availability": availability,
    }


@app.post("/api/meetings")
def create_meeting(payload: MeetingCreate):
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Meeting name is required.")
    if payload.end_min <= payload.start_min:
        raise HTTPException(400, "End time must be after start time.")
    if payload.start_min % 60 or payload.end_min % 60:
        raise HTTPException(400, "Start and end times must be whole hours.")

    meeting_id = gen_id()
    with get_conn() as conn:
        while conn.execute("SELECT 1 FROM meetings WHERE id=?", (meeting_id,)).fetchone():
            meeting_id = gen_id()
        conn.execute(
            "INSERT INTO meetings (id, title, start_min, end_min, dates, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                meeting_id,
                title,
                payload.start_min,
                payload.end_min,
                json.dumps(sorted(set(payload.dates))),
                int(time.time()),
            ),
        )
        conn.commit()
    return {"id": meeting_id}


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str):
    meeting_id = meeting_id.strip().upper()
    with get_conn() as conn:
        return meeting_payload(conn, meeting_id)


# POST (not PUT/PATCH) because every save also returns the freshly recomputed
# state of the whole meeting - the caller uses this to update both their own
# grid and the group heatmap in one round trip, without a separate GET.
@app.post("/api/meetings/{meeting_id}/availability")
def set_availability(meeting_id: str, payload: AvailabilityIn):
    meeting_id = meeting_id.strip().upper()
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name is required.")

    password = payload.password.strip()

    with get_conn() as conn:
        meeting = conn.execute("SELECT id FROM meetings WHERE id=?", (meeting_id,)).fetchone()
        if not meeting:
            raise HTTPException(404, "No meeting found with that code.")

        existing = conn.execute(
            "SELECT password FROM availability WHERE meeting_id=? AND name=?",
            (meeting_id, name),
        ).fetchone()
        existing_password = existing["password"] if existing else ""

        if existing_password and password != existing_password:
            raise HTTPException(
                403,
                "That name is password-protected. Enter the matching password to edit it.",
            )
        # If there was no password set yet, whatever was sent this time
        # (including none) becomes the protection going forward.
        effective_password = existing_password or password

        conn.execute(
            """
            INSERT INTO availability (meeting_id, name, cells, password, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id, name)
            DO UPDATE SET cells = excluded.cells, password = excluded.password, updated_at = excluded.updated_at
            """,
            (meeting_id, name, json.dumps(payload.cells), effective_password, int(time.time())),
        )
        conn.commit()
        return meeting_payload(conn, meeting_id)


# Client-side route: serve the meeting page shell for direct links so
# /meeting/AB3XQK9P lands on the page instead of a 404.
@app.get("/meeting/{meeting_id}")
def meeting_page(meeting_id: str):
    return FileResponse(STATIC_DIR / "meeting.html")


# Static frontend last, so it doesn't shadow the routes above.
# StaticFiles(html=True) serves static/index.html for "/", which is now the
# meeting-creation page.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
