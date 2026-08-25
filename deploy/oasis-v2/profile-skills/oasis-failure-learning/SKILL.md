---
name: oasis-failure-learning
description: Prévenir la répétition des échecs de tâche OASIS. Utiliser lorsqu’une action échoue, est bloquée, dépasse son délai, manque d’outil, de compétence, de MCP ou de contexte.
---

# Remédiation des échecs OASIS

## Réaction immédiate

1. Ne pas répéter une tentative identique. Lire l’historique de tâche, les préconditions, les compétences chargées et les outils ou MCP déjà disponibles.
2. Isoler une seule cause probable : **outil ou MCP indisponible**, **compétence absente**, **objectif ou contexte insuffisant**, **délai ou portée excessive**, ou **autre échec d’exécution**.
3. Terminer la tentative avec un résumé court, concret et dépersonnalisé. Nommer la capacité recherchée, l’action tentée, l’erreur observée et la prochaine vérification. Ne jamais inclure de clé, renseignement personnel, montant, document brut ou transcription complète.
4. Laisser la tâche en échec ou en blocage tant qu’un plan modifié n’est pas disponible. Ne pas la remettre à `ready` pour contourner l’analyse.

## Réemploi d’une leçon approuvée

Avant une reprise, consulter les compétences du profil, notamment `oasis-failure-lessons` lorsqu’elle existe. Appliquer seulement une leçon dont la catégorie et les préconditions correspondent réellement au cas en cours. Indiquer dans le nouveau plan ce qui diffère de la tentative échouée.

## Limites impératives

Ne jamais installer un outil, créer ou modifier un MCP, modifier Docker, les modèles, les permissions ou la configuration pour résoudre un échec. Si une capacité est absente, documenter le besoin minimal et attendre une proposition puis l’approbation dans l’interface Spacebot. La boucle autonome peut diagnostiquer, dédupliquer, préparer une leçon candidate et créer une tâche d’approbation; elle ne peut pas promouvoir ni relancer automatiquement une tâche ayant échoué.
