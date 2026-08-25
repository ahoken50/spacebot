"""Data loader for OASIS approved, redacted SkillOpt reference cases."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from skillopt.datasets.base import SplitDataLoader


class OasisSkillDataLoader(SplitDataLoader):
    """Load one JSON list from each train/val/test partition."""

    def load_split_items(self, split_path: str) -> list[dict[str, Any]]:
        files = sorted(Path(split_path).glob("*.json"))
        if len(files) != 1:
            raise ValueError(f"Le répertoire {split_path} doit contenir exactement un fichier JSON de cas OASIS.")
        payload = json.loads(files[0].read_text(encoding="utf-8"))
        if not isinstance(payload, list) or not payload:
            raise ValueError(f"La partition {split_path} doit contenir une liste non vide de cas.")
        items: list[dict[str, Any]] = []
        for raw in payload:
            if not isinstance(raw, dict):
                raise ValueError("Chaque cas SkillOpt doit être un objet JSON.")
            for field in ("id", "task_input", "expected"):
                if not raw.get(field):
                    raise ValueError(f"Le cas {raw.get('id', '<sans id>')} doit contenir {field}.")
            items.append(
                {
                    "id": str(raw["id"]),
                    "task_input": str(raw["task_input"]),
                    "expected": raw["expected"],
                    "task_type": str(raw.get("task_type") or "oasis_skill"),
                }
            )
        return items
