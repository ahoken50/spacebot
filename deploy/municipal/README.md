# Cellule municipale Spacebot

Un service Spacebot, cinq agents, OpenRouter, aucun MCP.

## Démarrage

```bash
cp .env.example .env
./bootstrap_instance.sh
docker compose up -d
# une fois les agents créés :
docker compose exec spacebot /bin/sh -c 'for id in mun-coordination mun-redaction mun-pilotage mun-juridique mun-outils; do
  mkdir -p /data/agents/$id/workspace/skills
  cp /data/municipal-identity/$id/* /data/agents/$id/
  cp -R /data/municipal-skills/mun-fondation /data/agents/$id/workspace/skills/
  cp -R /data/municipal-skills/$id /data/agents/$id/workspace/skills/
done'
```

UI : http://127.0.0.1:19898

## Routage

| Processus | Modèle |
| --- | --- |
| channel, worker, **compactor** | `deepseek/deepseek-v4-flash` |
| branch / juridique | `z-ai/glm-5.3-flash` |
| outils seulement | `openai/gpt-oss-120b` |
| cortex | `openai/gpt-oss-20b` |

Tours : coordination 8 · rédaction/pilotage 4 · juridique/outils 10.

Délégation : `identity/mun-coordination/ROLE.md`.
