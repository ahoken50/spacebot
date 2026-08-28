---
name: oasis-document-studio
description: "Production professionnelle de documents OASIS en DOCX et PDF : brief, rédaction structurée, rendu local, aperçu visuel et contrôle qualité. Utiliser pour tout rapport, note, PV, tableau de synthèse ou livrable destiné à une diffusion."
tags: [oasis, document, docx, pdf, qualité, rendu]
related_skills: [oasis-reporting, oasis-financial-control, oasis-pse-sig]
---

# Atelier documentaire OASIS

## Produire un livrable fini

Pour tout document important, suivre impérativement cette séquence :

1. Si le mandat indique **lecture seule**, lire les sources avec l’outil File et employer seulement les MCP de lecture ou de rendu applicables. Ne jamais appeler `oasis_document_studio_classify_workspace_document`, renommer, déplacer ou supprimer une source; créer uniquement le brouillon explicitement demandé.
2. Pour les MCP Document Studio, préférer un chemin **relatif** à l’espace documentaire, par exemple `01_sources/00_inbox/fichier.docx` ou `07_livrables/01_brouillons/note.md`. Le chemin absolu `/data/shared-workspace/<chemin-relatif>` est aussi reconnu par le MCP OASIS et remappé strictement vers son volume documentaire; aucun autre chemin absolu n’est permis.
3. Créer un manifeste avec `oasis_document_studio_create_document_brief` : objectif, destinataire, sections, sources et formats attendus, sauf lorsqu’un mandat ne demande qu’une analyse Markdown intermédiaire.
4. Rédiger un brouillon Markdown cohérent dans `07_livrables/01_brouillons/` ou dans le dossier explicitement demandé. Utiliser des titres hiérarchisés, des tableaux pour les résultats, et des références de source vérifiables.
5. Ne jamais inventer un montant, une date, une décision, une superficie ou un résultat. Utiliser `À valider` et consigner l’information manquante dans la mémoire commune avec `oasis_shared_memory_save_shared_record`.
6. Appeler `oasis_document_studio_render_markdown_document` pour créer le DOCX et/ou le PDF avec la charte OASIS lorsque ces formats sont demandés. Le rendu est réalisé localement par Pandoc et LibreOffice; le document source n’est pas transmis à un moteur de rendu externe.
7. Appeler `oasis_document_studio_check_document_quality`. Corriger tout avertissement avant de présenter le livrable comme prêt.
8. Appeler `oasis_document_studio_render_document_preview` et examiner visuellement au minimum la page titre, les tableaux larges, les pages contenant figures ou images, et la dernière page.
9. Enregistrer dans la mémoire partagée le chemin relatif du livrable, les sources, la version, le résultat du contrôle qualité et le statut d’approbation.

## Règles de qualité

Utiliser une page titre explicite, une hiérarchie de titres nette, un français administratif, des tableaux lisibles et des conclusions qui distinguent faits, analyse et décisions attendues. Placer chaque tableau ou figure près de sa première mention. Préserver les coordonnées, identifiants de convention et pièces de preuve. Pour une diffusion officielle, indiquer le statut `pending_approval` jusqu’à l’approbation humaine.

## Utiliser le bon modèle

Le modèle de raisonnement est réservé aux plans de rapport, arbitrages et synthèses complexes. Le modèle de travail économique traite les extractions, tableaux, versions intermédiaires et contrôles de cohérence. Le modèle multimodal n’est utilisé qu’en cas de PDF scanné, plan ou visuel difficile à lire. Le modèle ne remplace pas le contrôle déterministe ni la revue visuelle.

## Sortie attendue

Présenter le lien ou chemin vers le DOCX/PDF, l’état du contrôle qualité, les sources principales, les limites connues et la personne dont l’approbation est nécessaire. Ne jamais prétendre qu’un document a été transmis ou approuvé sans confirmation explicite.
