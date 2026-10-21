
// Language of the patient's WhatsApp messages. Urdu first: most patients (or the
// family member whose phone gets the messages) read Urdu more easily than English.
const OPTIONS = [
  { value: "ur", label: "اردو", hint: "Urdu" },
  { value: "en", label: "English", hint: "English" },
];

const LanguageSelect = ({ value, onChange, label = "Message language" }) => (
  <div>
    <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
      {OPTIONS.map((option) => {
        const selected = (value || "ur") === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              selected ? "bg-primary text-white" : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </div>
);

export default LanguageSelect;
