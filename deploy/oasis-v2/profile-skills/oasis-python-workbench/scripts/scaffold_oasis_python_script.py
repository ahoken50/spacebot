#!/usr/bin/env python3
"""Créer un squelette de script Python OASIS dans le workspace partagé."""
from __future__ import annotations

import argparse
import re
from pathlib import Path

SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", required=True, help="ID de l’agent OASIS créateur.")
    parser.add_argument("--name", required=True, help="Nom kebab-case du script, sans extension.")
    parser.add_argument("--purpose", required=True, help="But vérifiable du script.")
    parser.add_argument("--workspace", default="/data/shared-workspace", help="Racine du workspace OASIS.")
    return parser.parse_args()


def validate(value: str, label: str) -> str:
    if not SAFE_NAME.fullmatch(value):
        raise SystemExit(f"{label} doit être en kebab-case (2 à 80 caractères).")
    return value


def main() -> None:
    args = parse_args()
    agent = validate(args.agent, "--agent")
    name = validate(args.name, "--name")
    workspace = Path(args.workspace).resolve()
    scripts_root = (workspace / "00_systeme" / "scripts").resolve()
    target_dir = (scripts_root / agent).resolve()
    if scripts_root not in target_dir.parents:
        raise SystemExit("Le dossier cible doit rester dans 00_systeme/scripts.")
    target_dir.mkdir(parents=True, exist_ok=True)
    script_path = target_dir / f"{name}.py"
    readme_path = target_dir / f"{name}.README.md"
    if script_path.exists() or readme_path.exists():
        raise SystemExit("Un script ou README du même nom existe déjà; créer une nouvelle version.")

    script_path.write_text(
        f'''#!/usr/bin/env python3
"""{args.purpose}"""
from __future__ import annotations

import argparse
from pathlib import Path

WORKSPACE = Path("{workspace}").resolve()


def within_workspace(value: Path) -> Path:
    resolved = value.resolve()
    if WORKSPACE != resolved and WORKSPACE not in resolved.parents:
        raise ValueError("Le chemin doit rester dans le workspace OASIS.")
    return resolved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Entrée locale dans le workspace.")
    parser.add_argument("--output", required=True, help="Sortie locale dans le workspace.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = within_workspace(Path(args.input))
    output_path = within_workspace(Path(args.output))
    if not input_path.is_file():
        raise FileNotFoundError(f"Entrée introuvable : {{input_path}}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # TODO: Implémenter le traitement avec la bibliothèque standard ou une dépendance approuvée.
    output_path.write_text("Traitement à implémenter.\\n", encoding="utf-8")


if __name__ == "__main__":
    main()
''',
        encoding="utf-8",
    )
    readme_path.write_text(
        f'''# {name}

**Agent créateur :** `{agent}`

**But :** {args.purpose}

## Entrées et sorties

- Entrée : chemin explicite sous le workspace OASIS.
- Sortie : chemin explicite sous le workspace OASIS.

## Validation minimale

```bash
python3 -m py_compile {script_path}
python3 {script_path} --help
```

Ne pas installer de dépendance, modifier une source officielle ou utiliser une donnée sensible sans la procédure et l’approbation applicables.
''',
        encoding="utf-8",
    )
    print(f"Squelette créé : {script_path}")
    print(f"Documentation créée : {readme_path}")


if __name__ == "__main__":
    main()
