#!/usr/bin/env python3
"""Register the OASIS SkillOpt environment in the pinned upstream source tree."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("SKILLOPT_ROOT", "/opt/skillopt"))
SNIPPET = """    try:
        from skillopt.envs.oasis.adapter import OasisSkillAdapter
        _ENV_REGISTRY[\"oasis\"] = OasisSkillAdapter
    except ImportError:
        pass
\n"""


def patch(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if 'skillopt.envs.oasis.adapter' in text:
        return
    anchor = 'def get_adapter(cfg: dict):'
    if anchor not in text:
        raise RuntimeError(f"Point d’enregistrement SkillOpt absent : {path}")
    path.write_text(text.replace(anchor, SNIPPET + anchor, 1), encoding="utf-8")


for relative_path in ("scripts/train.py", "scripts/eval_only.py"):
    patch(ROOT / relative_path)
