import { useQuery } from "@tanstack/react-query";
import { Lightning, CheckCircle, WarningCircle, CircleNotch } from "@phosphor-icons/react";
import { api, type AutonomyRunEntry } from "@/api/client";

function formatAge(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "à l’instant";
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  return `il y a ${Math.floor(seconds / 3600)} h`;
}

function statusLabel(run: AutonomyRunEntry): string {
  if (run.status === "running") return "en cours";
  if (run.status === "completed") return "terminé";
  if (run.status === "failed") return "échec";
  return "délai dépassé";
}

function statusClass(run: AutonomyRunEntry): string {
  if (run.status === "running") return "text-status-success";
  if (run.status === "completed") return "text-ink-faint";
  return "text-status-error";
}

function RunIcon({ run }: { run: AutonomyRunEntry }) {
  if (run.status === "running") return <CircleNotch className="size-3.5 animate-spin text-accent" />;
  if (run.status === "completed") return <CheckCircle className="size-3.5 text-status-success" />;
  return <WarningCircle className="size-3.5 text-status-error" />;
}

export function PortalAutonomousActivity() {
  const { data: runsData } = useQuery({
    queryKey: ["autonomy-runs", "portal-activity"],
    queryFn: () => api.autonomyRuns(undefined, 24),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const { data: agentsData } = useQuery({
    queryKey: ["agents", "portal-activity"],
    queryFn: api.agents,
    staleTime: 30_000,
  });

  const agentNames = new Map(
    (agentsData?.agents ?? []).map((agent) => [agent.id, agent.display_name ?? agent.id]),
  );
  const runs = runsData?.runs ?? [];
  const visibleRuns = runs.filter((run) => run.status === "running").concat(
    runs.filter((run) => run.status !== "running").slice(0, 5),
  );

  if (visibleRuns.length === 0) return null;

  return (
    <div className="mx-4 mt-2 rounded-lg border border-app-line/50 bg-app-box/30 px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5 text-tiny text-ink-dull">
        <Lightning className="size-3.5 text-accent" />
        <span>Activité autonome des agents</span>
      </div>
      <div className="flex flex-col gap-1">
        {visibleRuns.map((run) => (
          <div key={run.id} className="flex min-w-0 items-center gap-2 text-tiny">
            <RunIcon run={run} />
            <span className="min-w-0 flex-1 truncate text-ink-dull">
              {agentNames.get(run.agent_id) ?? run.agent_id}
            </span>
            <span className={`shrink-0 ${statusClass(run)}`}>{statusLabel(run)}</span>
            <span className="shrink-0 text-ink-faint">{formatAge(run.started_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
