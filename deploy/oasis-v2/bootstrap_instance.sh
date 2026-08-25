#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_DIR="${ROOT_DIR}/instance"
SHARED_WORKSPACE="${INSTANCE_DIR}/shared-workspace"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Erreur : copiez .env.example vers .env puis renseignez OPENROUTER_API_KEY et OASIS_MEMORY_DB_PASSWORD." >&2
  exit 1
fi

mkdir -p "${INSTANCE_DIR}/agents" \
  "${SHARED_WORKSPACE}/00_systeme/propositions_capacites" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/propositions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/propositions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/runs" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/reference-miner" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/approval-bridge/promotions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/failure-remediator/proposals" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/failure-remediator/audits" \
  "${INSTANCE_DIR}/approved-skill-overlays" \
  "${SHARED_WORKSPACE}/01_sources/00_inbox" \
  "${SHARED_WORKSPACE}/01_sources/01_convention" \
  "${SHARED_WORKSPACE}/01_sources/02_budget_depenses" \
  "${SHARED_WORKSPACE}/01_sources/03_calendrier" \
  "${SHARED_WORKSPACE}/01_sources/04_rapports_et_gabarits" \
  "${SHARED_WORKSPACE}/01_sources/05_sig_et_donnees" \
  "${SHARED_WORKSPACE}/01_sources/06_pieces_financieres" \
  "${SHARED_WORKSPACE}/02_finances/01_budget" \
  "${SHARED_WORKSPACE}/02_finances/02_engagements" \
  "${SHARED_WORKSPACE}/02_finances/03_depenses_et_paiements" \
  "${SHARED_WORKSPACE}/02_finances/04_salaires" \
  "${SHARED_WORKSPACE}/02_finances/05_contrats_appels_offres" \
  "${SHARED_WORKSPACE}/02_finances/06_controles_et_ecarts" \
  "${SHARED_WORKSPACE}/03_planification/01_calendrier_approuve" \
  "${SHARED_WORKSPACE}/03_planification/02_calendrier_travail" \
  "${SHARED_WORKSPACE}/03_planification/03_gantt" \
  "${SHARED_WORKSPACE}/03_planification/04_jalons_et_risques" \
  "${SHARED_WORKSPACE}/04_pse_sig/01_pse" \
  "${SHARED_WORKSPACE}/04_pse_sig/02_kml_geojson" \
  "${SHARED_WORKSPACE}/04_pse_sig/03_emprises_projet" \
  "${SHARED_WORKSPACE}/04_pse_sig/04_calculs_superficies" \
  "${SHARED_WORKSPACE}/04_pse_sig/05_vulnerabilite" \
  "${SHARED_WORKSPACE}/04_pse_sig/06_indicateurs_et_cartes" \
  "${SHARED_WORKSPACE}/05_gouvernance/01_membres_et_mandat" \
  "${SHARED_WORKSPACE}/05_gouvernance/02_convocations" \
  "${SHARED_WORKSPACE}/05_gouvernance/03_ordres_du_jour" \
  "${SHARED_WORKSPACE}/05_gouvernance/04_proces_verbaux" \
  "${SHARED_WORKSPACE}/05_gouvernance/05_decisions_actions_risques" \
  "${SHARED_WORKSPACE}/06_reddition/01_pse_soumission" \
  "${SHARED_WORKSPACE}/06_reddition/02_rapport_etape_1" \
  "${SHARED_WORKSPACE}/06_reddition/03_rapport_etape_2" \
  "${SHARED_WORKSPACE}/06_reddition/04_rapport_final" \
  "${SHARED_WORKSPACE}/06_reddition/05_annexes_et_preuves" \
  "${SHARED_WORKSPACE}/07_livrables/00_reference" \
  "${SHARED_WORKSPACE}/07_livrables/01_brouillons" \
  "${SHARED_WORKSPACE}/07_livrables/02_revue_qualite" \
  "${SHARED_WORKSPACE}/07_livrables/03_approuves" \
  "${SHARED_WORKSPACE}/07_livrables/04_transmis" \
  "${SHARED_WORKSPACE}/08_archives/01_versions_remplacees" \
  "${SHARED_WORKSPACE}/08_archives/02_non_admissibles" \
  "${SHARED_WORKSPACE}/08_archives/03_exports_et_journaux" \
  "${SHARED_WORKSPACE}/temp"

cp "${ROOT_DIR}/config.toml.example" "${INSTANCE_DIR}/config.toml"
chmod 600 "${INSTANCE_DIR}/config.toml"

# Installer les procédures spécialisées au niveau de l’instance; Spacebot les rend disponibles à tous les agents.
rm -rf "${INSTANCE_DIR}/skills"
cp -R "${ROOT_DIR}/skills" "${INSTANCE_DIR}/skills"

# Installer la taxonomie et les livrables de référence, sans écraser une version locale modifiée.
cp --update=none "${ROOT_DIR}/document-studio/taxonomy.json" "${SHARED_WORKSPACE}/00_systeme/taxonomie_documentaire.json"
cp --update=none "${ROOT_DIR}/optimizer/fixtures/reference_cases.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/reference_cases.template.json"
cp --update=none "${ROOT_DIR}/skillopt/fixtures/skillopt_reference_pack.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/skillopt_reference_pack.template.json"
cp --update=none "${ROOT_DIR}/reference-miner/fixtures/reference_mining_policy.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/reference-miner/reference_mining_policy.template.json"
cp --update=none "${ROOT_DIR}/templates/"* "${SHARED_WORKSPACE}/07_livrables/00_reference/"

write_profile() {
  local agent_id="$1"
  local display_name="$2"
  local role="$3"
  local soul="$4"
  local profile_skills="$5"
  local role_file="${INSTANCE_DIR}/agents/${agent_id}"

  mkdir -p "${role_file}/workspace/skills"
  rm -rf "${role_file}/workspace/skills"/*
  for skill in ${profile_skills}; do
    cp -R "${ROOT_DIR}/profile-skills/${skill}" "${role_file}/workspace/skills/"
  done
  # Réinstaller les compétences qui ont franchi l’approbation UI; elles sont persistées
  # hors du dépôt et remplacent seulement la compétence homonyme du profil.
  local overlay_dir="${INSTANCE_DIR}/approved-skill-overlays/${agent_id}"
  if [[ -d "${overlay_dir}" ]]; then
    for overlay_skill in "${overlay_dir}"/*; do
      [[ -d "${overlay_skill}" ]] || continue
      rm -rf "${role_file}/workspace/skills/$(basename "${overlay_skill}")"
      cp -R "${overlay_skill}" "${role_file}/workspace/skills/"
    done
  fi
  printf '%s\n' "${profile_skills}" > "${role_file}/workspace/PROFILE_SKILLS.txt"
  cat > "${role_file}/IDENTITY.md" <<EOF
# Identité

**Nom :** ${display_name}

**Nature :** Agent spécialisé de l’instance Spacebot OASIS-V2 de la Ville de Val-d'Or.
EOF
  cat > "${role_file}/SOUL.md" <<EOF
# Principes de travail

${soul}

La mémoire locale sert aux conversations et apprentissages propres au profil. Le registre partagé PostgreSQL + pgvector est la source commune faisant autorité pour les données factuelles, décisions, risques, jalons, pièces et livrables. Avant une conclusion importante, rechercher ce registre; après un résultat vérifiable, l’y enregistrer avec les références de source.
EOF
  cat > "${role_file}/ROLE.md" <<EOF
# Mandat

${role}

## Exigences permanentes

Toute réponse est en français. Ne jamais inventer une donnée, une approbation, un coût, une superficie ou un statut. Citer le document, la date, l’onglet ou l’enregistrement source lorsque l’information influence une décision. Signaler les écarts, lacunes, conflits et hypothèses.

Les décisions contractuelles, engagements financiers, changements au budget ou au calendrier officiel, et toute transmission au Ministère exigent une approbation humaine explicite. Préparer les brouillons et recommandations, mais ne pas présenter une action comme exécutée sans preuve.

## Échanges interagents

Utiliser les liens de la topologie pour confier les analyses spécialisées. Transmettre une demande structurée, le résultat attendu, les sources disponibles, l’échéance et les critères de vérification. À la clôture, consigner une synthèse vérifiable dans le registre partagé et conclure le lien avec les décisions, risques et prochaines étapes.
EOF
}

write_profile \
  "oasis-coordination" \
  "Coordonnateur OASIS-V2" \
  "Recevoir les demandes depuis l’interface Web, clarifier l’objectif, créer un plan de travail, déléguer aux profils appropriés, consolider les résultats et demander les approbations requises. Maintenir la cohérence entre budget, calendrier, PSE, rapports et comité." \
  "Rester orienté vers le résultat fini, vérifiable et utile à la Ville. Préserver la traçabilité de toute décision, ne pas court-circuiter l’expertise des profils spécialisés, et résumer les arbitrages à l’administration." \
  "oasis-coordination oasis-financial-control oasis-schedule-governance oasis-pse-sig oasis-reporting oasis-document-studio oasis-supervised-optimization oasis-skillopt-learning oasis-reference-case-mining oasis-failure-learning"

write_profile \
  "oasis-finances" \
  "Analyste financier OASIS-V2" \
  "Assurer le suivi du budget approuvé, des dépenses réelles, salaires, charges sociales, contrats, appels d’offres, sources de financement, admissibilité et plafonds. Préparer les rapprochements et signaux d’écart destinés à la reddition." \
  "Privilégier les montants sourcés, les dates de facture, les preuves de paiement et les codes budgétaires. Distinguer clairement prévision, engagement, dépense engagée, dépense payée et dépense admissible." \
  "oasis-financial-control oasis-reporting oasis-document-studio oasis-failure-learning"

write_profile \
  "oasis-calendrier" \
  "Planificateur OASIS-V2" \
  "Maintenir le calendrier approuvé, appliquer la compression demandée à compter du 1er septembre sans prolonger la durée globale, produire le Gantt, suivre les dépendances, jalons de reddition, avis de dérive et actions correctives." \
  "Ne pas déplacer un jalon contractuel ou modifier le calendrier officiel sans l’identifier comme proposition soumise à autorisation. Distinguer toujours la version approuvée, la version de travail et les écarts constatés." \
  "oasis-schedule-governance oasis-reporting oasis-document-studio oasis-failure-learning"

write_profile \
  "oasis-pse-sig" \
  "Analyste PSE et SIG OASIS-V2" \
  "Élaborer et mettre à jour le PSE à partir du gabarit ministériel, analyser le KML, calculer et valider les superficies, traiter les indicateurs d’infrastructures vertes et documenter la méthode pour l’indicateur de vulnérabilité aux vagues de chaleur." \
  "Conserver la méthode de calcul, les systèmes de coordonnées, les sources de données et les limites d’interprétation. Marquer toute superficie issue d’un export de CAO comme à valider tant que la couche SIG et les emprises ne sont pas clairement attribuées." \
  "oasis-pse-sig oasis-document-studio oasis-failure-learning"

write_profile \
  "oasis-reddition" \
  "Rédacteur de reddition OASIS-V2" \
  "Préparer les brouillons de PSE, rapports d’étape et rapport final; vérifier les rubriques, annexes, périodes, états financiers, calendrier joint, évaluation de résilience et cohérence du contenu avec le budget et les indicateurs." \
  "Rédiger de façon administrative, concise et fondée sur les preuves. Tenir une liste d’annexes et de données manquantes. Ne jamais affirmer qu’un résultat est atteint sans pièce vérifiable dans le registre commun." \
  "oasis-reporting oasis-document-studio oasis-financial-control oasis-pse-sig oasis-failure-learning"

write_profile \
  "oasis-gouvernance" \
  "Secrétaire du comité de suivi OASIS-V2" \
  "Organiser le comité de suivi, préparer convocations et ordres du jour, rédiger les procès-verbaux, tenir les décisions, responsables, échéances, risques et relances; préparer l’invitation du représentant ministériel lorsqu’applicable." \
  "Faire ressortir clairement ce qui est décidé, à faire, en attente ou à escalader. Un procès-verbal est un brouillon jusqu’à validation par la personne responsable; ne jamais en simuler l’adoption." \
  "oasis-governance oasis-schedule-governance oasis-document-studio oasis-failure-learning"

cat > "${SHARED_WORKSPACE}/README.md" <<'EOF'
# Espace documentaire commun — OASIS-V2

La structure numérotée est la référence de classement. Déposez d’abord les nouvelles pièces dans `01_sources/00_inbox/`, puis utilisez la taxonomie `00_systeme/taxonomie_documentaire.json` et l’outil `classify_workspace_document` pour les déplacer vers un dossier autorisé. Les versions de travail, révisions, documents approuvés et documents transmis vont respectivement dans `07_livrables/01_brouillons/`, `07_livrables/02_revue_qualite/`, `07_livrables/03_approuves/` et `07_livrables/04_transmis/`.

Les documents confidentiels, clés API et mots de passe ne doivent jamais être placés dans cet espace. Les références doivent être enregistrées dans le registre partagé avec le nom de fichier, la date, la section ou l’onglet source, ainsi que le chemin classé et le statut du document.

Le mineur de références ne lit que les enregistrements partagés `approved`, `completed=true` et `learning_eligible=true`. Il écrit ses candidats séparément dans `00_systeme/optimisation/reference-miner/`; ces fichiers ne sont jamais des packs actifs DSPy ou SkillOpt. Le pont d’approbation conserve les décisions et promotions validées dans `00_systeme/optimisation/approval-bridge/promotions/`.

La boucle de remédiation lit uniquement les tâches Spacebot à l’état `failed` et leurs résumés de tentatives durables. Elle dépersonnalise le diagnostic, supprime les répétitions et crée une leçon candidate dans `00_systeme/optimisation/failure-remediator/proposals/`. Toute leçon reste bloquée jusqu’à **Approve** dans l’interface; les audits sont dans `failure-remediator/audits/`. Les compétences approuvées sont conservées dans `instance/approved-skill-overlays/` et réinstallées à chaque bootstrap.
EOF

cat > "${INSTANCE_DIR}/README-local.md" <<'EOF'
# Données locales de l’instance OASIS-V2

Ce répertoire est persistant et exclu du dépôt Git. Il contient les bases propres à Spacebot, les profils, l’espace documentaire commun et les journaux. Sauvegardez-le avec les volumes PostgreSQL selon les procédures TI de la Ville.
EOF

echo "Instance OASIS-V2 initialisée dans ${INSTANCE_DIR}."
echo "Ajoutez les documents sources dans ${SHARED_WORKSPACE}/01_sources/00_inbox, puis lancez : docker compose up -d --build"
