import { Building2, Check, ChevronDown } from 'lucide-react'
import type { RefObject } from 'react'

interface ClientRecord {
  id: number
  name: string
  industry: string
}

interface NewProjectClientSelectProps {
  clientDropdownRef: RefObject<HTMLDivElement | null>
  clientSearch: string
  clients: ClientRecord[]
  onClientSearchChange: (value: string) => void
  onSelectClient: (clientName: string) => void
  onToggleDropdown: () => void
  selectedClient: string
  showClientDropdown: boolean
}

export function NewProjectClientSelect({
  clientDropdownRef,
  clientSearch,
  clients,
  onClientSearchChange,
  onSelectClient,
  onToggleDropdown,
  selectedClient,
  showClientDropdown,
}: NewProjectClientSelectProps) {
  return (
    <div className="relative" ref={clientDropdownRef}>
      <label className="block text-xs font-medium text-codex-ink-variant mb-1.5">
        客户名称 <span className="text-error">*</span>
      </label>
      <button
        type="button"
        onClick={onToggleDropdown}
        className={`w-full flex items-center gap-2.5 px-3.5 py-3 bg-codex-bg-tint-lowest rounded-xl border text-sm transition-colors text-left ${
          showClientDropdown ? 'border-primary/30 ring-2 ring-primary/10' : 'border-outline/15 hover:border-outline/30'
        }`}
      >
        <Building2 className="w-4 h-4 text-codex-ink-mute flex-shrink-0" />
        <span className={`flex-1 truncate ${selectedClient ? 'text-codex-ink' : 'text-codex-ink-mute'}`}>
          {selectedClient || '选择客户'}
        </span>
        <ChevronDown className={`w-4 h-4 text-codex-ink-mute transition-transform flex-shrink-0 ${showClientDropdown ? 'rotate-180' : ''}`} />
      </button>

      {showClientDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-codex-bg-tint-lowest rounded-xl border border-outline/15 shadow-lg z-30 overflow-hidden">
          <div className="p-2 border-b border-outline/10">
            <input
              autoFocus
              type="text"
              value={clientSearch}
              onChange={e => onClientSearchChange(e.target.value)}
              placeholder="搜索客户..."
              className="w-full px-3 py-1.5 text-sm bg-codex-bg-tint rounded-lg outline-none text-codex-ink placeholder:text-codex-ink-mute"
            />
          </div>
          <div className="max-h-52 overflow-auto py-1">
            {clients.length === 0 ? (
              <p className="px-4 py-3 text-sm text-codex-ink-mute text-center">无匹配客户</p>
            ) : (
              clients.map(client => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => onSelectClient(client.name)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-codex-bg-tint ${
                    selectedClient === client.name ? 'bg-secondary-container/40 text-codex-accent' : 'text-codex-ink'
                  }`}
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-codex-accent" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-medium truncate">{client.name}</p>
                    {client.industry && <p className="text-xs text-codex-ink-mute truncate">{client.industry}</p>}
                  </div>
                  {selectedClient === client.name && <Check className="w-4 h-4 text-codex-accent flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
