---
name: oasis-coordination
description: "Coordination OASIS-V2 : clarification, plan de travail, délégation sobre, consolidation, arbitrages et demandes d’approbation. Utiliser pour toute demande transversale ou décision nécessitant plusieurs profils."
tags: [oasis, coordination, délégation, approbation]
related_skills: [oasis-document-studio, oasis-reporting]
---

# Coordination OASIS-V2

1. Clarifier le livrable, le destinataire, la période, les sources disponibles et la décision attendue avant toute délégation.
2. Si la demande contient « sans déléguer », « sans worker » ou une interdiction équivalente, **ne pas appeler l’outil de délégation**, ne pas créer de worker et effectuer uniquement les appels File et MCP du coordonnateur. Ne jamais affirmer que ces outils ne sont disponibles que dans les workers.
3. Les documents communs sont hors du workspace privé : pour `File List`, `File Read` ou `File Write`, employer le chemin absolu `/data/shared-workspace/<chemin-relatif>`. Ainsi, l’inbox est `/data/shared-workspace/01_sources/00_inbox`. Ne jamais chercher cette arborescence dans `/data/agents/<agent_id>/workspace/`.
4. Pour une recherche documentaire minimale, appeler d’abord `File List` sur l’inbox demandée, puis `oasis_shared_memory_search_shared_memory` avec une requête courte. Si l’outil indique une mémoire vide, le dire; si un chemin partagé est absent, le signaler sans deviner d’autre racine ni lancer de worker.
5. Découper par résultat vérifiable, non par étape interne. Ne déléguer que les analyses qui nécessitent une spécialité distincte; un maximum de trois demandes parallèles sans justification.
6. Lorsqu’un utilisateur désigne un agent lié par son identifiant ou son rôle — par exemple `oasis-pse-sig`, analyste financier ou planificateur — appeler **immédiatement** `send_agent_message` vers cet agent. Ne jamais remplacer cette délégation par une lecture locale, une branche ou un worker du coordonnateur; le message de délégation devient une tâche Ready auditée et attribuée à l’agent spécialiste.
7. Pour chaque demande déléguée, donner les chemins classés, la question précise, le format de retour, l’échéance, le niveau de concision et les critères de validation. Ne créer aucun worker dans le mandat délégué sauf nécessité explicitement justifiée par l’agent destinataire.
8. Après avoir délégué, ne jamais appeler `wait`, `echo`, `sleep`, `poll` ou tout autre pseudo-outil de suivi. Le résultat de tâche est relayé automatiquement dans la conversation d’origine lorsqu’il est disponible. Entre-temps, répondre en texte clair que la tâche est attribuée; utiliser `Set Status` seulement si cet outil est réellement proposé. Ne pas inventer une attente active ni une commande de suivi.
9. Consolider les résultats injectés en distinguant fait, analyse, risque, écart, hypothèse et décision à approuver. Conclure les conversations interagents dès que leur objectif est atteint.
10. Préparer les documents finaux avec l’atelier documentaire et placer tout engagement ou transmission dans le statut `pending_approval`.
