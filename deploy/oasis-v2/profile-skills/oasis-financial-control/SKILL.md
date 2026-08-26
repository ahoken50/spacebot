---
name: oasis-financial-control
description: Suivi financier et contrôle des dépenses OASIS-V2. Utiliser pour budget, dépenses, salaires, contrats, appels d’offres, admissibilité, rapprochements et états financiers de reddition.
tags: [oasis, finances, subvention, reddition]
related_skills: [oasis-reporting, oasis-schedule-governance]
---

# Suivi financier OASIS-V2

## Préparer le contrôle

1. Consulter d’abord la convention, le budget approuvé et le registre partagé avec `oasis_shared_memory_search_shared_memory`.
2. Distinguer explicitement **prévision**, **engagement**, **dépense payée**, **part OASIS**, **part Ville/autres** et **admissibilité**.
3. Enregistrer chaque constat vérifiable avec `oasis_shared_memory_save_shared_record`, en indiquant les noms de fichiers, les onglets, les numéros de pièces et le statut de validation.

## Gérer les transactions

Utiliser le classeur `Suivi_financier_OASIS_V2.xlsx` comme registre de travail. Exiger pour chaque ligne la date, la pièce justificative, le fournisseur ou employé, le code budgétaire, le projet, les montants avant taxes et taxes, la source de financement, le statut et le lien vers la preuve de paiement.

Ne jamais classer une dépense comme admissible en l’absence d’une pièce suffisante. Utiliser `À valider` quand l’information est incomplète et préciser ce qui manque. Lorsqu’une dépense ou décision a une incidence contractuelle, l’enregistrer avec le statut `pending_approval` dans le registre commun.

## Vérifier les limites de la convention

Contrôler au minimum la limite globale de l’aide OASIS et les règles configurées dans l’onglet `Contrôle admissibilité` : dépenses techniques, communication, administration, décontamination, renforcement structural et aménagements complémentaires. Présenter les écarts en montant, en pourcentage et avec une action proposée. Ne considérer un seuil conforme qu’après validation humaine.

## Préparer la reddition financière

Avant un rapport d’étape ou final, rapprocher les factures, paies, contrats, appels d’offres et preuves de paiement. Produire une liste des exceptions, pièces manquantes, dépenses non admissibles, dépenses à valider et écarts par poste budgétaire. Lier la synthèse au rapport correspondant et transmettre les constats au profil de reddition.

## Sortie attendue

Présenter une synthèse courte, suivie d’un tableau : poste budgétaire, budget, engagé, payé, financement OASIS, écart, statut de preuve, risque et responsable. Citer la source de chaque constat important.
