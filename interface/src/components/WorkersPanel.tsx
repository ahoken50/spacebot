import {useMemo, useState} from "react";
import {useQueries, useQuery} from "@tanstack/react-query";
import {CaretLeft, MagnifyingGlass, Queue} from "@phosphor-icons/react";
import {
	CircleButton,
	PopoverContent,
	PopoverRoot,
	PopoverTrigger,
} from "@spacedrive/primitives";
import {cx} from "class-variance-authority";
import {api} from "@/api/client";
import {
	ProcessCard,
	ProcessDetail,
	type ProcessRunDisplay,
	type ProcessSelection,
} from "@/components/processes/ProcessRunView";
import {useLiveContext} from "@/hooks/useLiveContext";

type Tab = "active" | "tasks" | "history";

interface SelectedProcess extends ProcessSelection {
	agentId: string;
	fallback: ProcessRunDisplay;
}

export function WorkersPanelButton() {
	const [open, setOpen] = useState(false);
	const {activeWorkers, activeBranches} = useLiveContext();
	const activeCount = Object.keys(activeWorkers).length + Object.keys(activeBranches).length;

	return (
		<PopoverRoot open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<CircleButton
					icon={Queue}
					title="Process activity"
					variant={activeCount > 0 ? "active" : "default"}
				/>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="right"
				sideOffset={8}
				collisionPadding={16}
				className="w-[460px] p-0"
			>
				<WorkersPanelContent />
			</PopoverContent>
		</PopoverRoot>
	);
}

function taskStatusClass(status: string): string {
	switch (status) {
		case "done":
			return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
		case "in_progress":
			return "bg-blue-500/10 text-blue-400 border-blue-500/20";
		case "ready":
			return "bg-amber-500/10 text-amber-400 border-amber-500/20";
		case "failed":
			return "bg-red-500/10 text-red-400 border-red-500/20";
		default:
			return "bg-app-box text-ink-faint border-app-line";
	}
}

export function WorkersPanelContent() {
	const [tab, setTab] = useState<Tab>("tasks");
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<SelectedProcess | null>(null);
	const {activeWorkers, activeBranches, liveTranscripts} = useLiveContext();
	const {data: agentsData} = useQuery({
		queryKey: ["agents"],
		queryFn: api.agents,
		staleTime: 30_000,
	});
	const agents = agentsData?.agents ?? [];
	const agentNames = useMemo(
		() => Object.fromEntries(agents.map((agent) => [agent.id, agent.display_name ?? agent.id])),
		[agents],
	);

	const {data: tasksData} = useQuery({
		queryKey: ["panel-tasks"],
		queryFn: () => api.listTasks({limit: 100}),
		refetchInterval: 5_000,
	});
	const tasks = tasksData?.tasks ?? [];

	const {data: autonomyRunsData} = useQuery({
		queryKey: ["autonomy-runs", "panel"],
		queryFn: () => api.autonomyRuns(undefined, 10),
		refetchInterval: 5_000,
		staleTime: 2_000,
	});
	const autonomyRuns = autonomyRunsData?.runs ?? [];

	const processQueries = useQueries({
		queries: agents.map((agent) => ({
			queryKey: ["processes-panel", agent.id],
			queryFn: () => api.processesList(agent.id, {limit: 100}),
			staleTime: 10_000,
			refetchInterval: 10_000,
		})),
	});

	const history = useMemo(() => {
		const rows: Array<ProcessRunDisplay & {agentId: string; agentName: string}> = [];
		for (let index = 0; index < agents.length; index++) {
			const agent = agents[index];
			if (!agent) continue;
			for (const process of processQueries[index]?.data?.processes ?? []) {
				rows.push({...process, agentId: agent.id, agentName: agentNames[agent.id] ?? agent.id});
			}
		}
		return rows.sort((left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime());
	}, [agents, agentNames, processQueries]);

	const active = useMemo(() => {
		const rows: Array<ProcessRunDisplay & {agentId: string; agentName: string}> = [];
		for (const worker of Object.values(activeWorkers)) {
			rows.push({
				kind: "worker",
				id: worker.id,
				input: worker.task,
				status: worker.isIdle ? "idle" : "running",
				process_type: worker.workerType,
				started_at: new Date(worker.startedAt).toISOString(),
				tool_calls: worker.toolCalls,
				interactive: worker.interactive,
				agentId: worker.agentId,
				agentName: agentNames[worker.agentId] ?? worker.agentId,
			});
		}
		for (const branch of Object.values(activeBranches)) {
			rows.push({
				kind: "branch",
				id: branch.id,
				input: branch.description,
				status: "running",
				started_at: new Date(branch.startedAt).toISOString(),
				tool_calls: branch.toolCalls,
				agentId: branch.agentId,
				agentName: agentNames[branch.agentId] ?? branch.agentId,
			});
		}
		return rows.sort((left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime());
	}, [activeWorkers, activeBranches, agentNames]);

	const term = search.trim().toLowerCase();
	const filteredProcesses = (tab === "active" ? active : history).filter((process) =>
		term ? process.input.toLowerCase().includes(term) || process.agentName.toLowerCase().includes(term) : true,
	);

	const filteredTasks = tasks.filter((task) => {
		if (!term) return true;
		const title = task.title.toLowerCase();
		const assigned = (task.assigned_agent_id ? (agentNames[task.assigned_agent_id] ?? task.assigned_agent_id) : "").toLowerCase();
		const owner = (agentNames[task.owner_agent_id] ?? task.owner_agent_id).toLowerCase();
		return title.includes(term) || assigned.includes(term) || owner.includes(term) || task.status.toLowerCase().includes(term);
	});

	return (
		<div className="relative h-[540px] overflow-hidden">
			<div className="absolute inset-0 flex flex-col transition-transform duration-200" style={{transform: selected ? "translateX(-100%)" : "translateX(0)"}}>
				<div className="flex items-center gap-2 border-b border-app-line px-3 py-2.5">
					<MagnifyingGlass className="size-3.5 shrink-0 text-ink-faint" />
					<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, branches, workers..." className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint" />
				</div>
				<div className="flex border-b border-app-line">
					{(["tasks", "active", "history"] as const).map((value) => (
						<button key={value} type="button" onClick={() => setTab(value)} className={cx("flex-1 py-2 text-xs font-medium capitalize transition-colors", tab === value ? "bg-app-hover/40 text-ink border-b-2 border-accent font-semibold" : "text-ink-faint hover:text-ink-dull")}>
							{value === "tasks" ? "Tâches & Statuts" : value === "active" ? "Actifs" : "Historique"}
							{value === "active" && active.length > 0 ? ` · ${active.length}` : ""}
							{value === "tasks" && tasks.length > 0 ? ` · ${tasks.length}` : ""}
						</button>
					))}
				</div>
				<div className="flex-1 overflow-y-auto py-1">
					{tab === "tasks" ? (
						<div className="flex flex-col gap-2 p-2">
							{autonomyRuns.filter((run) => run.status === "running").length > 0 && (
								<div className="rounded-lg border border-accent/30 bg-accent/5 p-2.5 mb-1">
									<div className="text-[11px] font-medium text-accent mb-1.5 flex items-center gap-1.5">
										<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
										Autonomie en cours
									</div>
									<div className="space-y-1">
										{autonomyRuns.filter((run) => run.status === "running").map((run) => (
											<div key={run.id} className="flex items-center justify-between text-xs text-ink">
												<span>{agentNames[run.agent_id] ?? run.agent_id}</span>
												<span className="text-[10px] text-ink-faint font-mono">en cours</span>
											</div>
										))}
									</div>
								</div>
							)}

							{filteredTasks.length === 0 ? (
								<div className="py-12 text-center text-sm text-ink-faint">Aucune tâche trouvée</div>
							) : (
								filteredTasks.map((task) => {
									const assignedAgentId = task.assigned_agent_id;
									const assignedName = assignedAgentId ? (agentNames[assignedAgentId] ?? assignedAgentId) : "Non assigné";
									const delegatedBy = task.metadata?.delegated_by ? (agentNames[String(task.metadata.delegated_by)] ?? String(task.metadata.delegated_by)) : null;

									// Find active branches and workers for this assigned agent
									const agentBranches = assignedAgentId
										? Object.values(activeBranches).filter((b) => b.agentId === assignedAgentId)
										: [];
									const agentWorkers = assignedAgentId
										? Object.values(activeWorkers).filter((w) => w.agentId === assignedAgentId)
										: [];

									const hasLiveSubprocesses = agentBranches.length > 0 || agentWorkers.length > 0;

									return (
										<div key={task.id} className="rounded-lg border border-app-line bg-app-box/40 p-3 hover:bg-app-hover/30 transition-colors">
											<div className="flex items-start justify-between gap-2">
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-1.5">
														<span className="font-mono text-tiny text-ink-faint">#{task.task_number}</span>
														<span className="font-medium text-xs text-ink truncate">{task.title}</span>
													</div>
													{task.description && (
														<p className="mt-1 text-tiny text-ink-dull line-clamp-2">{task.description}</p>
													)}
												</div>
												<span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border uppercase tracking-wider", taskStatusClass(task.status))}>
													{task.status.replace("_", " ")}
												</span>
											</div>

											{/* Verbal live sub-process indicators (Internal Workers & Branches) */}
											{hasLiveSubprocesses && (
												<div className="mt-2.5 space-y-1.5 rounded-md border border-accent/20 bg-accent/5 p-2">
													<div className="text-[10px] font-semibold uppercase tracking-wider text-accent flex items-center gap-1">
														<span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
														Activité interne en temps réel
													</div>

													{agentBranches.map((branch) => (
														<div key={branch.id} className="text-tiny flex flex-col gap-0.5 rounded bg-app-box/60 p-1.5 border border-app-line/30">
															<div className="flex items-center justify-between">
																<span className="font-medium text-ink flex items-center gap-1">
																	🧠 Branche de réflexion
																</span>
																<span className="text-[10px] font-mono text-accent">
																	{branch.toolCalls} appel{branch.toolCalls > 1 ? "s" : ""}
																</span>
															</div>
															<p className="text-ink-dull line-clamp-1 italic text-[11px]">
																« {branch.description} »
															</p>
															{branch.currentTool && (
																<div className="text-[10px] text-ink-faint font-mono truncate">
																	Outil : <span className="text-accent">{branch.currentTool}</span>
																</div>
															)}
														</div>
													))}

													{agentWorkers.map((worker) => (
														<div key={worker.id} className="text-tiny flex flex-col gap-0.5 rounded bg-app-box/60 p-1.5 border border-app-line/30">
															<div className="flex items-center justify-between">
																<span className="font-medium text-ink flex items-center gap-1">
																	⚡ Worker ({worker.workerType || "interne"})
																</span>
																<span className={cx("text-[10px] font-mono", worker.isIdle ? "text-amber-400" : "text-emerald-400")}>
																	{worker.isIdle ? "en attente" : "actif"}
																</span>
															</div>
															<p className="text-ink-dull line-clamp-1 text-[11px]">
																{worker.task}
															</p>
															{(worker.currentTool || worker.status) && (
																<div className="text-[10px] text-ink-faint font-mono truncate">
																	Action : <span className="text-ink-dull">{worker.currentTool ?? worker.status}</span>
																</div>
															)}
														</div>
													))}
												</div>
											)}

											<div className="mt-2.5 flex items-center justify-between border-t border-app-line/40 pt-2 text-[11px] text-ink-faint">
												<div className="flex items-center gap-1.5 truncate">
													<span className="text-ink-dull">Agent :</span>
													<span className="font-medium text-ink truncate">{assignedName}</span>
													{delegatedBy && (
														<span className="text-tiny text-accent font-medium">➔ délégué par {delegatedBy}</span>
													)}
												</div>
												<span className="shrink-0 text-tiny capitalize text-ink-dull">{task.priority}</span>
											</div>
										</div>
									);
								})
							)}
						</div>
					) : filteredProcesses.length === 0 ? (
						<div className="py-12 text-center text-sm text-ink-faint">No {tab} processes</div>
					) : (
						filteredProcesses.map((process) => {
							const liveWorker = process.kind === "worker" ? activeWorkers[process.id] : undefined;
							const liveBranch = process.kind === "branch" ? activeBranches[process.id] : undefined;
							return (
								<div key={`${process.kind}:${process.id}`}>
									<div className="px-[72px] pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{process.agentName}</div>
									<ProcessCard kind={process.kind} id={process.id} title={process.input} status={liveWorker ? (liveWorker.isIdle ? "idle" : "running") : liveBranch ? "running" : process.status} startedAt={process.started_at} toolCalls={liveWorker?.toolCalls ?? liveBranch?.toolCalls ?? process.tool_calls} currentTool={liveWorker?.currentTool ?? liveBranch?.currentTool} processType={process.process_type} selected={false} onSelect={() => setSelected({kind: process.kind, id: process.id, agentId: process.agentId, fallback: process})} />
								</div>
							);
						})
					)}
				</div>
			</div>
			<div className="absolute inset-0 flex flex-col transition-transform duration-200" style={{transform: selected ? "translateX(0)" : "translateX(100%)"}}>
				{selected && (
					<>
						<div className="absolute left-2 top-2 z-10">
							<CircleButton icon={CaretLeft} title="Back to activity" onClick={() => setSelected(null)} variant="default" />
						</div>
						<ProcessDetail agentId={selected.agentId} selection={selected} fallback={selected.fallback} liveTranscript={liveTranscripts[selected.id]} onClose={() => setSelected(null)} />
					</>
				)}
			</div>
		</div>
	);
}
