"""SkillOpt environment adapter for approved Project Hub skill reference packs."""
from __future__ import annotations

from skillopt.datasets.base import BatchSpec
from skillopt.envs.base import EnvAdapter
from skillopt.envs.project.dataloader import ProjectHubSkillDataLoader
from skillopt.envs.project.rollout import run_batch


class ProjectHubSkillAdapter(EnvAdapter):
    """Run an Project Hub skill against explicit train/validation/test partitions."""

    def __init__(
        self,
        split_dir: str = "",
        data_path: str = "",
        split_mode: str = "split_dir",
        split_ratio: str = "2:1:7",
        split_seed: int = 42,
        split_output_dir: str = "",
        workers: int = 1,
        analyst_workers: int = 1,
        failure_only: bool = False,
        minibatch_size: int = 1,
        edit_budget: int = 1,
        seed: int = 42,
        limit: int = 0,
        max_completion_tokens: int = 900,
    ) -> None:
        self.workers = min(1, int(workers))
        self.analyst_workers = min(1, int(analyst_workers))
        self.failure_only = failure_only
        self.minibatch_size = min(1, int(minibatch_size))
        self.edit_budget = min(1, int(edit_budget))
        self.max_completion_tokens = int(max_completion_tokens)
        self.dataloader = ProjectHubSkillDataLoader(
            split_dir=split_dir,
            data_path=data_path,
            split_mode=split_mode,
            split_ratio=split_ratio,
            split_seed=split_seed,
            split_output_dir=split_output_dir,
            seed=seed,
            limit=limit,
        )

    def setup(self, cfg: dict) -> None:
        super().setup(cfg)
        self.dataloader.setup(cfg)

    def get_dataloader(self):
        return self.dataloader

    def build_env_from_batch(self, batch: BatchSpec, **kwargs):
        return list(batch.payload or [])

    def build_train_env(self, batch_size: int, seed: int, **kwargs):
        batch = self.dataloader.build_train_batch(batch_size=batch_size, seed=seed, **kwargs)
        return self.build_env_from_batch(batch, **kwargs)

    def build_eval_env(self, env_num: int, split: str, seed: int, **kwargs):
        batch = self.dataloader.build_eval_batch(env_num=env_num, split=split, seed=seed, **kwargs)
        return self.build_env_from_batch(batch, **kwargs)

    def rollout(self, env_manager, skill_content: str, out_dir: str, **kwargs) -> list[dict]:
        return run_batch(
            items=list(env_manager),
            skill_content=skill_content,
            out_root=out_dir,
            workers=self.workers,
            max_completion_tokens=self.max_completion_tokens,
        )

    def get_task_types(self) -> list[str]:
        task_types: list[str] = []
        for item in self.dataloader.train_items + self.dataloader.val_items + self.dataloader.test_items:
            task_type = str(item.get("task_type") or "project_hub_skill")
            if task_type not in task_types:
                task_types.append(task_type)
        return task_types or ["project_hub_skill"]
