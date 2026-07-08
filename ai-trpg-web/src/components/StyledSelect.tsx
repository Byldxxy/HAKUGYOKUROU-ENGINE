import { useState } from 'react';
import './StyledSelect.css';

export type StyledSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type StyledSelectProps = {
  value: string;
  options: StyledSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

// SECTION: 项目统一下拉框
// NOTE: 原生 select 的弹出层由浏览器绘制，改用按钮菜单才能稳定复用项目视觉。
export default function StyledSelect({
  value,
  options,
  placeholder,
  disabled = false,
  onChange,
}: StyledSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <div
      className={`styled-select ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      tabIndex={disabled ? -1 : 0}
      onBlur={() => setIsOpen(false)}
    >
      <button
        type="button"
        className="styled-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selected?.label || placeholder || '请选择'}</span>
        <span className="styled-select-arrow" aria-hidden="true" />
      </button>

      {isOpen && !disabled && (
        <div className="styled-select-menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`styled-select-option ${option.value === value ? 'selected' : ''}`}
              disabled={option.disabled}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <span className="styled-select-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
