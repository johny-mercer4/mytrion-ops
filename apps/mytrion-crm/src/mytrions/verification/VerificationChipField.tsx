import { useState } from 'react';
import { X } from 'lucide-react';

export function VerificationChipField({
  label,
  values,
  suggestions,
  onChange,
  placeholder = 'Add…',
}: {
  label: string;
  values: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const unused = suggestions.filter((item) => !values.includes(item));

  const add = (item: string): void => {
    const next = item.trim().toLowerCase();
    if (!next || values.includes(next)) return;
    onChange([...values, next]);
    setDraft('');
  };

  return (
    <div className="vf-form-row">
      <span>{label}</span>
      <div className="vf-chip-field">
        {values.length > 0 ? (
          <div className="vf-chips" role="list">
            {values.map((item) => (
              <span key={item} className="vf-pick" role="listitem">
                {item}
                <button
                  type="button"
                  className="vf-pick-x"
                  aria-label={`Remove ${item}`}
                  onClick={() => onChange(values.filter((value) => value !== item))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {unused.length > 0 ? (
          <div className="vf-chips" role="group" aria-label={`${label} suggestions`}>
            {unused.map((item) => (
              <button key={item} type="button" className="vf-chip" onClick={() => add(item)}>
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
        />
      </div>
    </div>
  );
}
