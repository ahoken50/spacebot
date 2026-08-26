"""Deterministic SkillOpt rollouts for Project Hub skills."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from skillopt.model import chat_target


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def score_output(output: str, expected: dict[str, Any]) -> tuple[int, float, list[str], dict[str, float]]:
    normalized = _normalize(output)
    required = [_normalize(str(item)) for item in expected.get("required_terms", [])]
    forbidden = [_normalize(str(item)) for item in expected.get("forbidden_terms", [])]
    required_hits = sum(1 for term in required if term in normalized)
    forbidden_hits = sum(1 for term in forbidden if term in normalized)
    requires_sources = bool(expected.get("require_source_markers", False))
    has_source = bool(re.search(r"(source|référence|annexe|pièce|\[\d+\])", normalized))
    max_chars = int(expected.get("max_chars", 5000))

    required_score = 1.0 if not required else required_hits / len(required)
    forbidden_score = max(0.0, 1.0 - (forbidden_hits / max(1, len(forbidden))))
    source_score = 1.0 if not requires_sources or has_source else 0.0
    brevity_score = 1.0 if len(output) <= max_chars else max(0.0, max_chars / max(1, len(output)))
    soft = round(0.45 * required_score + 0.25 * forbidden_score + 0.20 * source_score + 0.10 * brevity_score, 4)

    feedback: list[str] = []
    if required and required_hits != len(required):
        feedback.append(f"Termes requis absents : {len(required) - required_hits}.")
    if forbidden_hits:
        feedback.append(f"Termes interdits présents : {forbidden_hits}.")
    if requires_sources and not has_source:
        feedback.append("Marqueur de source ou d’annexe absent.")
    if len(output) > max_chars:
        feedback.append(f"Sortie trop longue : {len(output)} caractères, maximum {max_chars}.")

    hard = int(required_score == 1.0 and forbidden_score == 1.0 and source_score == 1.0 and brevity_score == 1.0)
    components = {
        "required_terms": required_score,
        "forbidden_terms": forbidden_score,
        "source_markers": source_score,
        "brevity": brevity_score,
    }
    return hard, soft, feedback, components


def _rollout_one(item: dict[str, Any], skill_content: str, prediction_dir: Path, max_completion_tokens: int) -> dict[str, Any]:
    system = skill_content
    user = (
        "Applique strictement la compétence fournie à la tâche suivante. "
        "Ne fabrique aucune donnée, aucune approbation ni aucune source. "
        "Rends seulement le livrable demandé, en français.\n\n"
        f"Tâche :\n{item['task_input']}"
    )
    prediction, _usage = chat_target(
        system=system,
        user=user,
        max_completion_tokens=max_completion_tokens,
    )
    prediction = str(prediction or "").strip()
    hard, soft, feedback, components = score_output(prediction, item["expected"])

    task_dir = prediction_dir / str(item["id"])
    task_dir.mkdir(parents=True, exist_ok=True)
    conversation = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
        {"role": "assistant", "content": prediction},
    ]
    (task_dir / "conversation.json").write_text(json.dumps(conversation, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "id": str(item["id"]),
        "hard": hard,
        "soft": soft,
        "predicted_answer": prediction,
        "task_description": item["task_input"],
        "task_type": item["task_type"],
        "target_system_prompt": system,
        "target_user_prompt": user,
        "evaluation_feedback": feedback,
        "score_components": components,
        "n_turns": 1,
    }


def run_batch(*, items: list[dict[str, Any]], skill_content: str, out_root: str, workers: int = 1, max_completion_tokens: int = 900) -> list[dict[str, Any]]:
    del workers  # Project Hub limite volontairement l’apprentissage à une requête à la fois.
    prediction_dir = Path(out_root, "predictions")
    prediction_dir.mkdir(parents=True, exist_ok=True)
    results = [
        _rollout_one(item, skill_content, prediction_dir, max_completion_tokens)
        for item in items
    ]
    Path(out_root, "rollouts.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return results
