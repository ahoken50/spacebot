#!/usr/bin/env python3
"""Zero-Cold-Start Python Worker Daemon for OASIS-V2 (Chantier 18).

Pre-loads heavy geospatial and spreadsheet processing libraries in memory
and executes JSON calculation payloads via standard I/O in < 100ms.
"""
from __future__ import annotations

import json
import math
import os
import sys
import traceback
from datetime import datetime, UTC
from pathlib import Path

# Preload heavy modules in process memory at startup
try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    import shapely
    import shapely.geometry
except ImportError:
    shapely = None


def execute_task_payload(payload: dict) -> dict:
    action = payload.get("action", "ping")
    if action == "ping":
        return {
            "status": "ready",
            "openpyxl_loaded": openpyxl is not None,
            "shapely_loaded": shapely is not None,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    if action == "inspect_geojson":
        geojson_path = payload.get("path")
        if not geojson_path or not Path(geojson_path).is_file():
            return {"status": "error", "message": f"Fichier introuvable : {geojson_path}"}
        data = json.loads(Path(geojson_path).read_text(encoding="utf-8"))
        features = data.get("features", [])
        return {
            "status": "ok",
            "feature_count": len(features),
            "types": list(set(f.get("geometry", {}).get("type") for f in features if f.get("geometry"))),
        }

    if action == "calc_kml_polygon_surface":
        coords = payload.get("coordinates", [])
        if not coords or len(coords) < 3 or not shapely:
            return {"status": "error", "message": "Coordonnées insuffisantes ou shapely indisponible"}
        poly = shapely.geometry.Polygon(coords)
        return {
            "status": "ok",
            "area_sq_meters": poly.area,
            "area_hectares": poly.area / 10000.0,
        }

    return {"status": "error", "message": f"Action inconnue : {action}"}


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        result = execute_task_payload({"action": "ping"})
        print(json.dumps(result, indent=2))
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            result = execute_task_payload(payload)
        except Exception as err:
            result = {"status": "error", "error": str(err), "traceback": traceback.format_exc()}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
