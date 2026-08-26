#!/usr/bin/env python3
"""Static integrity checks for the local OASIS-V2 Spacebot deployment."""
from __future__ import annotations

from pathlib import Path
import json
import re
import tomllib

ROOT = Path(__file__).resolve().parent
config = tomllib.loads((ROOT / 'config.toml.example').read_text(encoding='utf-8'))
compose = (ROOT / 'docker-compose.yml').read_text(encoding='utf-8')
root_dockerfile = (ROOT / '..' / '..' / 'Dockerfile').resolve().read_text(encoding='utf-8')

agents = config['agents']
agent_ids = {agent['id'] for agent in agents}
human_ids = {human['id'] for human in config['humans']}
assert len(agents) == 6, 'Six profils OASIS sont requis.'
assert len(agent_ids) == len(agents), 'Les IDs des agents doivent être uniques.'
assert sum(bool(agent.get('default')) for agent in agents) == 1, 'Un seul agent par défaut est requis.'
assert all(re.fullmatch(r'[a-z0-9_-]+', agent_id) for agent_id in agent_ids), 'ID agent invalide.'
assert all('workspace' not in agent for agent in agents), 'Chaque profil doit utiliser son workspace privé par défaut.'
assert all(agent.get('sandbox', {}).get('writable_paths') == ['/data/shared-workspace'] for agent in agents), 'Chaque profil doit recevoir seulement l’accès documentaire partagé requis.'

routing = config['defaults']['routing']
for field in ('channel', 'branch', 'worker', 'compactor', 'cortex'):
    assert routing[field].startswith('openrouter/'), f'Routage {field} doit utiliser OpenRouter.'
assert routing['task_overrides']['coding'] == 'openrouter/openai/gpt-oss-120b'
assert routing['rate_limit_cooldown_secs'] == 90
assert 'openrouter/openai/gpt-oss-120b' in routing['fallbacks']

assert config['defaults']['max_concurrent_branches'] == 1
assert config['defaults']['max_concurrent_workers'] == 1
assert config['defaults']['max_turns'] == 3
assert config['defaults']['branch_max_turns'] == 6
assert config['defaults']['history_backfill_count'] == 12
chronicle = config['defaults']['compaction']
assert chronicle['mode'] == 'chronicle'
for field, expected in [('background_threshold', 0.72), ('aggressive_threshold', 0.82), ('emergency_threshold', 0.93)]:
    assert chronicle[field] == expected, f'Compaction {field} incorrecte.'
assert chronicle['chronicle']['interval_messages'] == 24
assert chronicle['chronicle']['context_token_budget'] == 1200
assert config['defaults']['memory_persistence']['enabled'] is False
assert config['defaults']['skills']['reflection']['enabled'] is False
assert config['defaults']['cortex']['worker_wall_clock_timeout_secs'] == 600
assert config['defaults']['autonomy']['level'] == 'suggest'
assert config['defaults']['browser']['enabled'] is False

opencode = config['defaults']['opencode']
assert opencode['enabled'] is True
assert opencode['path'] == '/root/.bun/bin/opencode'
assert opencode['max_servers'] == 1
assert opencode['permissions'] == {'edit': 'allow', 'bash': 'allow', 'webfetch': 'deny'}
assert 'opencode-ai@${OPENCODE_VERSION}' in root_dockerfile, 'Le binaire OpenCode versionné doit être inclus dans l’image.'
assert 'COPY --from=builder /root/.bun /root/.bun' in root_dockerfile, 'Bun et OpenCode doivent être copiés dans l’image runtime.'
assert 'ENV PATH="/root/.bun/bin:${PATH}"' in root_dockerfile, 'Le chemin runtime d’OpenCode doit être déclaré.'
for package in ('python3', 'python3-venv', 'python3-pip'):
    assert package in root_dockerfile, f'Python runtime manquant dans l’image Spacebot : {package}'

mcp = {entry['name']: entry['url'] for entry in config['defaults']['mcp']}
assert mcp == {'oasis_shared_memory': 'http://oasis-shared-memory:3010/mcp'}, 'La mémoire commune doit être l’unique MCP partagé par défaut.'
expected_agent_mcp = {
    'oasis-coordination': {'oasis_document_studio', 'oasis_supervised_optimizer', 'oasis_skillopt', 'oasis_reference_miner'},
    'oasis-finances': {'oasis_document_studio'},
    'oasis-calendrier': {'oasis_document_studio'},
    'oasis-pse-sig': {'oasis_gis_local', 'oasis_document_studio'},
    'oasis-reddition': {'oasis_document_studio'},
    'oasis-gouvernance': {'oasis_document_studio'},
}
for agent in agents:
    tool_names = {entry['name'] for entry in agent.get('mcp', [])}
    assert tool_names == expected_agent_mcp[agent['id']], f'MCP ciblés incorrects pour {agent["id"]}: {tool_names}'
coordination = next(agent for agent in agents if agent['id'] == 'oasis-coordination')
assert coordination['browser']['enabled'] is True
assert '- SYS_ADMIN' in compose, 'Bubblewrap nécessite SYS_ADMIN pour créer son espace de montage isolé.'
assert '- seccomp=unconfined' in compose and '- apparmor=unconfined' in compose, 'Bubblewrap doit pouvoir effectuer ses montages de namespace dans le conteneur principal.'
assert 'no-new-privileges:true' in compose and 'cap_drop:\n      - ALL' in compose, 'Le conteneur principal doit conserver no-new-privileges et supprimer les capacités non requises.'
assert 'docker.sock' not in compose and './instance:/data' in compose, 'Le moteur OASIS ne doit monter que son instance locale, jamais le socket Docker.'
for service in ('oasis-memory-db:', 'oasis-shared-memory:', 'oasis-gis:', 'oasis-document-studio:', 'oasis-optimizer:', 'oasis-skillopt:', 'oasis-reference-miner:', 'spacebot-oasis-v2:', 'oasis-failure-remediator:', 'oasis-approval-bridge:'):
    assert service in compose, f'Service Docker manquant : {service}'
assert 'OASIS_OPTIMIZER_ENABLED: ${OASIS_OPTIMIZER_ENABLED:-true}' in compose, 'Le service DSPy doit être actif par défaut.'
optimizer_server = (ROOT / 'optimizer' / 'server.js').read_text(encoding='utf-8')
assert "process.env.OASIS_OPTIMIZER_ENABLED ?? 'true'" in optimizer_server, 'Le serveur DSPy doit être actif par défaut.'
assert "confirm_approved_reference_pack: z.literal(true)" in optimizer_server, 'Une confirmation de jeu approuvé doit rester obligatoire.'
assert 'OASIS_SKILLOPT_ENABLED: ${OASIS_SKILLOPT_ENABLED:-true}' in compose, 'SkillOpt doit être actif par défaut.'
assert 'OASIS_SKILLOPT_AUTONOMOUS_ENABLED: ${OASIS_SKILLOPT_AUTONOMOUS_ENABLED:-true}' in compose, 'Le cycle SkillOpt autonome doit être configurable et actif par défaut.'
assert 'OASIS_MEMORY_EXPORT_TOKEN: ${OASIS_MEMORY_EXPORT_TOKEN:?Définir OASIS_MEMORY_EXPORT_TOKEN dans .env}' in compose, 'L’export mémoire interne doit exiger un jeton local.'
assert 'OASIS_REFERENCE_MINER_ENABLED: ${OASIS_REFERENCE_MINER_ENABLED:-true}' in compose, 'Le mineur de références doit être actif par défaut.'
assert 'OASIS_REFERENCE_MINER_AUTONOMOUS_ENABLED: ${OASIS_REFERENCE_MINER_AUTONOMOUS_ENABLED:-true}' in compose, 'Le cycle autonome du mineur doit être configurable.'
assert 'OASIS_AUTONOMOUS_PIPELINE_ENABLED: ${OASIS_AUTONOMOUS_PIPELINE_ENABLED:-true}' in compose, 'Le pipeline autonome doit être activable dans Docker.'
assert 'OASIS_AUTONOMOUS_PIPELINE_TOKEN: ${OASIS_AUTONOMOUS_PIPELINE_TOKEN:?Définir OASIS_AUTONOMOUS_PIPELINE_TOKEN dans .env}' in compose, 'Les déclenchements internes doivent être authentifiés.'
assert 'OASIS_APPROVAL_BRIDGE_TOKEN: ${OASIS_APPROVAL_BRIDGE_TOKEN:?Définir OASIS_APPROVAL_BRIDGE_TOKEN dans .env}' in compose, 'Le pont d’approbation doit exiger un jeton local.'
assert 'OASIS_FAILURE_REMEDIATOR_TOKEN: ${OASIS_FAILURE_REMEDIATOR_TOKEN:?Définir OASIS_FAILURE_REMEDIATOR_TOKEN dans .env}' in compose, 'Le diagnostiqueur d’échec doit exiger un jeton local.'
assert 'OASIS_FAILURE_REMEDIATOR_MAX_PROPOSALS_PER_DAY: ${OASIS_FAILURE_REMEDIATOR_MAX_PROPOSALS_PER_DAY:-3}' in compose, 'La boucle d’échec doit imposer un plafond journalier.'
assert 'env_file:' not in compose, 'Les services OASIS doivent recevoir seulement les secrets explicitement requis.'
assert 'OASIS_SKILL_INSTALL_REQUIRE_APPROVAL: "true"' in compose, 'L’installation externe de compétences doit exiger une autorisation OASIS.'
assert 'OASIS_SKILL_APPROVAL_DIR: /data/skill-install-authorizations' in compose, 'Le verrou d’installation doit lire les autorisations persistantes hors du workspace agent.'
assert 'OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:?Définir OPENROUTER_API_KEY dans .env}' in compose, 'Les services qui appellent OpenRouter doivent recevoir la clé explicitement.'
reference_miner_server = (ROOT / 'reference-miner' / 'server.js').read_text(encoding='utf-8')
assert "payload.learning_eligible === true" in reference_miner_server and "payload.completed === true" in reference_miner_server, 'Le mineur doit limiter ses sources aux tâches explicitement admissibles et terminées.'
assert "policy.auto_promote === true" in reference_miner_server and "promotion: 'blocked_pending_approval'" in reference_miner_server, 'Le mineur ne doit jamais promouvoir un candidat automatiquement.'
assert 'writeAutonomousPacks' in reference_miner_server and 'callAutonomousRunner' in reference_miner_server, 'Le mineur doit préparer puis évaluer automatiquement les packs temporaires.'
assert 'autonomous_pipeline !== true' in reference_miner_server, 'Le pipeline doit exiger une autorisation explicite dans la politique.'
assert "'/internal/autonomous-run'" in optimizer_server, 'DSPy doit exposer seulement un déclencheur interne authentifié pour le pipeline.'
skillopt_server = (ROOT / 'skillopt' / 'server.js').read_text(encoding='utf-8')
skillopt_runner = (ROOT / 'skillopt' / 'skillopt_runner.py').read_text(encoding='utf-8')
assert "OASIS_SKILLOPT_ENABLED ?? 'true'" in skillopt_server, 'Le serveur SkillOpt doit être actif par défaut.'
assert "runSkillOpt(['autonomous'])" in skillopt_server, 'Le serveur SkillOpt doit prévoir un cycle autonome borné.'
assert 'generated_pack = autonomous_pack and ALLOW_AUTONOMOUS_PACKS' in skillopt_runner and 'redacted") is not True' in skillopt_runner, 'SkillOpt doit exiger un pack dépersonnalisé et refuser les packs autonomes non autorisés.'
assert "'/internal/autonomous-run'" in skillopt_server, 'SkillOpt doit exposer seulement un déclencheur interne authentifié pour le pipeline.'
assert '"promotion": "blocked_pending_human_approval"' in skillopt_runner, 'SkillOpt ne doit jamais promouvoir une compétence directement.'
assert 'ALLOWED_SKILLS' in skillopt_runner, 'SkillOpt doit restreindre les compétences auto-évolutives.'
skillopt_dockerfile = (ROOT / 'skillopt' / 'Dockerfile').read_text(encoding='utf-8')
assert 'SKILLOPT_COMMIT=0389ace56339988e16ca5ddab36f0978776fe9b0' in skillopt_dockerfile, 'La révision SkillOpt doit être figée.'
assert 'git rev-parse HEAD' in skillopt_dockerfile, 'La révision SkillOpt doit être vérifiée pendant la construction.'
for dockerfile in (
    ROOT / 'shared-memory' / 'Dockerfile',
    ROOT / 'gis-mcp' / 'Dockerfile',
    ROOT / 'document-studio' / 'Dockerfile',
    ROOT / 'optimizer' / 'Dockerfile',
    ROOT / 'skillopt' / 'Dockerfile',
    ROOT / 'reference-miner' / 'Dockerfile',
    ROOT / 'approval-bridge' / 'Dockerfile',
    ROOT / 'failure-remediator' / 'Dockerfile',
):
    dockerfile_text = dockerfile.read_text(encoding='utf-8')
    assert 'frozen-lockfile=false' not in dockerfile_text, f'Argument Bun invalide dans {dockerfile}.'
    assert 'bun install --production' in dockerfile_text, f'Installation Bun de production attendue dans {dockerfile}.'
install_skill_tool = (ROOT / '..' / '..' / 'src' / 'tools' / 'install_skill.rs').resolve().read_text(encoding='utf-8')
assert 'OASIS_SKILL_INSTALL_REQUIRE_APPROVAL' in install_skill_tool and 'approved_for_agent_install' in install_skill_tool, 'Le moteur doit bloquer install_skill sans autorisation OASIS explicite.'
assert 'skill-install-authorizations' in install_skill_tool and 'capability_skill_install_authorization' in install_skill_tool, 'Le verrou doit lire seulement les autorisations réservées hors du workspace agent.'
assert 'proposal.get("skill_source")' in install_skill_tool and 'proposal.get("target_agent_id")' in install_skill_tool, 'Le verrou doit associer précisément source et agent autorisés.'
approval_bridge = (ROOT / 'approval-bridge' / 'server.js').read_text(encoding='utf-8')
assert "apiRequest('/tasks'" in approval_bridge and "pending_user_approval" in approval_bridge, 'Le pont doit créer une tâche d’approbation Spacebot par proposition.'
assert "isApprovedTask(task)" in approval_bridge and "isRejectedTask(task)" in approval_bridge, 'Le pont doit distinguer les décisions utilisateur dans l’interface.'
assert "task?.status === 'ready'" in approval_bridge and "applied_after_spacebot_ui_approval" in approval_bridge, 'La promotion doit suivre exclusivement l’approbation UI.'
assert "blocked_rejected_in_spacebot_ui" in approval_bridge, 'Le rejet UI doit bloquer durablement la promotion.'
assert "failure_remediation" in approval_bridge and "promoteFailureRemediation" in approval_bridge, 'Le pont doit soumettre les leçons d’échec à la même approbation UI.'
assert "approved-skill-overlays" in approval_bridge and "persistAndInstallSkill" in approval_bridge, 'Les promotions approuvées doivent survivre au bootstrap.'
assert "capability_skill_acquisition" in approval_bridge and "authorizeCapabilitySkill" in approval_bridge, 'Le pont doit soumettre les compétences externes à l’approbation UI.'
assert "skill-install-authorizations" in approval_bridge and "capability_skill_install_authorization" in approval_bridge, 'Le pont doit déposer une autorisation réservée hors du workspace agent.'
assert "approved_for_agent_install" in approval_bridge and "workspace_skill_only" in approval_bridge, 'Une compétence externe approuvée doit rester limitée au workspace.'
failure_remediator = (ROOT / 'failure-remediator' / 'server.js').read_text(encoding='utf-8')
assert "'/tasks?limit=500'" in failure_remediator and '/tasks/${taskNumber}/attempts' in failure_remediator, 'La boucle doit lire les tâches et leurs tentatives Spacebot.'
assert "missing_or_unavailable_mcp" in failure_remediator and "missing_tool" in failure_remediator and "prompt_or_context_unclear" in failure_remediator, 'Les catégories de diagnostic requises sont absentes.'
assert "repeat_suppressed" in failure_remediator and "maxProposalsPerDay" in failure_remediator, 'La boucle doit supprimer les répétitions et appliquer un plafond.'
assert "[courriel retiré]" in failure_remediator and "[secret retiré]" in failure_remediator, 'Les résumés d’échec doivent être dépersonnalisés.'
assert "auto_promote: false" in failure_remediator and "mcp_change: false" in failure_remediator, 'Une leçon ne doit jamais modifier automatiquement une capacité.'
capability_skill = (ROOT / 'skills' / 'oasis-capability-discovery' / 'SKILL.md').read_text(encoding='utf-8')
capability_template = ROOT / 'skills' / 'oasis-capability-discovery' / 'templates' / 'capability_skill_acquisition.template.json'
assert capability_template.is_file(), 'Le gabarit de demande de compétence externe est requis.'
capability_template_data = json.loads(capability_template.read_text(encoding='utf-8'))
assert capability_template_data['kind'] == 'capability_skill_acquisition' and capability_template_data['constraints']['workspace_skill_only'] is True, 'Le gabarit de compétence externe est invalide.'
assert 'capability_skill_acquisition' in capability_skill and 'skills_search(action="search")' in capability_skill, 'La découverte contrôlée doit inclure la recherche et l’approbation des compétences externes.'
python_skill = ROOT / 'profile-skills' / 'oasis-python-workbench' / 'SKILL.md'
python_scaffold = ROOT / 'profile-skills' / 'oasis-python-workbench' / 'scripts' / 'scaffold_oasis_python_script.py'
assert python_skill.is_file() and python_scaffold.is_file(), 'La compétence Python et son générateur sont requis.'
assert 'python3 -m py_compile' in python_skill.read_text(encoding='utf-8'), 'La compétence Python doit exiger une compilation de contrôle.'
skill_texts = '\n'.join(path.read_text(encoding='utf-8') for path in (ROOT / 'skills').rglob('SKILL.md'))
skill_texts += '\n'.join(path.read_text(encoding='utf-8') for path in (ROOT / 'profile-skills').rglob('SKILL.md'))
for raw_tool in (
    'search_shared_memory', 'get_shared_record', 'shared_memory_status',
    'classify_workspace_document', 'create_document_brief', 'render_markdown_document',
    'render_document_preview', 'check_document_quality', 'inspect_kml', 'export_kml_geojson',
    'project_surface_analysis', 'optimizer_status', 'optimizer_validate_reference_pack',
    'optimizer_propose', 'skillopt_status', 'skillopt_validate_reference_pack',
    'reference_miner_status', 'reference_miner_validate_policy',
    'reference_miner_discover_candidates', 'reference_miner_autonomous_cycle',
):
    assert f'`{raw_tool}`' not in skill_texts, f'Le nom MCP doit être préfixé : {raw_tool}'
for expected_tool in (
    'oasis_shared_memory_search_shared_memory', 'oasis_shared_memory_save_shared_record',
    'oasis_document_studio_classify_workspace_document', 'oasis_document_studio_check_document_quality',
    'oasis_gis_local_inspect_kml', 'oasis_supervised_optimizer_optimizer_status',
    'oasis_skillopt_skillopt_status', 'oasis_reference_miner_reference_miner_status',
):
    assert expected_tool in skill_texts, f'Outil MCP préfixé absent des compétences : {expected_tool}'
assert 'chemins **relatifs**' in skill_texts and '/data/shared-workspace/...' in skill_texts, 'Les compétences documentaires doivent exiger des chemins relatifs.'
bootstrap = (ROOT / 'bootstrap_instance.sh').read_text(encoding='utf-8')
assert bootstrap.count('oasis-python-workbench') == 6, 'La compétence Python doit être préchargée pour les six profils.'
assert 'workspace/skills' in bootstrap and 'approved-skill-overlays' in bootstrap, 'Les compétences de profil et recouvrements approuvés doivent être préparés dans les workspaces privés.'
assert 'skill-install-authorizations' in bootstrap, 'Le bootstrap doit préparer la zone réservée aux autorisations de compétences.'
assert '00_systeme/scripts' in bootstrap, 'Le répertoire de scripts OASIS doit être initialisé.'
optimizer_dockerfile = (ROOT / 'optimizer' / 'Dockerfile').read_text(encoding='utf-8')
assert 'FROM oven/bun:1.3.4-alpine' in optimizer_dockerfile, 'L’image DSPy doit être alignée sur Bun 1.3.4.'

for link in config['links']:
    assert link['from'] in agent_ids | human_ids and link['to'] in agent_ids | human_ids, f'Lien invalide : {link}'
    assert link['direction'] in {'one_way', 'two_way'}
    assert link['kind'] in {'hierarchical', 'peer'}

taxonomy = json.loads((ROOT / 'document-studio' / 'taxonomy.json').read_text(encoding='utf-8'))
assert len(taxonomy['categories']) == 8, 'La taxonomie doit contenir huit catégories principales.'
assert '01_sources/00_inbox' in taxonomy['categories']['source']['folders']
assert '07_livrables/03_approuves' in taxonomy['categories']['deliverable']['folders']

for required in [
    ROOT / 'gis-mcp' / 'server.js',
    ROOT / 'document-studio' / 'server.js',
    ROOT / 'document-studio' / 'taxonomy.json',
    ROOT / 'document-studio' / 'templates' / 'oasis-reference.docx',
    ROOT / 'optimizer' / 'Dockerfile',
    ROOT / 'optimizer' / 'server.js',
    ROOT / 'optimizer' / 'optimizer.py',
    ROOT / 'optimizer' / 'fixtures' / 'reference_cases.template.json',
    ROOT / 'skillopt' / 'Dockerfile',
    ROOT / 'skillopt' / 'server.js',
    ROOT / 'skillopt' / 'skillopt_runner.py',
    ROOT / 'skillopt' / 'fixtures' / 'skillopt_reference_pack.template.json',
    ROOT / 'reference-miner' / 'Dockerfile',
    ROOT / 'reference-miner' / 'server.js',
    ROOT / 'reference-miner' / 'fixtures' / 'reference_mining_policy.template.json',
    ROOT / 'approval-bridge' / 'Dockerfile',
    ROOT / 'approval-bridge' / 'package.json',
    ROOT / 'approval-bridge' / 'server.js',
    ROOT / 'approval-bridge' / 'test_failure_remediation.mjs',
    ROOT / 'approval-bridge' / 'test_capability_skill_acquisition.mjs',
    ROOT / 'failure-remediator' / 'Dockerfile',
    ROOT / 'failure-remediator' / 'package.json',
    ROOT / 'failure-remediator' / 'server.js',
    ROOT / 'failure-remediator' / 'test_integration.mjs',
    ROOT / 'skills' / 'oasis-foundation' / 'SKILL.md',
    ROOT / 'skills' / 'oasis-capability-discovery' / 'SKILL.md',
    ROOT / 'skills' / 'oasis-capability-discovery' / 'templates' / 'capability_skill_acquisition.template.json',
    ROOT / 'profile-skills' / 'oasis-coordination' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-financial-control' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-schedule-governance' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-pse-sig' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-reporting' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-governance' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-document-studio' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-supervised-optimization' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-skillopt-learning' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-reference-case-mining' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-failure-learning' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-python-workbench' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-python-workbench' / 'scripts' / 'scaffold_oasis_python_script.py',
]:
    assert required.is_file(), f'Ressource requise absente : {required}'

print('Validation statique OASIS-V2 : OK')
print('Agents: 6 | Workspaces privés + données partagées sandboxées | Secrets par moindre privilège | MCP ciblés | OpenCode/Python: activés | Routage: OpenRouter sans Claude | Autonomie: apprentissage et acquisition de compétences jusqu’à approbation UI | Taxonomie: 8 catégories | DSPy/SkillOpt: évaluations autonomes | Promotion: tâche Spacebot approuvée seulement | Sobriété: activée')
