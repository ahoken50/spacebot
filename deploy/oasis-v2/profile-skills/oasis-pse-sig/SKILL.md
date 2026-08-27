---
name: oasis-pse-sig
description: Plan de suivi et d’évaluation OASIS-V2, calculs SIG KML, indicateurs d’infrastructures vertes et vulnérabilité aux vagues de chaleur. Utiliser pour le PSE, les superficies, les résultats et les validations géospatiales.
tags: [oasis, pse, sig, kml, indicateurs, chaleur]
related_skills: [oasis-reporting, oasis-schedule-governance]
---

# PSE et SIG OASIS-V2

## Utiliser les sources de référence

Commencer par lire le PSE fourni, la convention, le rapport final du 21 mai 2026, le KML et la méthode de l’indicateur de population. Utiliser `PSE_OASIS_V2_brouillon.docx` et `Calculs_SIG_PSE_OASIS_V2.xlsx` comme documents de travail. Conserver la donnée de conception, la mesure SIG et la mesure de récolement comme trois niveaux distincts.

Les valeurs initiales documentées sont **1,41 ha** d’infrastructures vertes planifiées, **398 arbres proposés** et **3 599 m³** de rétention quantitative estimée. Elles doivent rester identifiées comme des cibles de conception tant qu’elles ne sont pas validées par plans définitifs et récolement.

## Calculer les superficies du KML

1. Lire le KML **sur place** — ne jamais le déplacer ni le renommer. Le chemin de référence actuel est `/data/shared-workspace/04_pse_sig/02_kml_geojson/KML_OASIS-V2_Val-dOr.kml`.
2. Pour un outil MCP SIG, fournir de préférence le chemin **relatif** `04_pse_sig/02_kml_geojson/KML_OASIS-V2_Val-dOr.kml`. Le chemin absolu sous `/data/shared-workspace/` est aussi accepté par le MCP OASIS et est remappé strictement vers son volume de travail; aucun autre chemin absolu n’est permis.
3. Utiliser `oasis_gis_local_inspect_kml` pour dresser l’inventaire local des objets, noms, surfaces brutes et erreurs de lecture, puis `oasis_gis_local_export_kml_geojson` pour produire une copie GeoJSON de travail dans `04_pse_sig/02_kml_geojson/`; le KML et le GeoJSON restent sur la machine locale.
4. Créer ou importer les emprises polygonales nommées `P1`, `P2` et `P3` dans un GeoJSON. Le KML brut ne suffit pas pour attribuer tous les objets techniques aux trois projets.
5. Utiliser `oasis_gis_local_project_surface_analysis` avec les emprises validées; il calcule les intersections géodésiques et produit un GeoJSON de contrôle.
6. Dans un SIG municipal, classer les objets par type, dissoudre les surfaces d’un même type et éliminer les doublons ou chevauchements avant d’établir une valeur finale.
7. Documenter les règles de classification, les formules, les captures et une contre-vérification. Inscrire le résultat dans `Calculs_SIG_PSE_OASIS_V2.xlsx` et dans la mémoire partagée avec son statut de validation.

## Calculer l’indicateur de vulnérabilité

N’utiliser que les aires de diffusion classées « forte » ou « très forte » dans la cartographie de vulnérabilité. Définir les rayons d’impact selon le type et la taille de chaque infrastructure; fusionner les rayons d’une même aire pour éviter les chevauchements; calculer `(surface des rayons ÷ surface de l’aire) × population de l’aire`, puis additionner les estimations. Présenter le résultat comme une **estimation**, sans prétendre dénombrer des personnes individuelles.

Les données manquantes — aire de diffusion, classe de vulnérabilité, population et emprises validées — sont des prérequis, non des données à inventer.

## Préparer les mises à jour de PSE

Pour chaque indicateur, consigner la cible, la donnée de base, la source, la période, la valeur atteinte, la méthode, le responsable et une explication d’écart. Mettre à jour le PSE avant chaque rapport d’étape et au rapport final. Préserver les sources de données et les versions précédentes.

## Sortie attendue

Présenter les résultats dans un tableau : indicateur, unité, donnée de base, cible, valeur, niveau de validation, source, méthode, limite et prochaine action. Signaler toute valeur qui ne peut pas être validée avec les fichiers disponibles.
