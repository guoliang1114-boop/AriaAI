import { useTranslation } from "react-i18next";
import { Archive, Package, TrendingUp } from "lucide-react";
import {
  PROJECT_STAGE_CONFIGS,
  PROJECT_STAGE_IDS,
  resolveProjectStage,
  type ProjectPhase,
  type ProjectStage,
} from "../../types/enums";
import type { Project } from "../../types/api";
import { ProjectKanbanPhaseHeader } from "./ProjectKanbanPhaseHeader";
import { ProjectKanbanStageColumn } from "./ProjectKanbanStageColumn";

export type PhaseConfig = {
  id: ProjectPhase;
  label: string;
  labelZh: string;
  subtitle: string;
  subtitleEn: string;
  icon: typeof TrendingUp;
  color: string;
  bgColor: string;
  gradient: string;
  stages: ProjectStage[];
};

export const PHASES: Record<ProjectPhase, PhaseConfig> = {
  business: {
    id: "business",
    label: "Business Development",
    labelZh: "商务阶段",
    subtitle: "从线索发现到合同签约",
    subtitleEn: "From lead discovery to contract signing",
    icon: TrendingUp,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    gradient: "from-indigo-500/10 via-purple-500/10 to-blue-500/10",
    stages: ["lead_discovery", "opportunity_qualified", "proposal", "negotiation", "contracting"],
  },
  delivery: {
    id: "delivery",
    label: "Delivery Phase",
    labelZh: "交付阶段",
    subtitle: "从项目启动到运维支持",
    subtitleEn: "From kickoff to ongoing support",
    icon: Package,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    gradient: "from-emerald-500/10 via-teal-500/10 to-cyan-500/10",
    stages: ["kickoff", "execution", "delivery", "support"],
  },
  archived: {
    id: "archived",
    label: "Archived",
    labelZh: "归档",
    subtitle: "已完成项目的历史归档",
    subtitleEn: "Historical archive of completed projects",
    icon: Archive,
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    gradient: "from-gray-500/5 to-slate-500/5",
    stages: ["archived"],
  },
};

const STAGES = PROJECT_STAGE_CONFIGS;

export function getProjectStage(project: Project): ProjectStage {
  const explicit = project.status as ProjectStage;
  if (PROJECT_STAGE_IDS.includes(explicit)) return explicit;
  return resolveProjectStage(project.status).id;
}

export function getProjectPhase(project: Project): ProjectPhase {
  const stage = getProjectStage(project);
  return PROJECT_STAGE_CONFIGS.find((item) => item.id === stage)?.phase || "business";
}

interface ProjectsPhaseSectionProps {
  isExpanded: boolean;
  onProjectClick: (id: number) => void;
  onToggle: () => void;
  phase: PhaseConfig;
  projects: Project[];
}

export function ProjectsPhaseSection({
  isExpanded,
  onProjectClick,
  onToggle,
  phase,
  projects,
}: ProjectsPhaseSectionProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const phaseStages = STAGES.filter((stage) => phase.stages.includes(stage.id));
  const totalProjects = phaseStages.reduce(
    (sum, stage) => sum + projects.filter((project) => getProjectStage(project) === stage.id).length,
    0,
  );
  const totalValue = projects.reduce((sum, project) => sum + (project.contract_amount || 0), 0);

  return (
    <div className="mb-8">
      <ProjectKanbanPhaseHeader
        isExpanded={isExpanded}
        isZh={isZh}
        onToggle={onToggle}
        phase={phase}
        totalProjects={totalProjects}
        totalValue={totalValue}
      />

      {isExpanded && (
        <div className="mt-6 animate-in slide-in-from-top-2 duration-300">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="pb-4">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-5">
                {phaseStages.map((stage) => (
                  <div key={stage.id} className="min-w-0">
                    <ProjectKanbanStageColumn
                      onProjectClick={onProjectClick}
                      projects={projects.filter((project) => getProjectStage(project) === stage.id)}
                      stage={stage}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
