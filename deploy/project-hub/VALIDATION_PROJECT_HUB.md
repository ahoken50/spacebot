# Validation de conformité — Spacebot Project Hub

**Portée :** déploiement local Docker générique, six profils, OpenRouter sans Claude, mémoire PostgreSQL + pgvector, MCP locaux, production documentaire, analyse géospatiale facultative, scripts Python, apprentissage supervisé, remédiation après échec et approbation Web.

## Invariants de conception

| Domaine | Contrôle requis |
| --- | --- |
| Profils | Six agents avec workspaces privés et un unique accès sandboxé à l’espace documentaire partagé. |
| Routage | OpenRouter seulement; aucun modèle Claude; limites de contexte, branches et workers activées. |
| Données | Sources classées, résultats sourcés, mémoire commune auditée et aucune suppression physique des faits enregistrés. |
| Livrables | Brouillon, revue qualité, approbation et transmission conservés dans des emplacements distincts. |
| Apprentissage | Cas dépersonnalisés, sourcés, approuvés et séparés en partitions; aucune promotion automatique. |
| Échecs | Dernière tentative durable seulement, dépersonnalisation, déduplication et absence de relance automatique. |
| Compétences externes | Recherche possible; approbation UI, autorisation réservée hors workspace et source/profil strictement comparés par le moteur. |
| Sécurité | Aucun `env_file` global; secrets explicitement distribués; services internes sans publication de port hôte. |

## Validations à exécuter avant chaque mise en service

```bash
python3 validate_static.py
bash -n bootstrap_instance.sh
./bootstrap_instance.sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 spacebot-project-hub project-approval-bridge project-failure-remediator
```

Après la construction Docker, vérifier au minimum :

1. Les neuf services deviennent `healthy` ou `running` selon leur rôle.
2. L’interface locale répond sur `http://127.0.0.1:19898`.
3. Une tâche normale peut être déléguée entre profils et enregistrée avec ses sources.
4. Une proposition DSPy ou SkillOpt devient une tâche `pending_approval`, puis est appliquée seulement après **Approve**.
5. Un échec `failed`, `blocked` ou `timed_out` crée une leçon candidate dépersonnalisée sans relancer la tâche.
6. Une compétence externe approuvée s’installe pour le seul profil et la seule source autorisés; une autre source doit être refusée.
7. Un document DOCX/PDF et un aperçu PNG peuvent être produits dans l’espace partagé.
8. Toute analyse géospatiale utilisée pour une décision officielle est vérifiée par la personne compétente, avec emprises, unités et système de coordonnées documentés.

## Limites assumées

Le système prépare, analyse, classe, contrôle et propose. Il ne remplace pas une approbation institutionnelle, financière, scientifique, juridique, réglementaire ou SIG. Les données confidentielles et les clés ne doivent pas être placées dans l’espace partagé ni envoyées à un fournisseur externe sans validation de l’organisation responsable.

> Docker et la compilation Rust complète doivent être confirmés sur la machine cible. La validité opérationnelle dépend également des sources réelles, de la clé OpenRouter, de la politique de données et des décisions humaines du projet.
