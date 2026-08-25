---
name: oasis-capability-discovery
description: Découvrir, réutiliser, installer ou créer une compétence ou un outil local de façon contrôlée. Utiliser lorsqu’une tâche OASIS exige une capacité absente ou incertaine.
---

# Découverte contrôlée de capacités

## Ordre obligatoire

1. Commencer par `skills_list`, puis lire les compétences dont le nom ou la description est pertinent avec `read_skill`. Vérifier aussi les gabarits dans `00_systeme/`, les scripts dans les compétences, les binaires de `/data/tools/bin` et les outils MCP déjà disponibles dans le prompt.
2. Réutiliser une capacité existante si elle couvre le besoin. Ne pas créer un doublon pour une variation mineure; documenter l’écart dans la mémoire commune si nécessaire.
3. Si une capacité manque, définir le résultat attendu, les entrées/sorties, les contraintes de confidentialité, le coût estimé, la source autoritative et le niveau de risque. Chercher d’abord une compétence reconnue ou une documentation officielle; ne pas exécuter de code récupéré sur le Web sans validation explicite.
4. Si une compétence doit être installée, préférer la bibliothèque officielle et une compétence compatible. Vérifier sa description, ses dépendances, ses permissions et ses fichiers avant installation. Les compétences externes restent installées et ne sont jamais modifiées automatiquement.
5. Si aucune compétence adaptée n’existe, créer une compétence **dans le workspace de l’agent** avec `skill_manage`, pas dans les compétences d’instance. Elle doit avoir un nom précis, une description de déclenchement, une procédure concise et seulement les ressources nécessaires. Tester le script ou le modèle associé; le gestionnaire recharge ensuite la compétence.
6. Pour un outil ou un service nouveau, créer d’abord une proposition classée dans `00_systeme/propositions_capacites/` : justification, sources, dépendances, surface de données, coûts, tests et plan de retrait. Les changements de conteneur, de configuration MCP, de modèle, de secret, de réseau ou de permission exigent une approbation humaine avant activation.
7. Enregistrer la décision dans la mémoire commune avec le statut `pending_approval` lorsqu’elle implique une dépendance externe, un coût récurrent, une modification d’outil ou une capacité partagée. Décrire ce qui a été vérifié, créé, installé ou refusé.

## Règles de sobriété et de sécurité

Charger seulement les compétences nécessaires au worker concerné. Ne pas rechercher ou installer de nouvelles capacités si une procédure locale suffit. Ne jamais transférer de documents municipaux confidentiels à un registre, dépôt ou service externe uniquement pour obtenir une compétence. Ne jamais remplacer une compétence d’instance, intégrée, installée ou épinglée. Ne jamais installer un binaire, une bibliothèque ou un connecteur sans source vérifiable et approbation lorsque cela modifie l’environnement durable.

## Résultat attendu

Retourner le besoin, les capacités locales vérifiées, la solution retenue, le chemin de la compétence ou de l’outil, les tests exécutés, les dépendances et l’approbation nécessaire. Rester concis; éviter de reproduire des listes de compétences ou sorties d’outils complètes dans les échanges interagents.
