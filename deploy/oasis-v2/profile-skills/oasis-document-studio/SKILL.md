---
name: oasis-document-studio
description: Production professionnelle de documents OASIS en DOCX et PDF : brief, rédaction structurée, rendu local, aperçu visuel et contrôle qualité. Utiliser pour tout rapport, note, PV, tableau de synthèse ou livrable destiné à une diffusion.
tags: [oasis, document, docx, pdf, qualité, rendu]
related_skills: [oasis-reporting, oasis-financial-control, oasis-pse-sig]
---

# Atelier documentaire OASIS

## Produire un livrable fini

Pour tout document important, suivre impérativement cette séquence :

1. Créer un manifeste avec `create_document_brief` : objectif, destinataire, sections, sources et formats attendus.
2. Rédiger un brouillon Markdown cohérent dans `livrables/brouillons/`. Utiliser des titres hiérarchisés, des tableaux pour les résultats, et des références de source vérifiables.
3. Ne jamais inventer un montant, une date, une décision, une superficie ou un résultat. Utiliser `À valider` et consigner l’information manquante dans la mémoire commune.
4. Appeler `render_markdown_document` pour créer le DOCX et/ou le PDF avec la charte OASIS. Le rendu est réalisé localement par Pandoc et LibreOffice; le document source n’est pas transmis à un moteur de rendu externe.
5. Appeler `check_document_quality`. Corriger tout avertissement avant de présenter le livrable comme prêt.
6. Appeler `render_document_preview` et examiner visuellement au minimum la page titre, les tableaux larges, les pages contenant figures ou images, et la dernière page.
7. Enregistrer dans la mémoire partagée le chemin du livrable, les sources, la version, le résultat du contrôle qualité et le statut d’approbation.

## Règles de qualité

Utiliser une page titre explicite, une hiérarchie de titres nette, un français administratif, des tableaux lisibles et des conclusions qui distinguent faits, analyse et décisions attendues. Placer chaque tableau ou figure près de sa première mention. Préserver les coordonnées, identifiants de convention et pièces de preuve. Pour une diffusion officielle, indiquer le statut `pending_approval` jusqu’à l’approbation humaine.

## Utiliser le bon modèle

Le modèle de raisonnement est réservé aux plans de rapport, arbitrages et synthèses complexes. Le modèle de travail économique traite les extractions, tableaux, versions intermédiaires et contrôles de cohérence. Le modèle multimodal n’est utilisé qu’en cas de PDF scanné, plan ou visuel difficile à lire. Le modèle ne remplace pas le contrôle déterministe ni la revue visuelle.

## Sortie attendue

Présenter le lien ou chemin vers le DOCX/PDF, l’état du contrôle qualité, les sources principales, les limites connues et la personne dont l’approbation est nécessaire. Ne jamais prétendre qu’un document a été transmis ou approuvé sans confirmation explicite.
