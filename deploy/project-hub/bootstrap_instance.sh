#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_DIR="${ROOT_DIR}/instance"
SHARED_WORKSPACE="${INSTANCE_DIR}/shared-workspace"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Erreur : copiez .env.example vers .env puis renseignez OPENROUTER_API_KEY et PROJECT_HUB_MEMORY_DB_PASSWORD." >&2
  exit 1
fi

mkdir -p \
  "${INSTANCE_DIR}/agents" \
  "${INSTANCE_DIR}/approved-skill-overlays" \
  "${INSTANCE_DIR}/skill-install-authorizations" \
  "${SHARED_WORKSPACE}/00_systeme/propositions_capacites" \
  "${SHARED_WORKSPACE}/00_systeme/scripts" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/propositions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/propositions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/runs" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/reference-miner" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/approval-bridge/promotions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/failure-remediator/proposals" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/failure-remediator/audits" \
  "${SHARED_WORKSPACE}/01_sources/00_inbox" \
  "${SHARED_WORKSPACE}/01_sources/01_cadre_reference" \
  "${SHARED_WORKSPACE}/01_sources/02_donnees_et_resultats" \
  "${SHARED_WORKSPACE}/01_sources/03_documents_administratifs" \
  "${SHARED_WORKSPACE}/01_sources/04_donnees_geospatiales" \
  "${SHARED_WORKSPACE}/02_finances/01_budget" \
  "${SHARED_WORKSPACE}/02_finances/02_engagements" \
  "${SHARED_WORKSPACE}/02_finances/03_depenses" \
  "${SHARED_WORKSPACE}/02_finances/04_contrats_approvisionnement" \
  "${SHARED_WORKSPACE}/02_finances/05_controles_ecarts" \
  "${SHARED_WORKSPACE}/03_planification/01_cadre_approuve" \
  "${SHARED_WORKSPACE}/03_planification/02_plan_travail" \
  "${SHARED_WORKSPACE}/03_planification/03_gantt" \
  "${SHARED_WORKSPACE}/03_planification/04_jalons_risques" \
  "${SHARED_WORKSPACE}/04_analyse/01_methodes" \
  "${SHARED_WORKSPACE}/04_analyse/02_donnees" \
  "${SHARED_WORKSPACE}/04_analyse/03_geospatiale" \
  "${SHARED_WORKSPACE}/04_analyse/04_indicateurs" \
  "${SHARED_WORKSPACE}/04_analyse/05_calculs_reproductibles" \
  "${SHARED_WORKSPACE}/05_gouvernance/01_mandat_parties_prenantes" \
  "${SHARED_WORKSPACE}/05_gouvernance/02_convocations" \
  "${SHARED_WORKSPACE}/05_gouvernance/03_ordres_du_jour" \
  "${SHARED_WORKSPACE}/05_gouvernance/04_proces_verbaux" \
  "${SHARED_WORKSPACE}/05_gouvernance/05_decisions_actions_risques" \
  "${SHARED_WORKSPACE}/06_rapports_et_syntheses/01_notes" \
  "${SHARED_WORKSPACE}/06_rapports_et_syntheses/02_rapports_intermediaires" \
  "${SHARED_WORKSPACE}/06_rapports_et_syntheses/03_rapport_final" \
  "${SHARED_WORKSPACE}/06_rapports_et_syntheses/04_annexes_preuves" \
  "${SHARED_WORKSPACE}/07_livrables/00_reference" \
  "${SHARED_WORKSPACE}/07_livrables/01_brouillons" \
  "${SHARED_WORKSPACE}/07_livrables/02_revue_qualite" \
  "${SHARED_WORKSPACE}/07_livrables/03_approuves" \
  "${SHARED_WORKSPACE}/07_livrables/04_transmis" \
  "${SHARED_WORKSPACE}/08_archives/01_versions_remplacees" \
  "${SHARED_WORKSPACE}/08_archives/02_non_admissibles" \
  "${SHARED_WORKSPACE}/08_archives/03_exports_journaux" \
  "${SHARED_WORKSPACE}/temp"

cp "${ROOT_DIR}/config.toml.example" "${INSTANCE_DIR}/config.toml"
chmod 600 "${INSTANCE_DIR}/config.toml"

rm -rf "${INSTANCE_DIR}/skills"
cp -R "${ROOT_DIR}/skills" "${INSTANCE_DIR}/skills"
cp --update=none "${ROOT_DIR}/document-studio/taxonomy.json" "${SHARED_WORKSPACE}/00_systeme/taxonomie_documentaire.json"
cp --update=none "${ROOT_DIR}/optimizer/fixtures/reference_cases.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/reference_cases.template.json"
cp --update=none "${ROOT_DIR}/skillopt/fixtures/skillopt_reference_pack.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/skillopt_reference_pack.template.json"
cp --update=none "${ROOT_DIR}/reference-miner/fixtures/reference_mining_policy.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/reference-miner/reference_mining_policy.template.json"

write_profile() {
  local agent_id="$1"
  local display_name="$2"
  local role="$3"
  local soul="$4"
  local profile_skills="$5"
  local role_dir="${INSTANCE_DIR}/agents/${agent_id}"

  mkdir -p "${role_dir}/workspace/skills"
  rm -rf "${role_dir}/workspace/skills"/*
  for skill in ${profile_skills}; do
    cp -R "${ROOT_DIR}/profile-skills/${skill}" "${role_dir}/workspace/skills/"
  done

  local overlay_dir="${INSTANCE_DIR}/approved-skill-overlays/${agent_id}"
  if [[ -d "${overlay_dir}" ]]; then
    for overlay_skill in "${overlay_dir}"/*; do
      [[ -d "${overlay_skill}" ]] || continue
      rm -rf "${role_dir}/workspace/skills/$(basename "${overlay_skill}")"
      cp -R "${overlay_skill}" "${role_dir}/workspace/skills/"
    done
  fi

  printf '%s\n' "${profile_skills}" > "${role_dir}/workspace/PROFILE_SKILLS.txt"
  cat > "${role_dir}/IDENTITY.md" <<EOF
# Identité

**Nom :** ${display_name}

**Nature :** Agent spécialisé de l’instance Spacebot Project Hub.
EOF
  cat > "${role_dir}/SOUL.md" <<EOF
# Principes de travail

${soul}

Utiliser la mémoire locale pour les conversations propres au profil. Utiliser le registre partagé PostgreSQL + pgvector comme source commune des faits, décisions, risques, jalons, sources et livrables vérifiables. Avant une conclusion importante, rechercher ce registre; après un résultat vérifiable, l’y enregistrer avec les références de source.
EOF
  cat > "${role_dir}/ROLE.md" <<EOF
# Mandat

${role}

## Exigences permanentes

Répondre dans la langue de la demande lorsque possible. Ne jamais inventer une donnée, une approbation, un coût, un calcul ou un statut. Citer le document, la date, l’onglet ou l’enregistrement source lorsque l’information influence une décision. Signaler les écarts, lacunes, conflits et hypothèses.

Toute décision institutionnelle, engagement financier, modification officielle de budget ou d’échéancier, publication externe ou transmission de données sensibles exige une approbation humaine explicite. Préparer les brouillons et recommandations, mais ne pas présenter une action comme exécutée sans preuve.

## Échanges interagents

Utiliser les liens de la topologie pour confier les analyses spécialisées. Transmettre une demande structurée, le résultat attendu, les sources disponibles, l’échéance et les critères de vérification. À la clôture, consigner une synthèse vérifiable dans le registre partagé et conclure avec les décisions, risques et prochaines étapes.
EOF
}

write_profile \
  "project-coordination" \
  "Coordonnateur de projet" \
  "Qualifier les demandes, créer le plan de travail, déléguer aux profils appropriés, consolider les résultats et demander les approbations requises." \
  "Rester orienté vers un résultat fini, vérifiable et utile. Préserver la traçabilité des arbitrages, la proportionnalité des efforts et les limites d’autonomie." \
  "project-coordination project-finance-control project-planning-governance project-analysis project-reporting project-document-studio project-supervised-optimization project-skillopt-learning project-reference-case-mining project-failure-learning project-python-workbench"

write_profile \
  "project-finance" \
  "Analyste financier et administratif" \
  "Assurer le suivi du budget, des dépenses, contrats, appels d’offres, sources de financement, admissibilité et écarts. Préparer les rapprochements et alertes." \
  "Privilégier les montants sourcés, les pièces de preuve et la distinction entre prévision, engagement, dépense et paiement." \
  "project-finance-control project-reporting project-document-studio project-failure-learning project-python-workbench"

write_profile \
  "project-planning" \
  "Planificateur de projet" \
  "Maintenir le plan de travail, Gantt, dépendances, jalons, risques, capacité et scénarios de correction." \
  "Distinguer toute version approuvée de toute version de travail. Ne jamais modifier un jalon officiel sans le présenter comme proposition." \
  "project-planning-governance project-reporting project-document-studio project-failure-learning project-python-workbench"

write_profile \
  "project-analysis" \
  "Analyste de données et géomatique" \
  "Traiter les données, produire des indicateurs, documenter les méthodes, utiliser les données géospatiales lorsque pertinentes et préparer des calculs reproductibles." \
  "Conserver les méthodes, unités, systèmes de coordonnées, sources et limites d’interprétation. Marquer tout résultat spatial comme à valider lorsque les données ou emprises sont incomplètes." \
  "project-analysis project-document-studio project-failure-learning project-python-workbench"

write_profile \
  "project-reporting" \
  "Rédacteur et analyste de livrables" \
  "Préparer rapports, notes décisionnelles, synthèses de recherche, annexes et contrôles de qualité rédactionnelle." \
  "Rédiger de façon claire, administrative et fondée sur les preuves. Tenir une liste des sources et données manquantes." \
  "project-reporting project-document-studio project-finance-control project-analysis project-failure-learning project-python-workbench"

write_profile \
  "project-governance" \
  "Secrétaire et analyste de gouvernance" \
  "Organiser les comités, préparer convocations et ordres du jour, rédiger les procès-verbaux, suivre les décisions, responsables, échéances, risques et relances." \
  "Faire ressortir ce qui est décidé, à faire, en attente ou à escalader. Un procès-verbal reste un brouillon jusqu’à validation explicite." \
  "project-governance project-planning-governance project-document-studio project-failure-learning project-python-workbench"

cat > "${SHARED_WORKSPACE}/README.md" <<'EOF'
# Espace documentaire commun — Project Hub

La structure numérotée est la référence de classement. Déposer d’abord les nouvelles pièces dans `01_sources/00_inbox/`, puis utiliser la taxonomie `00_systeme/taxonomie_documentaire.json` et l’outil `classify_workspace_document` pour les déplacer vers un dossier autorisé. Les versions de travail, révisions, documents approuvés et documents transmis vont respectivement dans `07_livrables/01_brouillons/`, `07_livrables/02_revue_qualite/`, `07_livrables/03_approuves/` et `07_livrables/04_transmis/`.

Ne jamais placer de clés API, mots de passe ou documents non autorisés dans cet espace. Enregistrer les références avec leur nom de fichier, date, section ou onglet source, chemin classé et statut de validation.

Le mineur de références ne lit que les enregistrements partagés `approved`, `completed=true` et `learning_eligible=true`. La remédiation lit seulement les résumés de tentatives durables; elle dépersonnalise, déduplique et crée une leçon candidate bloquée jusqu’à **Approve**. Les compétences approuvées sont conservées sous `instance/approved-skill-overlays/`; les autorisations de téléchargement externes sont hors des workspaces agents, sous `instance/skill-install-authorizations/`.
EOF

cat > "${INSTANCE_DIR}/README-local.md" <<'EOF'
# Données locales de l’instance Project Hub

Ce répertoire persistant, exclu de Git, contient la configuration Spacebot, profils, compétences approuvées, données de travail et journaux. Sauvegarder ce répertoire avec les volumes PostgreSQL selon les règles applicables à l’organisation responsable.
EOF

echo "Instance Project Hub initialisée dans ${INSTANCE_DIR}."
echo "Ajoutez les documents sources dans ${SHARED_WORKSPACE}/01_sources/00_inbox, puis lancez : docker compose up -d --build"
