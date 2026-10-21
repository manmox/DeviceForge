import type { DeviceConfig } from '@deviceforge/core';
import { Database } from 'lucide-react';
import { FormSection } from '../form/FormSection';
import { VisualJsonEditor } from '../form/VisualJsonEditor';

export function StateSection({
  config,
  onChange,
  disabled = false,
}: {
  config: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  disabled?: boolean;
}) {
  return (
    <FormSection
      title="初始状态"
      description="设备启动时复制到运行时；初始值不会解析模板，规则通过 $state.* 读取。"
      icon={<Database className="h-4 w-4 text-sky-400" />}
      path="state"
    >
      <VisualJsonEditor
        value={config.state}
        onChange={(state) => onChange({ ...config, state })}
        keyPlaceholder="变量名"
        addLabel="添加变量"
        emptyText="暂无状态变量"
        templates={false}
        disabled={disabled}
      />
    </FormSection>
  );
}
