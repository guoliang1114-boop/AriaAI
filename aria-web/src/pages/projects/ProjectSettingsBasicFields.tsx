import { ChevronRight, Loader2 } from "lucide-react";

interface ProjectSettingsBasicFieldsProps {
  client: string;
  clients: string[];
  contractAmount: number | string;
  endDate: string;
  isEditing: boolean;
  isLoadingClients: boolean;
  isZh: boolean;
  name: string;
  onChange: (field: "name" | "client" | "start_date" | "end_date" | "contract_amount", value: string) => void;
  startDate: string;
}

export function ProjectSettingsBasicFields({
  client,
  clients,
  contractAmount,
  endDate,
  isEditing,
  isLoadingClients,
  isZh,
  name,
  onChange,
  startDate,
}: ProjectSettingsBasicFieldsProps) {
  return (
    <>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {isZh ? "项目名称" : "Project Name"}
          {isEditing && <span className="ml-1 text-red-500">*</span>}
        </label>
        <input
          type="text"
          value={name}
          onChange={(event) => onChange("name", event.target.value)}
          disabled={!isEditing}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {isZh ? "客户名称" : "Client Name"}
          {isEditing && <span className="ml-1 text-red-500">*</span>}
        </label>
        {isEditing ? (
          <div className="relative">
            <select
              value={client}
              onChange={(event) => onChange("client", event.target.value)}
              disabled={isLoadingClients}
              className="w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
            >
              <option value="">
                {isZh ? "选择客户" : "Select a client"}
              </option>
              {clients.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              {isLoadingClients ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 rotate-90 text-gray-400" />
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm text-gray-500">
            {client || (isZh ? "未设置" : "Not set")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {isZh ? "开始日期" : "Start Date"}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(event) => onChange("start_date", event.target.value)}
            disabled={!isEditing}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {isZh ? "结束日期" : "End Date"}
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(event) => onChange("end_date", event.target.value)}
            disabled={!isEditing}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {isZh ? "合同金额（万元）" : "Contract Amount (10k CNY)"}
        </label>
        <input
          type="number"
          value={contractAmount}
          onChange={(event) => onChange("contract_amount", event.target.value)}
          disabled={!isEditing}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-100 disabled:text-gray-500"
        />
      </div>
    </>
  );
}
