type PaymentType = "received" | "invoiced" | "expense";

interface PaymentFormState {
  amount: string;
  note: string;
  payment_date: string;
  payment_type: PaymentType;
}

interface PaymentTypeOption {
  activeClass: string;
  labelEn: string;
  labelZh: string;
  value: PaymentType;
}

interface ProjectFinancialsPaymentFormProps {
  form: PaymentFormState;
  isZh: boolean;
  onChange: (field: "amount" | "payment_date" | "note", value: string) => void;
  onPaymentTypeChange: (value: PaymentType) => void;
  options: PaymentTypeOption[];
}

export function ProjectFinancialsPaymentForm({
  form,
  isZh,
  onChange,
  onPaymentTypeChange,
  options,
}: ProjectFinancialsPaymentFormProps) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-codex-ink-soft mb-1.5">
          {isZh ? "类型" : "Type"}
        </label>
        <div className="flex gap-2">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onPaymentTypeChange(option.value)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                form.payment_type === option.value
                  ? option.activeClass
                  : "bg-white border-codex-line text-codex-ink-soft hover:bg-codex-bg-tint"
              }`}
            >
              {isZh ? option.labelZh : option.labelEn}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-codex-ink-soft mb-1.5">
          {isZh ? "金额" : "Amount"}
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-codex-ink-mute">
            ¥
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={form.amount}
            onChange={(event) => onChange("amount", event.target.value)}
            className="w-full pl-12 pr-4 py-2.5 border border-codex-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="0.00"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-codex-ink-soft mb-1.5">
          {isZh ? "日期" : "Date"}
        </label>
        <input
          type="date"
          required
          value={form.payment_date}
          onChange={(event) => onChange("payment_date", event.target.value)}
          className="w-full px-3 py-2.5 border border-codex-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-codex-ink-soft mb-1.5">
          {isZh ? "备注" : "Note"}
        </label>
        <input
          type="text"
          value={form.note}
          onChange={(event) => onChange("note", event.target.value)}
          className="w-full px-3 py-2.5 border border-codex-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder={isZh ? "可选" : "Optional"}
        />
      </div>
    </>
  );
}
