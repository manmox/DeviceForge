import { Code2, Loader2, SlidersHorizontal } from 'lucide-react';
import type { EditorMode } from '../../hooks/useEditorMode';
import { SegmentedControl } from './FormControls';

export function EditorModeToggle({
  mode,
  onChange,
  codeLabel = '源码',
  disabled = false,
  size = 'md',
  switching = false,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
  codeLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  switching?: boolean;
}) {
  return (
    <SegmentedControl
      ariaLabel="编辑方式"
      value={mode}
      onChange={onChange}
      disabled={disabled}
      size={size}
      options={[
        {
          value: 'visual',
          label: '可视化',
          icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
        },
        {
          value: 'code',
          label: codeLabel,
          icon: switching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Code2 className="h-3.5 w-3.5" />
          ),
        },
      ]}
    />
  );
}
