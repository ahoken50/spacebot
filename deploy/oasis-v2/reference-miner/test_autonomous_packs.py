from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPTIMIZER = ROOT / "optimizer" / "optimizer.py"
SKILLOPT = ROOT / "skillopt" / "skillopt_runner.py"
SKILL_CATALOG = ROOT / "profile-skills"

EXPECTED = {
    "required_terms": ["source"],
    "forbidden_terms": ["invention"],
    "require_source_markers": True,
    "max_chars": 800,
}


def run(command: list[str], env: dict[str, str]) -> dict:
    completed = subprocess.run(command, env=env, text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        raise AssertionError(f"Commande échouée: {' '.join(command)}\nSTDOUT={completed.stdout}\nSTDERR={completed.stderr}")
    return json.loads(completed.stdout)


def main() -> None:
    temporary_root = Path(tempfile.mkdtemp(prefix="oasis-autonomous-packs-"))
    try:
        workspace = temporary_root / "workspace"
        autonomous = workspace / "00_systeme" / "optimisation" / "reference-miner" / "autonomous-packs"
        autonomous.mkdir(parents=True)
        dspy_pack = autonomous / "dspy_reference_cases.system_validated.json"
        dspy_pack.write_text(json.dumps({
            "schema_version": "1.0", "status": "system_validated", "autonomous_generated": True,
            "redacted": True, "scope": "instruction_appendix_only", "auto_execute": True,
            "cases": [{
                "id": "AUTO-DSPY-001", "agent_id": "oasis-coordination",
                "task_input": "Préparer une synthèse dépersonnalisée avec sa source.",
                "baseline_instruction": "Citer la source et ne rien inventer.", "expected": EXPECTED,
                "source_record_id": "00000000-0000-0000-0000-000000000001", "source_references": ["registre:test"],
            }],
        }, ensure_ascii=False), encoding="utf-8")
        skillopt_pack = autonomous / "skillopt_reference_pack.system_validated.json"
        cases = [{
            "id": f"AUTO-SKILLOPT-00{index}",
            "task_input": f"Préparer une synthèse dépersonnalisée numéro {index} avec sa source.",
            "expected": EXPECTED,
            "source_record_id": f"00000000-0000-0000-0000-00000000000{index}",
            "source_references": ["registre:test"],
        } for index in range(1, 4)]
        skillopt_pack.write_text(json.dumps({
            "schema_version": "1.0", "status": "system_validated", "autonomous_generated": True,
            "redacted": True, "scope": "skill_text_only", "autonomous_learning": True,
            "skill_id": "oasis-financial-control",
            "training_cases": [cases[0]], "validation_cases": [cases[1]], "holdout_cases": [cases[2]],
        }, ensure_ascii=False), encoding="utf-8")
        base_env = os.environ | {
            "OASIS_WORKSPACE": str(workspace),
            "OASIS_SKILLOPT_SKILL_CATALOG": str(SKILL_CATALOG),
        }
        dspy_env = base_env | {
            "OASIS_OPTIMIZER_REFERENCE_PACK_PATH": str(dspy_pack),
            "OASIS_OPTIMIZER_ALLOW_AUTONOMOUS_PACKS": "true",
        }
        skillopt_env = base_env | {
            "OASIS_SKILLOPT_REFERENCE_PACK_PATH": str(skillopt_pack),
            "OASIS_SKILLOPT_ALLOW_AUTONOMOUS_PACKS": "true",
        }
        assert run([sys.executable, str(OPTIMIZER), "validate"], dspy_env).get("valid") is True
        assert run([sys.executable, str(SKILLOPT), "validate"], skillopt_env).get("valid") is True
        print("Validation des packs autonomes temporaires : OK")
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)


if __name__ == "__main__":
    main()
