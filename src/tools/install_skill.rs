//! Install skill tool — install skills from skills.sh into the agent workspace.
//!
//! After finding a skill via `skills_search`, the agent can install it directly
//! using this tool. Skills are installed to the agent's workspace skills directory
//! and become immediately available to workers.

use crate::api::ApiState;
use crate::config::RuntimeConfig;
use crate::skills::SkillSet;
use rig::completion::ToolDefinition;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;

/// Tool for installing skills from the skills.sh registry.
#[derive(Clone)]
pub struct InstallSkillTool {
    runtime_config: Arc<RuntimeConfig>,
    /// Shared application state for resolving other agents' runtime configs.
    state: Arc<ApiState>,
}

impl std::fmt::Debug for InstallSkillTool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InstallSkillTool").finish_non_exhaustive()
    }
}

impl InstallSkillTool {
    pub fn new(runtime_config: Arc<RuntimeConfig>, state: Arc<ApiState>) -> Self {
        Self {
            runtime_config,
            state,
        }
    }
}

fn approval_required() -> bool {
    matches!(
        std::env::var("OASIS_SKILL_INSTALL_REQUIRE_APPROVAL").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("YES")
    )
}

fn target_agent_id(config: &RuntimeConfig) -> Result<String, InstallSkillError> {
    config
        .identity_dir
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| InstallSkillError("unable to resolve the target agent ID".to_string()))
}

fn approval_directory(config: &RuntimeConfig) -> PathBuf {
    std::env::var_os("OASIS_SKILL_APPROVAL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            config
                .instance_dir
                .join("skill-install-authorizations")
        })
}

fn installation_is_authorized(config: &RuntimeConfig, source: &str) -> Result<(), InstallSkillError> {
    if !approval_required() {
        return Ok(());
    }

    let agent_id = target_agent_id(config)?;
    let directory = approval_directory(config);
    let entries = std::fs::read_dir(&directory).map_err(|error| {
        InstallSkillError(format!(
            "OASIS requires a Spacebot approval before installing skills; cannot read {}: {error}",
            directory.display()
        ))
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| InstallSkillError(format!("cannot read OASIS approval entry: {error}")))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let raw = std::fs::read_to_string(&path)
            .map_err(|error| InstallSkillError(format!("cannot read OASIS approval {}: {error}", path.display())))?;
        let proposal: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|error| InstallSkillError(format!("invalid OASIS approval {}: {error}", path.display())))?;
        let authorized = proposal.get("kind").and_then(|value| value.as_str()) == Some("capability_skill_install_authorization")
            && proposal.get("status").and_then(|value| value.as_str()) == Some("approved_for_agent_install")
            && proposal.get("target_agent_id").and_then(|value| value.as_str()) == Some(agent_id.as_str())
            && proposal.get("skill_source").and_then(|value| value.as_str()) == Some(source)
            && proposal.get("workspace_skill_only").and_then(|value| value.as_bool()) == Some(true);
        if authorized {
            return Ok(());
        }
    }

    Err(InstallSkillError(format!(
        "OASIS requires a Spacebot-approved capability request before installing '{source}' for agent '{agent_id}'"
    )))
}

/// Error type for install_skill tool.
#[derive(Debug, thiserror::Error)]
#[error("install_skill failed: {0}")]
pub struct InstallSkillError(String);

/// Arguments for install_skill tool.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct InstallSkillArgs {
    /// GitHub source to install from, in `owner/repo` or `owner/repo/skill-name` format.
    /// Use the `source` field from `skills_search` results.
    pub source: String,
    /// Target agent ID. If omitted, installs to the current agent.
    /// Use this when installing skills for a different agent (e.g. a newly created one).
    #[serde(default)]
    pub agent_id: Option<String>,
}

/// Output from install_skill tool.
#[derive(Debug, Serialize)]
pub struct InstallSkillOutput {
    pub success: bool,
    pub message: String,
    /// Names of the skills that were installed.
    pub installed: Vec<String>,
}

impl Tool for InstallSkillTool {
    const NAME: &'static str = "install_skill";

    type Error = InstallSkillError;
    type Args = InstallSkillArgs;
    type Output = InstallSkillOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: crate::prompts::text::get("tools/install_skill").to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "source": {
                        "type": "string",
                        "description": "GitHub source in owner/repo or owner/repo/skill-name format. Use the `source` field from skills_search results."
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Target agent ID. Omit to install on the current agent. Set when installing skills for a different agent."
                    }
                },
                "required": ["source"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let source = args.source.trim();
        if source.is_empty() {
            return Ok(InstallSkillOutput {
                success: false,
                message: "source is required".to_string(),
                installed: Vec::new(),
            });
        }

        // Resolve the target agent's RuntimeConfig.
        let target_config = if let Some(ref agent_id) = args.agent_id {
            let configs = self.state.runtime_configs.load();
            configs
                .get(agent_id)
                .cloned()
                .ok_or_else(|| InstallSkillError(format!("agent '{agent_id}' not found")))?
        } else {
            self.runtime_config.clone()
        };

        installation_is_authorized(&target_config, source)?;

        let target_dir = target_config.workspace_dir.join("skills");

        let installed = crate::skills::install_from_github(source, &target_dir)
            .await
            .map_err(|error| InstallSkillError(error.to_string()))?;

        if installed.is_empty() {
            return Ok(InstallSkillOutput {
                success: false,
                message: format!(
                    "No skills found in '{source}'. Check that the repo contains SKILL.md files."
                ),
                installed: Vec::new(),
            });
        }

        // Reload skills into RuntimeConfig so they're immediately available.
        let instance_skills_dir = target_config.instance_dir.join("skills");
        let skills = SkillSet::load(&instance_skills_dir, &target_dir).await;
        target_config.reload_skills(skills).await;

        if let Some(store) = target_config.skill_usage.load().as_ref()
            && let Err(error) = store.record_installed(&installed).await
        {
            tracing::warn!(%error, "failed to record installed skills");
        }

        let agent_label = args.agent_id.as_deref().unwrap_or("current agent");
        let names = installed.join(", ");
        Ok(InstallSkillOutput {
            success: true,
            message: format!(
                "Installed {} skill(s) for {agent_label}: {names}",
                installed.len()
            ),
            installed,
        })
    }
}
