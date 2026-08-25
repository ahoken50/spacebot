#!/usr/bin/env python3
"""Run validation-gated SkillOpt learning cycles for approved OASIS skills."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

WORKSPACE = Path(os.environ.get("OASIS_WORKSPACE", "/data/shared-workspace"))
SKILL_CATALOG = Path(os.environ.get("OASIS_SKILLOPT_SKILL_CATALOG", "/skill-catalog"))
ROOT = WORKSPACE / "00_systeme" / "optimisation" / "skillopt"
PACK_FILE = Path(os.environ.get("OASIS_SKILLOPT_REFERENCE_PACK_PATH", ROOT / "skillopt_reference_pack.approved.json"))
ALLOW_AUTONOMOUS_PACKS = os.environ.get("OASIS_SKILLOPT_ALLOW_AUTONOMOUS_PACKS", "false").strip().lower() in {"1", "true", "yes", "on"}
PROPOSALS_DIR = ROOT / "propositions"
RUNS_DIR = ROOT / "runs"
STATE_FILE = ROOT / "autonomy_state.json"
SKILLOPT_ROOT = Path("/opt/skillopt")
TRAIN_SCRIPT = SKILLOPT_ROOT / "scripts" / "train.py"

ENABLED = os.environ.get("OASIS_SKILLOPT_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
AUTONOMOUS_ENABLED = os.environ.get("OASIS_SKILLOPT_AUTONOMOUS_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
MAX_TRAIN_CASES = int(os.environ.get("OASIS_SKILLOPT_MAX_TRAIN_CASES", "2"))
MAX_VALIDATION_CASES = int(os.environ.get("OASIS_SKILLOPT_MAX_VALIDATION_CASES", "2"))
MAX_HOLDOUT_CASES = int(os.environ.get("OASIS_SKILLOPT_MAX_HOLDOUT_CASES", "2"))
MAX_EPOCHS = int(os.environ.get("OASIS_SKILLOPT_MAX_EPOCHS", "1"))
MAX_STEPS = int(os.environ.get("OASIS_SKILLOPT_MAX_STEPS", "1"))
MAX_COMPLETION_TOKENS = int(os.environ.get("OASIS_SKILLOPT_MAX_COMPLETION_TOKENS", "650"))
MAX_RUNS_PER_DAY = int(os.environ.get("OASIS_SKILLOPT_MAX_RUNS_PER_DAY", "1"))
TIMEOUT_SECONDS = int(os.environ.get("OASIS_SKILLOPT_TIMEOUT_SECONDS", "600"))
OPTIMIZER_MODEL = os.environ.get("OASIS_SKILLOPT_OPTIMIZER_MODEL", "qwen/qwen3.7-flash")
TARGET_MODEL = os.environ.get("OASIS_SKILLOPT_TARGET_MODEL", "qwen/qwen3.7-flash")

# Les compétences communes et les compétences d’optimisation ne sont jamais des cibles auto-évolutives.
ALLOWED_SKILLS = {
    "oasis-coordination",
    "oasis-financial-control",
    "oasis-schedule-governance",
    "oasis-pse-sig",
    "oasis-reporting",
    "oasis-governance",
    "oasis-document-studio",
}


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    if not path.is_file():
        return fallback or {}
    return json.loads(path.read_text(encoding="utf-8"))


def current_day() -> str:
    return datetime.now(UTC).date().isoformat()


def case_ids(cases: list[dict[str, Any]]) -> set[str]:
    return {str(case["id"]) for case in cases}


def validate_cases(cases: Any, label: str, maximum: int) -> list[dict[str, Any]]:
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"La partition {label} doit contenir au moins un cas.")
    if len(cases) > maximum:
        raise ValueError(f"La partition {label} contient {len(cases)} cas; limite configurée : {maximum}.")
    normalized: list[dict[str, Any]] = []
    for raw in cases:
        if not isinstance(raw, dict):
            raise ValueError(f"La partition {label} contient un cas non structuré.")
        for field in ("id", "task_input", "expected"):
            if not raw.get(field):
                raise ValueError(f"Le cas {raw.get('id', '<sans id>')} de {label} doit contenir {field}.")
        expected = raw["expected"]
        if not isinstance(expected, dict):
            raise ValueError(f"Le champ expected du cas {raw['id']} doit être un objet.")
        if len(str(raw["task_input"])) > 4000:
            raise ValueError(f"Le cas {raw['id']} dépasse 4 000 caractères; conserver un exemple concis et dépersonnalisé.")
        if int(expected.get("max_chars", 5000)) > 6000:
            raise ValueError(f"Le cas {raw['id']} autorise une sortie trop longue; limite OASIS : 6 000 caractères.")
        normalized.append(raw)
    if len(case_ids(normalized)) != len(normalized):
        raise ValueError(f"Les identifiants de cas de la partition {label} doivent être uniques.")
    return normalized


def load_pack() -> dict[str, Any]:
    if not PACK_FILE.is_file():
        raise ValueError(f"Jeu SkillOpt introuvable : {PACK_FILE}. Créer puis approuver un jeu dépersonnalisé.")
    pack = read_json(PACK_FILE)
    autonomous_pack = pack.get("autonomous_generated") is True
    regular_pack = pack.get("status") == "approved"
    generated_pack = autonomous_pack and ALLOW_AUTONOMOUS_PACKS and pack.get("status") == "system_validated"
    if not regular_pack and not generated_pack:
        raise ValueError("Le jeu SkillOpt doit être approved, ou system_validated et explicitement autorisé par le pipeline autonome.")
    if pack.get("redacted") is not True:
        raise ValueError("Le jeu SkillOpt doit confirmer redacted=true.")
    if pack.get("scope") != "skill_text_only":
        raise ValueError("Le jeu SkillOpt doit limiter son scope à skill_text_only.")
    skill_id = str(pack.get("skill_id") or "")
    if skill_id not in ALLOWED_SKILLS:
        raise ValueError(f"Compétence non autorisée pour apprentissage autonome : {skill_id or '<absente>'}.")
    skill_path = SKILL_CATALOG / skill_id / "SKILL.md"
    if not skill_path.is_file():
        raise ValueError(f"Compétence cible introuvable : {skill_path}.")

    train = validate_cases(pack.get("training_cases"), "training_cases", MAX_TRAIN_CASES)
    validation = validate_cases(pack.get("validation_cases"), "validation_cases", MAX_VALIDATION_CASES)
    holdout = validate_cases(pack.get("holdout_cases"), "holdout_cases", MAX_HOLDOUT_CASES)
    all_ids = case_ids(train) | case_ids(validation) | case_ids(holdout)
    if len(all_ids) != len(train) + len(validation) + len(holdout):
        raise ValueError("Les identifiants de cas doivent être distincts entre apprentissage, validation et contrôle final.")
    return {
        **pack,
        "skill_id": skill_id,
        "skill_path": str(skill_path),
        "training_cases": train,
        "validation_cases": validation,
        "holdout_cases": holdout,
    }


def validate() -> dict[str, Any]:
    pack = load_pack()
    return {
        "valid": True,
        "skill_id": pack["skill_id"],
        "partitions": {
            "training": len(pack["training_cases"]),
            "validation": len(pack["validation_cases"]),
            "holdout": len(pack["holdout_cases"]),
        },
        "autonomous_learning": bool(pack.get("autonomous_learning", False)),
        "promotion": "blocked_pending_human_approval",
        "limits": limits(),
    }


def limits() -> dict[str, Any]:
    # Estimation volontairement prudente : trajectoires cible, réflexion, édition et contrôles.
    planned_max_calls = MAX_TRAIN_CASES + (3 * MAX_VALIDATION_CASES) + (2 * MAX_HOLDOUT_CASES) + 3
    return {
        "max_training_cases": MAX_TRAIN_CASES,
        "max_validation_cases": MAX_VALIDATION_CASES,
        "max_holdout_cases": MAX_HOLDOUT_CASES,
        "max_epochs": MAX_EPOCHS,
        "max_steps": MAX_STEPS,
        "max_completion_tokens": MAX_COMPLETION_TOKENS,
        "max_runs_per_day": MAX_RUNS_PER_DAY,
        "timeout_seconds": TIMEOUT_SECONDS,
        "estimated_max_model_calls": planned_max_calls,
    }


def write_splits(run_dir: Path, pack: dict[str, Any]) -> Path:
    split_dir = run_dir / "splits"
    for name, cases in (
        ("train", pack["training_cases"]),
        ("val", pack["validation_cases"]),
        ("test", pack["holdout_cases"]),
    ):
        target = split_dir / name / "items.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(cases, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return split_dir


def write_config(run_dir: Path, split_dir: Path, skill_path: Path, pack: dict[str, Any]) -> Path:
    config = {
        "_base_": "/opt/skillopt/configs/_base_/default.yaml",
        "model": {
            "backend": "openai_compatible",
            "optimizer_backend": "openai_compatible",
            "target_backend": "openai_compatible",
            "optimizer": OPTIMIZER_MODEL,
            "target": TARGET_MODEL,
            "reasoning_effort": "low",
        },
        "train": {
            "num_epochs": MAX_EPOCHS,
            "train_size": len(pack["training_cases"]),
            "batch_size": len(pack["training_cases"]),
            "accumulation": 1,
        },
        "gradient": {"minibatch_size": 1, "merge_batch_size": 1},
        "optimizer": {
            "learning_rate": 1,
            "edit_budget": 1,
            "min_edit_budget": 1,
            "skill_update_mode": "patch",
            "use_meta_skill": False,
        },
        "evaluation": {
            "sel_env_num": len(pack["validation_cases"]),
            "test_env_num": len(pack["holdout_cases"]),
            "eval_test": True,
            "use_gate": True,
            "gate_metric": "hard",
        },
        "env": {
            "name": "oasis",
            "skill_init": str(skill_path),
            "split_mode": "split_dir",
            "split_dir": str(split_dir),
            "out_root": str(run_dir / "output"),
            "workers": 1,
            "analyst_workers": 1,
            "max_completion_tokens": MAX_COMPLETION_TOKENS,
            "limit": 0,
        },
    }
    config_path = run_dir / "skillopt.oasis.yaml"
    # YAML reste volontairement simple pour éviter une dépendance d’écriture supplémentaire.
    lines = [
        f"_base_: {config['_base_']}",
        "model:",
        "  backend: openai_compatible",
        "  optimizer_backend: openai_compatible",
        "  target_backend: openai_compatible",
        f"  optimizer: {OPTIMIZER_MODEL}",
        f"  target: {TARGET_MODEL}",
        "  reasoning_effort: low",
        "train:",
        f"  num_epochs: {MAX_EPOCHS}",
        f"  train_size: {len(pack['training_cases'])}",
        f"  batch_size: {len(pack['training_cases'])}",
        "  accumulation: 1",
        "gradient:",
        "  minibatch_size: 1",
        "  merge_batch_size: 1",
        "optimizer:",
        "  learning_rate: 1",
        "  edit_budget: 1",
        "  min_edit_budget: 1",
        "  skill_update_mode: patch",
        "  use_meta_skill: false",
        "evaluation:",
        f"  sel_env_num: {len(pack['validation_cases'])}",
        f"  test_env_num: {len(pack['holdout_cases'])}",
        "  eval_test: true",
        "  use_gate: true",
        "  gate_metric: hard",
        "env:",
        "  name: oasis",
        f"  skill_init: {skill_path}",
        "  split_mode: split_dir",
        f"  split_dir: {split_dir}",
        f"  out_root: {run_dir / 'output'}",
        "  workers: 1",
        "  analyst_workers: 1",
        f"  max_completion_tokens: {MAX_COMPLETION_TOKENS}",
        "  limit: 0",
    ]
    config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_json(run_dir / "run_manifest.json", {"created_at": now_iso(), "skill_id": pack["skill_id"], "limits": limits(), "config": config})
    return config_path


def find_best_skill(output_dir: Path, baseline: str) -> tuple[Path | None, str]:
    candidates = sorted(output_dir.rglob("best_skill.md"), key=lambda path: path.stat().st_mtime, reverse=True)
    for path in candidates:
        candidate = path.read_text(encoding="utf-8").strip()
        if candidate and candidate != baseline.strip():
            return path, candidate
    return None, baseline


def extract_score_summary(output_dir: Path) -> dict[str, Any]:
    summaries: list[dict[str, Any]] = []
    for path in sorted(output_dir.rglob("*.json")):
        if path.stat().st_size > 1_000_000:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            interesting = {key: payload[key] for key in payload if key in {"best_score", "current_score", "selection_hard", "selection_soft", "test_hard", "test_soft", "accepted", "gate"}}
            if interesting:
                summaries.append({"file": str(path.relative_to(output_dir)), "values": interesting})
    return {"score_artifacts": summaries[:30]}


def run_learning(trigger: str) -> dict[str, Any]:
    if not ENABLED:
        raise ValueError("SkillOpt est désactivé par OASIS_SKILLOPT_ENABLED.")
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY est requis pour l’apprentissage SkillOpt.")
    pack = load_pack()
    run_id = f"SKILL-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    baseline_path = Path(pack["skill_path"])
    baseline = baseline_path.read_text(encoding="utf-8")
    baseline_copy = run_dir / "baseline_SKILL.md"
    baseline_copy.write_text(baseline, encoding="utf-8")
    split_dir = write_splits(run_dir, pack)
    config_path = write_config(run_dir, split_dir, baseline_copy, pack)

    env = {
        **os.environ,
        "OPENAI_COMPATIBLE_BASE_URL": "https://openrouter.ai/api/v1",
        "OPENAI_COMPATIBLE_API_KEY": api_key,
        "OPTIMIZER_OPENAI_COMPATIBLE_BASE_URL": "https://openrouter.ai/api/v1",
        "OPTIMIZER_OPENAI_COMPATIBLE_API_KEY": api_key,
        "OPTIMIZER_OPENAI_COMPATIBLE_MODEL": OPTIMIZER_MODEL,
        "TARGET_OPENAI_COMPATIBLE_BASE_URL": "https://openrouter.ai/api/v1",
        "TARGET_OPENAI_COMPATIBLE_API_KEY": api_key,
        "TARGET_OPENAI_COMPATIBLE_MODEL": TARGET_MODEL,
    }
    command = ["python3", str(TRAIN_SCRIPT), "--config", str(config_path)]
    try:
        completed = subprocess.run(
            command,
            cwd=run_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        (run_dir / "stderr.log").write_text(str(error), encoding="utf-8")
        raise ValueError(f"SkillOpt a dépassé le délai de {TIMEOUT_SECONDS} secondes.") from error
    (run_dir / "stdout.log").write_text(completed.stdout[-200_000:], encoding="utf-8")
    (run_dir / "stderr.log").write_text(completed.stderr[-200_000:], encoding="utf-8")
    if completed.returncode != 0:
        raise ValueError(f"SkillOpt a échoué (code {completed.returncode}). Consulter {run_dir / 'stderr.log'}.")

    output_dir = run_dir / "output"
    best_path, candidate = find_best_skill(output_dir, baseline)
    proposal_id = f"SKILLOPT-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    proposal_dir = PROPOSALS_DIR / proposal_id
    proposal_dir.mkdir(parents=True, exist_ok=False)
    (proposal_dir / "baseline_SKILL.md").write_text(baseline, encoding="utf-8")
    (proposal_dir / "candidate_SKILL.md").write_text(candidate, encoding="utf-8")
    proposal = {
        "proposal_id": proposal_id,
        "created_at": now_iso(),
        "status": "pending_approval",
        "promotion": "blocked_pending_human_approval",
        "trigger": trigger,
        "skill_id": pack["skill_id"],
        "scope": "SKILL.md text only; never modifies production agents, models, tools, MCP, secrets, Docker or configuration",
        "reference_partitions": {
            "training": len(pack["training_cases"]),
            "validation": len(pack["validation_cases"]),
            "holdout": len(pack["holdout_cases"]),
        },
        "limits": limits(),
        "skillopt_output": str(best_path) if best_path else None,
        "candidate_changed": candidate != baseline,
        "score_summary": extract_score_summary(output_dir),
        "run_dir": str(run_dir),
        "review_required": [
            "Vérifier le diff entre baseline_SKILL.md et candidate_SKILL.md.",
            "Vérifier les métriques sur la partition holdout indépendante.",
            "Confirmer l’absence de données municipales sensibles dans le pack.",
            "Promouvoir uniquement via un commit distinct et les contrôles statiques OASIS.",
        ],
    }
    write_json(proposal_dir / "proposal.json", proposal)
    return proposal


def autonomous() -> dict[str, Any]:
    if not AUTONOMOUS_ENABLED:
        return {"started": False, "reason": "autonomy_disabled"}
    pack = load_pack()
    if pack.get("autonomous_learning") is not True:
        return {"started": False, "reason": "pack_autonomous_learning_not_enabled"}
    state = read_json(STATE_FILE, {"day": current_day(), "runs_today": 0})
    if state.get("day") != current_day():
        state = {"day": current_day(), "runs_today": 0}
    if int(state.get("runs_today", 0)) >= MAX_RUNS_PER_DAY:
        return {"started": False, "reason": "daily_limit_reached", "state": state}
    result = run_learning("autonomous_schedule")
    state["runs_today"] = int(state.get("runs_today", 0)) + 1
    state["last_run_at"] = now_iso()
    state["last_proposal_id"] = result["proposal_id"]
    write_json(STATE_FILE, state)
    return {"started": True, "proposal_id": result["proposal_id"], "state": state}


def status() -> dict[str, Any]:
    proposals = sorted(PROPOSALS_DIR.glob("*/proposal.json"), reverse=True) if PROPOSALS_DIR.exists() else []
    return {
        "enabled": ENABLED,
        "autonomous_enabled": AUTONOMOUS_ENABLED,
        "reference_pack": str(PACK_FILE),
        "reference_pack_present": PACK_FILE.is_file(),
        "proposal_count": len(proposals),
        "latest_proposals": [path.parent.name for path in proposals[:10]],
        "state": read_json(STATE_FILE, {}),
        "limits": limits(),
        "production_promotion": "human_review_only",
        "autonomous_pack_allowed": ALLOW_AUTONOMOUS_PACKS,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["status", "validate", "learn", "autonomous"])
    args = parser.parse_args()
    try:
        result = status() if args.action == "status" else validate() if args.action == "validate" else autonomous() if args.action == "autonomous" else run_learning("manual_mcp")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
