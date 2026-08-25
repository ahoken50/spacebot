#!/usr/bin/env python3
"""OASIS supervised optimizer: evaluate redacted reference cases and propose, never promote."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

WORKSPACE = Path(os.environ.get("OASIS_WORKSPACE", "/data/shared-workspace"))
ROOT = WORKSPACE / "00_systeme" / "optimisation"
CASES_FILE = Path(os.environ.get("OASIS_OPTIMIZER_REFERENCE_PACK_PATH", ROOT / "reference_cases.approved.json"))
ALLOW_AUTONOMOUS_PACKS = os.environ.get("OASIS_OPTIMIZER_ALLOW_AUTONOMOUS_PACKS", "false").strip().lower() in {"1", "true", "yes", "on"}
PROPOSALS_DIR = ROOT / "propositions"
MAX_CASES = int(os.environ.get("OASIS_OPTIMIZER_MAX_CASES", "12"))
MAX_CANDIDATES = int(os.environ.get("OASIS_OPTIMIZER_MAX_CANDIDATES", "2"))
MAX_CALLS = int(os.environ.get("OASIS_OPTIMIZER_MAX_CALLS", "8"))


@dataclass
class Score:
    total: float
    required_terms: float
    forbidden_terms: float
    source_markers: float
    brevity: float
    feedback: list[str]


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_cases() -> list[dict[str, Any]]:
    if not CASES_FILE.is_file():
        raise ValueError(
            f"Cas de référence introuvables : {CASES_FILE}. Créer un jeu approuvé et dépersonnalisé avant toute optimisation."
        )
    payload = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    autonomous_pack = payload.get("autonomous_generated") is True
    regular_pack = payload.get("status") == "approved"
    generated_pack = autonomous_pack and ALLOW_AUTONOMOUS_PACKS and payload.get("status") == "system_validated"
    if not regular_pack and not generated_pack:
        raise ValueError("Le jeu de référence doit être approved, ou system_validated et explicitement autorisé pour le pipeline autonome.")
    if autonomous_pack and (payload.get("redacted") is not True or payload.get("scope") != "instruction_appendix_only"):
        raise ValueError("Un pack DSPy autonome doit confirmer redacted=true et scope=instruction_appendix_only.")
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Le jeu de référence doit contenir au moins un cas.")
    if len(cases) > MAX_CASES:
        raise ValueError(f"Le jeu de référence contient {len(cases)} cas; limite configurée : {MAX_CASES}.")
    for case in cases:
        for field in ("id", "agent_id", "task_input", "baseline_instruction", "expected"):
            if not case.get(field):
                raise ValueError(f"Le cas {case.get('id', '<sans id>')} doit contenir {field}.")
        if len(case["task_input"]) > 4000 or len(case["baseline_instruction"]) > 2400:
            raise ValueError(f"Le cas {case['id']} dépasse la taille autorisée; conserver un exemple dépersonnalisé et concis.")
    return cases


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def score_output(output: str, expected: dict[str, Any]) -> Score:
    normalized = normalize(output)
    required = [normalize(str(item)) for item in expected.get("required_terms", [])]
    forbidden = [normalize(str(item)) for item in expected.get("forbidden_terms", [])]
    required_hits = sum(1 for term in required if term in normalized)
    forbidden_hits = sum(1 for term in forbidden if term in normalized)
    has_source = bool(re.search(r"(source|référence|annexe|pièce|\[\d+\])", normalized))
    max_chars = int(expected.get("max_chars", 5000))
    feedback: list[str] = []
    if required and required_hits != len(required):
        feedback.append(f"Termes requis absents : {len(required) - required_hits}.")
    if forbidden_hits:
        feedback.append(f"Termes interdits présents : {forbidden_hits}.")
    if expected.get("require_source_markers", False) and not has_source:
        feedback.append("Référence de source ou d’annexe absente.")
    if len(output) > max_chars:
        feedback.append(f"Sortie trop longue ({len(output)} caractères; maximum {max_chars}).")
    required_score = 1.0 if not required else required_hits / len(required)
    forbidden_score = max(0.0, 1.0 - (forbidden_hits / max(1, len(forbidden))))
    source_score = 1.0 if not expected.get("require_source_markers", False) or has_source else 0.0
    brevity_score = 1.0 if len(output) <= max_chars else max(0.0, max_chars / max(1, len(output)))
    total = round(0.45 * required_score + 0.25 * forbidden_score + 0.20 * source_score + 0.10 * brevity_score, 4)
    return Score(total, required_score, forbidden_score, source_score, brevity_score, feedback)


def make_lm():
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY est requis pour proposer des variantes.")
    try:
        import dspy  # Imported only for an explicit optimization run.
    except ImportError as error:
        raise ValueError("DSPy est indisponible dans ce conteneur.") from error
    model = os.environ.get("OASIS_OPTIMIZER_MODEL", "openrouter/qwen/qwen3.7-flash")
    lm = dspy.LM(
        model,
        api_key=api_key,
        api_base="https://openrouter.ai/api/v1",
        temperature=0.2,
        max_tokens=750,
        cache=True,
        num_retries=1,
    )
    dspy.configure(lm=lm)
    return dspy


def propose_instruction(dspy: Any, case: dict[str, Any], feedback: list[str]) -> str:
    proposer = dspy.Predict(
        "baseline_instruction, task_input, evaluation_feedback -> candidate_instruction"
    )
    response = proposer(
        baseline_instruction=case["baseline_instruction"],
        task_input=case["task_input"],
        evaluation_feedback="; ".join(feedback) or "Aucun écart déterministe détecté; améliorer seulement la concision et la vérifiabilité.",
    )
    candidate = str(getattr(response, "candidate_instruction", "")).strip()
    if not candidate or len(candidate) > 3000:
        raise ValueError("La variante proposée est vide ou dépasse la limite de 3 000 caractères.")
    return candidate


def run_candidate(dspy: Any, case: dict[str, Any], instruction: str) -> tuple[str, Score]:
    predictor = dspy.Predict("instruction, task_input -> response")
    response = predictor(instruction=instruction, task_input=case["task_input"])
    text = str(getattr(response, "response", "")).strip()
    if not text:
        raise ValueError(f"La réponse du cas {case['id']} est vide.")
    return text, score_output(text, case["expected"])


def run_optimization(max_candidates: int) -> dict[str, Any]:
    if not 1 <= max_candidates <= MAX_CANDIDATES:
        raise ValueError(f"max_candidates doit être compris entre 1 et {MAX_CANDIDATES}.")
    cases = read_cases()
    expected_calls = len(cases) * (1 + max_candidates) + len(cases) * max_candidates
    if expected_calls > MAX_CALLS:
        raise ValueError(
            f"Budget dépassé : {expected_calls} appels prévus, limite {MAX_CALLS}. Réduire le jeu de cas ou les candidats."
        )
    dspy = make_lm()
    baseline_results: list[dict[str, Any]] = []
    for case in cases:
        text, score = run_candidate(dspy, case, case["baseline_instruction"])
        baseline_results.append({"case_id": case["id"], "output": text, "score": score.total, "feedback": score.feedback})
    baseline_mean = round(sum(row["score"] for row in baseline_results) / len(baseline_results), 4)

    candidates: list[dict[str, Any]] = []
    for index in range(max_candidates):
        variation_results: list[dict[str, Any]] = []
        instructions: dict[str, str] = {}
        for case, baseline in zip(cases, baseline_results, strict=True):
            instruction = propose_instruction(dspy, case, baseline["feedback"])
            instructions[case["id"]] = instruction
            text, score = run_candidate(dspy, case, instruction)
            variation_results.append({"case_id": case["id"], "output": text, "score": score.total, "feedback": score.feedback})
        mean_score = round(sum(row["score"] for row in variation_results) / len(variation_results), 4)
        candidates.append({"candidate_number": index + 1, "mean_score": mean_score, "instructions": instructions, "results": variation_results})

    best = max(candidates, key=lambda candidate: candidate["mean_score"])
    proposal_id = f"OPT-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    proposal = {
        "proposal_id": proposal_id,
        "created_at": now_iso(),
        "status": "pending_approval",
        "promotion": "blocked",
        "scope": "instruction appendices only; never modifies production agents, models, tools, skills or configuration",
        "reference_case_count": len(cases),
        "call_budget": {"planned": expected_calls, "limit": MAX_CALLS},
        "baseline": {"mean_score": baseline_mean, "results": baseline_results},
        "best_candidate": best,
        "improvement": round(best["mean_score"] - baseline_mean, 4),
        "review_required": [
            "Valider les cas de référence et l’absence de données municipales sensibles.",
            "Lire les instructions proposées et les comparer aux exigences OASIS.",
            "Promouvoir manuellement via un changement versionné après approbation humaine.",
        ],
    }
    write_json(PROPOSALS_DIR / f"{proposal_id}.json", proposal)
    return proposal


def validate() -> dict[str, Any]:
    cases = read_cases()
    return {
        "valid": True,
        "reference_cases": len(cases),
        "limits": {"max_cases": MAX_CASES, "max_candidates": MAX_CANDIDATES, "max_calls": MAX_CALLS},
        "promotion": "blocked_pending_human_approval",
    }


def status() -> dict[str, Any]:
    proposals = sorted(PROPOSALS_DIR.glob("*.json"), reverse=True) if PROPOSALS_DIR.exists() else []
    return {
        "reference_pack": str(CASES_FILE),
        "reference_pack_present": CASES_FILE.is_file(),
        "proposal_count": len(proposals),
        "latest_proposals": [path.name for path in proposals[:10]],
        "limits": {"max_cases": MAX_CASES, "max_candidates": MAX_CANDIDATES, "max_calls": MAX_CALLS},
        "production_promotion": "human_review_only",
        "autonomous_pack_allowed": ALLOW_AUTONOMOUS_PACKS,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["validate", "status", "optimize"])
    parser.add_argument("--max-candidates", type=int, default=1)
    args = parser.parse_args()
    try:
        result = validate() if args.action == "validate" else status() if args.action == "status" else run_optimization(args.max_candidates)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
