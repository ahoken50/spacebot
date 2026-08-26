---
name: task-safe-self-improvement
description: Améliorer automatiquement les scripts locaux de l’espace de travail après un échec ou un test insuffisant, avec validation syntaxique, sauvegarde et audit, sans approbation humaine.
---

# Auto-amélioration locale du code

## Périmètre autorisé sans approbation humaine

L’agent peut améliorer automatiquement un script source situé sous `05_automatisation/01_scripts/` lorsqu’il peut expliquer le défaut observé, proposer une correction réversible et fournir une validation adaptée. Les améliorations comprennent notamment les corrections de logique, contrôles d’entrée, messages d’erreur, documentation technique, tests de régression et optimisation locale sans effet externe.

## Cycle requis

1. Consigner le symptôme, les entrées concernées, le comportement attendu et le test minimal de reproduction.
2. Lire le script, ses tests et les leçons déjà enregistrées; éviter une correction déjà tentée.
3. Produire une candidate sous `00_systeme/optimisation/self-improvement/proposals/` avec l’empreinte de la version de départ, le contenu complet proposé et les contraintes déclarées.
4. Déclarer explicitement que le changement demeure local, sans secret, dépendance, réseau, accès, modèle, MCP, Docker ou configuration.
5. Le service local valide la candidate dans un fichier temporaire. Pour Python, JavaScript ou shell, il exécute respectivement `py_compile`, `node --check` ou `bash -n`.
6. Si la validation réussit et que l’empreinte de départ correspond, le service crée une sauvegarde horodatée, applique atomiquement le script et écrit un audit `auto_applied_local_code`.
7. Si la validation échoue, il conserve la candidate avec `validation_failed`, n’écrase rien et crée une tâche de diagnostic.

## Contenu minimal de la proposition

```json
{
  "schema_version": 1,
  "kind": "local_code_improvement",
  "proposal_id": "unique-id",
  "status": "pending_validation",
  "target_path": "05_automatisation/01_scripts/exemple.py",
  "base_sha256": "empreinte-de-la-version-lue",
  "candidate_content": "contenu-complet-du-script",
  "reason": "défaut observé et correction",
  "validation": {"kind": "python_syntax"},
  "constraints": {
    "local_workspace_only": true,
    "external_side_effects": false,
    "config_change": false,
    "dependency_change": false,
    "secret_access": false,
    "network_access": false
  }
}
```

## Évolution autonome de l’environnement local

Les dépendances, Docker et MCP peuvent également évoluer sans rétroaction humaine lorsqu’une proposition typée est déposée sous `00_systeme/optimisation/environment-evolver/proposals/`. Une proposition doit limiter son périmètre au dépôt local, déclarer `secret_change=false`, `permission_change=false` et `external_transmission=false`, désigner le ou les services concernés et comporter une justification reproductible.

| Type | Forme autorisée | Vérification et retour arrière |
| --- | --- | --- |
| Dépendance | Paquet avec version exacte, sans commande libre. | Installation sans scripts de cycle de vie, vérification du verrou, reconstruction ciblée puis restauration en cas d’échec. |
| Docker | Contenu complet d’un `Dockerfile` autorisé ou de `docker-compose.yml`, avec empreinte de départ. | `docker compose config`, reconstruction et redémarrage ciblé; restauration du fichier et des services si échec. |
| MCP | Contenu complet de `instance/config.toml`, avec modification limitée aux blocs MCP locaux. | Analyse TOML, endpoints internes contrôlés et redémarrage ciblé; restauration si échec. |

## Hors périmètre

Ne pas modifier les secrets, permissions, politiques d’accès, données sources, documents transmis ni ressources externes non fournies. Ces opérations restent soumises à une décision explicite du responsable.
