# Cellule municipale Spacebot

Pack mince : **un seul service Spacebot**, cinq agents, OpenRouter, aucun MCP.

## Agents

| ID | Rôle |
| --- | --- |
| `mun-coordination` | Point d’entrée, délégation, stop avant envoi |
| `mun-redaction` | Règlements, notes, lettres, communiqués (brouillon) |
| `mun-pilotage` | Projets et subventions |
| `mun-juridique` | Validation légale de travail (LégisQuébec, CanLII) |
| `mun-outils` | Scripts, ETL, OpenCode |

## Démarrage

```bash
cp deploy/municipal/.env.example deploy/municipal/.env
# renseigner OPENROUTER_API_KEY
mkdir -p ~/mun-travail

docker compose -f deploy/municipal/docker-compose.yml up -d
```

UI : http://127.0.0.1:19898

Le dossier `~/mun-travail` est monté dans `/data/shared`.
Les compétences sont dans `deploy/municipal/profile-skills/`.
Après le premier boot, les copier dans le workspace de chaque agent.

## Routage OpenRouter (défauts)

| Processus | Modèle |
| --- | --- |
| channel | `openrouter/deepseek/deepseek-v4-flash` |
| branch | `openrouter/z-ai/glm-5.3-flash` |
| worker | `openrouter/openai/gpt-oss-120b` |
| compactor / cortex | `openrouter/openai/gpt-oss-20b` |
| vision | `openrouter/google/gemini-2.5-flash-lite` |
| mun-juridique | GLM 5.3 Flash |
| mun-outils | gpt-oss-120b |

Vérifier les slugs sur openrouter.ai/models avant le premier boot.
OASIS-V2 reste sur `feat/oasis-v2-pilotage`.
