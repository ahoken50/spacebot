---
name: project-analysis
description: Analyse de données, indicateurs, méthodes reproductibles et géomatique facultative. Utiliser pour calculer, valider et documenter des résultats de projets municipaux ou de recherche.
tags: [projet, données, analyse, indicateurs, géomatique, kml, méthodes]
related_skills: [project-reporting, project-planning-governance]
---

# Analyse de données et géomatique

## Préparer une analyse vérifiable

1. Définir la question, l’unité, la période, la population ou le territoire, les sources et le niveau de précision attendu.
2. Inventorier les fichiers disponibles; ne pas déduire une variable absente ni remplacer une preuve par une hypothèse.
3. Conserver un jeu de données de travail, la méthode, les paramètres, les calculs, les limites et la date de production.
4. Produire un résultat reproductible : tableau source, script local ou étapes de calcul clairement décrites.

## Traiter des données géospatiales lorsque nécessaire

1. Utiliser `inspect_kml` pour inventorier un KML ou `export_kml_geojson` pour créer une copie GeoJSON locale de travail.
2. Définir explicitement les emprises, couches, unités et système de coordonnées utilisés avant un calcul de superficie ou de distance.
3. Utiliser `project_surface_analysis` seulement avec des polygones d’emprise validés; vérifier les chevauchements, doublons et objets hors périmètre.
4. Marquer tout résultat géospatial `à valider` lorsque la donnée source, l’emprise ou le référentiel spatial est incomplet.

## Construire des indicateurs

Pour chaque indicateur, consigner : définition, unité, valeur de référence, cible s’il y en a une, valeur observée, période, méthode, source, niveau de validation, limites et prochaine action. Distinguer une mesure, une estimation, une projection et une cible.

## Sortie attendue

Présenter un tableau avec : question, indicateur ou calcul, résultat, unité, source, méthode, niveau de validation, limite et recommandation. Enregistrer la synthèse vérifiable dans le registre partagé; ne jamais présenter un résultat technique comme une décision officielle sans validation humaine.
