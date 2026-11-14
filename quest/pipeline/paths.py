"""Shared locations for the pipeline scripts.

Works both inside the naba repo (quest/pipeline -> quest/unity, frontend/public/data)
and in the original local layout (D:/Nasa/pipeline -> D:/Nasa/Nasa Game, D:/Web Nasa/naba/frontend/public/data).
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _unity_project():
    for name in ("unity", "Nasa Game"):
        p = HERE.parent / name
        if (p / "Assets").exists():
            return p
    return HERE.parent / "unity"


def _web_data():
    for p in (HERE.parent.parent / "frontend" / "public" / "data", Path("D:/Web Nasa/naba/frontend/public/data")):
        if p.exists():
            return p
    return HERE.parent.parent / "frontend" / "public" / "data"


UNITY = _unity_project()
RESOURCES = UNITY / "Assets" / "Globe" / "Resources"
WEB_DATA = _web_data()
