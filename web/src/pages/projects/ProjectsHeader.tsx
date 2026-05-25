import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Building2, Check, ChevronDown, FolderKanban, Plus, Search, User } from "lucide-react";

interface ProjectsHeaderProps {
  clientOptions: string[];
  isLoadingUsers: boolean;
  isZh: boolean;
  onCreateProject: () => void;
  onSearchChange: (value: string) => void;
  onSelectedClientChange: (value: string) => void;
  onSelectedMemberChange: (value: number | null) => void;
  searchQuery: string;
  selectedClient: string;
  selectedMemberId: number | null;
  users: Array<{ id: number; display_name: string }>;
}

interface FilterOption {
  label: string;
  value: string;
}

interface FilterDropdownProps {
  disabled?: boolean;
  icon: ComponentType<{ className?: string }>;
  onChange: (value: string) => void;
  options: FilterOption[];
  value: string;
  widthClass: string;
}

function FilterDropdown({
  disabled = false,
  icon: Icon,
  onChange,
  options,
  value,
  widthClass,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${widthClass}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-left text-[13px] font-medium leading-none text-gray-700 transition-all hover:bg-white focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon className="h-4 w-4 shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">{selectedOption.label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-30 mt-2 max-h-72 w-full min-w-56 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-gray-900/10">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value || "__all__"}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                  isSelected ? "bg-primary/10 text-primary" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectsHeader({
  clientOptions,
  isLoadingUsers,
  isZh,
  onCreateProject,
  onSearchChange,
  onSelectedClientChange,
  onSelectedMemberChange,
  searchQuery,
  selectedClient,
  selectedMemberId,
  users,
}: ProjectsHeaderProps) {
  const clientFilterOptions = [
    { label: isZh ? "\u5168\u90e8\u5ba2\u6237" : "All clients", value: "" },
    ...clientOptions.map((client) => ({ label: client, value: client })),
  ];
  const memberFilterOptions = [
    { label: isZh ? "\u5168\u90e8\u6210\u5458" : "All members", value: "" },
    ...users.map((user) => ({ label: user.display_name, value: String(user.id) })),
  ];

  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="mx-auto max-w-full px-6 py-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {isZh ? "\u9879\u76ee\u7a7a\u95f4" : "Project Workspace"}
                </h1>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              {isZh
                ? "\u6309\u9636\u6bb5\u7ba1\u7406\u9879\u76ee\uff0c\u5feb\u901f\u67e5\u770b\u5546\u52a1\u3001\u4ea4\u4ed8\u548c\u5f52\u6863\u5185\u5bb9\u3002"
                : "Manage projects by phase and quickly review business, delivery, and archived work."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={isZh ? "\u641c\u7d22\u9879\u76ee..." : "Search projects..."}
                className="h-9 w-56 rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-[13px] font-medium leading-none text-gray-700 transition-all placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <FilterDropdown
              icon={Building2}
              onChange={onSelectedClientChange}
              options={clientFilterOptions}
              value={selectedClient}
              widthClass="w-44"
            />

            <FilterDropdown
              disabled={isLoadingUsers}
              icon={User}
              onChange={(value) => onSelectedMemberChange(value ? Number(value) : null)}
              options={memberFilterOptions}
              value={selectedMemberId == null ? "" : String(selectedMemberId)}
              widthClass="w-40"
            />

            <button
              onClick={onCreateProject}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold leading-none text-white transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20"
            >
              <Plus className="h-4 w-4" />
              {isZh ? "\u65b0\u5efa\u9879\u76ee" : "New Project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
