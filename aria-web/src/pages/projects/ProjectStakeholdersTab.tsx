import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "../../api/client";
import type {
  ClientMemory,
  ClientMemoryResponse,
  ClientStakeholder,
  ProjectDetail as ProjectDetailType,
  ProjectMemory,
  ProjectMemoryResponse,
} from "../../types/api";
import { ClientStakeholdersStructuredCard } from "./ClientStakeholdersStructuredCard";
import {
  ClientKeyContactsCard,
  ClientRelationshipContextCard,
  ManualContactSignalsCard,
  PinnedCommunicationRemindersCard,
  ProjectStakeholdersHero,
  StakeholderAiAnalysisCard,
  StakeholderMaintenanceSection,
  StakeholderObservationsCard,
  StakeholderPinnedReminderEditor,
  StakeholderRelationshipMap,
  normalizeClientName,
  splitContactLines,
  type ClientSummary,
  type VisualContact,
} from "./ProjectStakeholderSections";
import { useProjectMemorySummary } from "./useProjectMemorySummary";

interface ProjectStakeholdersTabProps {
  projectDetail: ProjectDetailType;
  projectId: string;
}

export function ProjectStakeholdersTab({ projectDetail, projectId }: ProjectStakeholdersTabProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const navigate = useNavigate();
  const { project } = projectDetail;
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [clientMemory, setClientMemory] = useState<ClientMemory | null>(null);
  const [structuredStakeholders, setStructuredStakeholders] = useState<ClientStakeholder[]>([]);
  const [contactDraft, setContactDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingContact, setSavingContact] = useState(false);

  const stakeholderInsight = useProjectMemorySummary({
    errorMessage: isZh ? "生成干系人摘要失败，请稍后重试" : "Failed to generate stakeholder summary",
    language: i18n.language,
    memoryVersion: memory?.memory_version ?? project.memory_version ?? 0,
    projectId,
    summaryType: "stakeholder",
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const memoryData = await api.get<ProjectMemoryResponse>(`/projects/${projectId}/memory`);
        if (cancelled) return;
        setMemory(memoryData.memory);

        const clientName = project.client?.trim() || "";
        if (!clientName) {
          setClient(null);
          setClientMemory(null);
          setStructuredStakeholders([]);
          setContactDraft("");
          return;
        }

        const clients = await api.get<ClientSummary[]>("/clients");
        if (cancelled) return;
        const matchedClient = clients.find((item) => normalizeClientName(item.name) === normalizeClientName(clientName));
        setClient(matchedClient || null);
        setContactDraft(matchedClient?.contact || "");

        if (!matchedClient) {
          setClientMemory(null);
          setStructuredStakeholders([]);
          return;
        }

        const [clientMemoryData, stakeholderData] = await Promise.all([
          api.get<ClientMemoryResponse>(`/clients/${matchedClient.id}/memory`),
          api.get<ClientStakeholder[]>(`/clients/${matchedClient.id}/stakeholders`),
        ]);
        if (!cancelled) {
          setClientMemory(clientMemoryData.memory);
          setStructuredStakeholders(stakeholderData);
        }
      } catch (error) {
        console.error("Failed to load project stakeholders:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [project.client, projectId]);

  const pinnedNotes = memory?.stakeholder_notes_detail?.pinned || [];
  const aiNotes = memory?.stakeholder_notes_detail?.ai || memory?.stakeholder_notes || [];
  const keyContacts = clientMemory?.key_contacts || [];
  const manualContactLines = splitContactLines(client?.contact);
  const draftContactLines = splitContactLines(contactDraft);
  const sensitiveTopics = clientMemory?.sensitive_topics || [];
  const decisionPatterns = clientMemory?.decision_patterns || [];
  const visualContacts: VisualContact[] = structuredStakeholders.length
    ? structuredStakeholders.map((stakeholder) => ({
        name: stakeholder.name || (isZh ? "未命名干系人" : "Unnamed stakeholder"),
        note: stakeholder.concerns || stakeholder.note || stakeholder.communication_preference || "",
        role: stakeholder.role || stakeholder.influence_type || (isZh ? "角色待补充" : "Role missing"),
        source: isZh ? "结构化干系人" : "Structured stakeholder",
      }))
    : keyContacts.length
      ? keyContacts.map((contact) => ({
          name: contact.name || (isZh ? "未命名联系人" : "Unnamed contact"),
          note: contact.note || "",
          role: contact.role || (isZh ? "角色待补充" : "Role missing"),
          source: isZh ? "客户记忆" : "Client memory",
        }))
      : draftContactLines.map((line, index) => ({
          name: line.split(/[，,|｜]/)[0]?.trim() || `${isZh ? "联系人" : "Contact"} ${index + 1}`,
          note: line,
          role: isZh ? "手动维护" : "Manual",
          source: isZh ? "客户资料" : "Client record",
        }));

  const stakeholderScore = useMemo(() => {
    let score = 0;
    if (client) score += 1;
    if (structuredStakeholders.length || keyContacts.length) score += 1;
    if (pinnedNotes.length) score += 1;
    if (decisionPatterns.length || sensitiveTopics.length) score += 1;
    return score;
  }, [
    client,
    decisionPatterns.length,
    keyContacts.length,
    pinnedNotes.length,
    sensitiveTopics.length,
    structuredStakeholders.length,
  ]);

  const saveClientContact = async () => {
    if (!client) return;
    setSavingContact(true);
    try {
      const updated = await api.put<ClientSummary>(`/clients/${client.id}`, {
        contact: contactDraft,
      });
      setClient((current) => (current ? { ...current, contact: updated.contact ?? contactDraft } : current));
    } catch (error) {
      console.error("Failed to save client stakeholders:", error);
    } finally {
      setSavingContact(false);
    }
  };

  return (
    <div className="space-y-6">
      <ProjectStakeholdersHero
        client={client}
        isZh={isZh}
        keyContactCount={structuredStakeholders.length || keyContacts.length}
        onManageAnchors={() => navigate(`/projects/${projectId}/anchors`)}
        onOpenClientMemory={() => {
          if (client) navigate(`/clients/${client.id}/memory`);
        }}
        pinnedCount={pinnedNotes.length}
        project={project}
        stakeholderScore={stakeholderScore}
      />

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-gray-200 bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <ClientStakeholdersStructuredCard
              clientId={client?.id}
              isZh={isZh}
              onChanged={setStructuredStakeholders}
              projectId={projectId}
              stakeholders={structuredStakeholders}
            />
            <StakeholderRelationshipMap
              client={client}
              isZh={isZh}
              project={project}
              visualContacts={visualContacts}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <StakeholderMaintenanceSection
              client={client}
              contactDraft={contactDraft}
              isZh={isZh}
              onContactDraftChange={setContactDraft}
              onSave={() => void saveClientContact()}
              savingContact={savingContact}
            />
            <StakeholderPinnedReminderEditor
              isZh={isZh}
              memory={memory}
              onSaved={setMemory}
              projectId={projectId}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <StakeholderAiAnalysisCard
              content={stakeholderInsight.content}
              error={stakeholderInsight.error}
              isZh={isZh}
              loading={stakeholderInsight.loading}
              onRefresh={() => void stakeholderInsight.refresh(true)}
            />
            <ClientRelationshipContextCard
              decisionPatterns={decisionPatterns}
              isZh={isZh}
              sensitiveTopics={sensitiveTopics}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-3">
            <ClientKeyContactsCard
              client={client}
              contacts={keyContacts}
              isZh={isZh}
            />
            <PinnedCommunicationRemindersCard
              isZh={isZh}
              pinnedNotes={pinnedNotes}
            />
            <ManualContactSignalsCard
              isZh={isZh}
              manualContactLines={manualContactLines}
            />
          </section>

          <StakeholderObservationsCard
            aiNotes={aiNotes}
            isZh={isZh}
          />
        </>
      )}
    </div>
  );
}
