# Validation — Autonomous Task Hub

**Portée :** instance locale Docker d’assistance adaptative aux tâches. Elle comprend huit profils génériques, OpenRouter sans Claude, mémoire PostgreSQL + pgvector, production documentaire, scripts Python, DSPy, SkillOpt, remédiation après échec et services d’auto-évolution locale.

## Invariants de conception

| Domaine | Contrôle requis |
| --- | --- |
| Profils | Huit agents avec workspaces privés et seul accès sandboxé à l’espace documentaire partagé. |
| Routage | OpenRouter seulement; aucun modèle Claude; branches, workers, contexte et compaction bornés. |
| Autonomie | Niveau `act`; les tâches prêtes progressent sans nouvelle consigne et les tâches incomplètes sont enrichies puis replanifiées. |
| Mémoire | Sources, hypothèses, résultats, limites, tests et prochaines actions sont enregistrés dans PostgreSQL + pgvector. |
| Échecs | Dernière tentative durable, dépersonnalisation, déduplication par signature et différence de plan obligatoire avant reprise. |
| Code local | Correction seulement dans le dossier de scripts autorisé; empreinte, syntaxe, sauvegarde, écriture atomique et audit. |
| Dépendances | Paquet et version exacte, installation sans scripts de cycle de vie, vérification du verrou et restauration si le contrôle échoue. |
| Docker | Fichier autorisé, empreinte, `docker compose config`, reconstruction ciblée, audit et retour arrière en cas d’échec. |
| MCP | Modification limitée aux déclarations MCP locales, endpoints internes validés et redémarrage du service concerné. |
| Secrets et permissions | Aucun secret n’est exposé par les propositions; aucun changement de permission n’est traité automatiquement. |
| Actions externes | Aucune publication, transmission, achat ou accès externe non fourni par le responsable. |

## Validations avant mise en service

```bash
python3 validate_static.py
bash -n bootstrap_instance.sh
./bootstrap_instance.sh

docker compose up -d --build
docker compose ps
docker compose logs --tail=100 \
  spacebot-project-hub \
  project-failure-remediator \
  project-reference-miner \
  project-local-code-improver \
  project-environment-evolver
```

Exécuter également les contrôles syntaxiques locaux :

```bash
find local-code-improver environment-evolver approval-bridge failure-remediator \
  -name '*.js' -print0 | xargs -0 -n1 node --check
python3 -m py_compile optimizer/optimizer.py skillopt/skillopt_runner.py
```

## Scénarios fonctionnels à confirmer

1. Une tâche est qualifiée par l’orchestrateur, répartie entre plusieurs profils puis consolidée sans dupliquer les sources ou les calculs.
2. Après un échec `failed`, `blocked` ou `timed_out`, le remédiateur génère une leçon dépersonnalisée et supprime les répétitions de même signature.
3. Une candidate Python, JavaScript ou shell valide sous `05_automatisation/01_scripts/` est sauvegardée, appliquée atomiquement et journalisée avec le statut `auto_applied_local_code`.
4. Une candidate contenant une empreinte initiale obsolète ou une syntaxe invalide est classée `validation_failed` sans modification du script actif.
5. Une proposition de dépendance avec une version exacte est installée sans script de cycle de vie, verrouillée et reconstruite; un échec restaure le manifeste et le verrou précédents.
6. Une proposition Docker invalide est refusée après `docker compose config`; la version sauvegardée demeure active.
7. Une proposition MCP ne modifiant pas les seuls blocs MCP est refusée; une déclaration interne valide est appliquée, auditée et suivie d’un redémarrage ciblé.
8. L’interface locale répond sur `http://127.0.0.1:19898` et aucun service interne n’est publié directement sur l’hôte.

## Limites assumées

L’autonomie est volontairement étendue aux opérations locales réversibles, y compris l’évolution du code, des dépendances, de Docker et des MCP. Cette extension donne au contrôleur d’environnement accès au socket Docker de l’hôte : elle doit donc être activée seulement sur une machine dédiée à cette instance, avec des sauvegardes testées et un dépôt local dont le responsable accepte les modifications automatiques.

> La construction Docker, la compilation Rust complète et les tests de redémarrage doivent être confirmés sur l’hôte Linux cible. La validité opérationnelle dépend aussi des données réelles, des clés locales et des décisions prises par le responsable pour les actions externes ou irréversibles.
