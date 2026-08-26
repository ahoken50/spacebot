# Validation de conformité — Project Hub municipal

**Portée :** instance locale Docker destinée à compléter le travail du coordonnateur en environnement de la Ville de Val-d’Or. Elle comprend huit profils municipaux, OpenRouter sans Claude, mémoire PostgreSQL + pgvector, MCP locaux, production documentaire, analyse géomatique facultative, scripts Python, apprentissage supervisé, remédiation après échec, veille quotidienne de sources et approbation Web.

## Invariants de conception

| Domaine | Contrôle requis |
| --- | --- |
| Profils | Huit agents avec workspaces privés et seul accès sandboxé à l’espace documentaire partagé. |
| Routage | OpenRouter seulement; aucun modèle Claude; limites de contexte, branches et workers activées. |
| Sources | Toute analyse réglementaire ou de subvention conserve une URL, une date, une version ou empreinte, et un niveau de vérification. |
| Veille quotidienne | Sources HTTPS explicites dans une politique `approved`; première collecte de référence; changement soumis à tâche Web; aucune action automatique. |
| Rédaction municipale | Notes de réunion, procès-verbaux, notes de service, courriels, politiques et règlements restent des brouillons révisables. |
| Réglementation | Aucune conclusion juridique, certification de conformité, publication, dépôt, signature ou affirmation d’entrée en vigueur. |
| Subventions | Aucune admissibilité confirmée, aucun compte créé et aucune demande déposée automatiquement. |
| Apprentissage | Cas dépersonnalisés, sourcés, approuvés et partitionnés; aucune promotion automatique. |
| Échecs | Dernière tentative durable seulement, dépersonnalisation, déduplication et absence de relance automatique. |
| Compétences externes | Recherche possible; approbation UI, autorisation réservée hors workspace et source/profil strictement comparés par le moteur. |
| Sécurité | Aucun `env_file` global; secrets explicitement distribués; aucun port de service interne publié sur l’hôte. |

## Validations à exécuter avant mise en service

```bash
python3 validate_static.py
bash -n bootstrap_instance.sh
./bootstrap_instance.sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 spacebot-project-hub project-municipal-watch project-approval-bridge project-failure-remediator
```

Après la construction Docker, vérifier les points suivants :

1. Les dix services sont `healthy` ou `running` selon leur rôle.
2. L’interface locale répond sur `http://127.0.0.1:19898`.
3. Une tâche peut être déléguée entre le coordonnateur, les profils de subventions et de réglementation, puis être consolidée avec des sources.
4. Une proposition DSPy, SkillOpt ou leçon d’échec devient une tâche `pending_approval` et n’est appliquée qu’après **Approve**.
5. Une compétence externe approuvée est autorisée pour le seul profil et la seule source prévus; une autre source doit être refusée.
6. Après l’approbation locale de la politique de veille, la première collecte écrit seulement une base de référence.
7. Une modification simulée d’une source crée une fiche `municipal_watch` et une tâche Web; **Approve** doit produire uniquement un audit `review_recorded_no_automatic_action`.
8. Un procès-verbal, une note de service, une fiche décisionnelle et un brouillon de politique portent un statut de brouillon jusqu’à validation humaine.
9. Tout résultat géospatial utilisé pour une décision officielle est revu par une personne compétente, avec emprises, unités et système de coordonnées documentés.

## Limites assumées

Le système prépare, analyse, classe, contrôle et propose. Il ne remplace pas les décisions de la Ville, le conseil, le greffe, les affaires juridiques, les services responsables, une approbation financière ou une validation SIG. Les données confidentielles et les clés ne doivent pas être placées dans l’espace partagé ni envoyées à un fournisseur externe sans validation organisationnelle.

> La construction Docker, la compilation Rust complète et l’accessibilité réelle des sources publiques doivent être confirmées sur la machine cible. La validité opérationnelle dépend également des sources réelles, de la politique de données et des décisions humaines.
