import type { DeviceConfig } from '@deviceforge/core';
import { Settings2 } from 'lucide-react';
import { useIssueText } from '../form/ConfigIssuesContext';
import { FormField, SwitchRow, TextArea, TextInput } from '../form/FormControls';
import { FormSection } from '../form/FormSection';

export function BasicSection({
  config,
  onChange,
  idLocked = false,
  disabled = false,
}: {
  config: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  idLocked?: boolean;
  disabled?: boolean;
}) {
  const idError = useIssueText('id');
  const nameError = useIssueText('name');
  const descriptionError = useIssueText('description');
  const autoStartError = useIssueText('autoStart');

  return (
    <FormSection
      title="基本信息"
      description="设备标识、显示名称和启动行为。"
      icon={<Settings2 className="h-4 w-4 text-accent-400" />}
      paths={['', 'id', 'name', 'description', 'autoStart']}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="设备 ID"
          required
          error={idError}
          hint={
            idLocked
              ? '编辑模式下不可修改 ID；如需更换请新建设备。'
              : '只能包含字母、数字、下划线和中划线。'
          }
        >
          <TextInput
            value={config.id}
            onChange={(id) => onChange({ ...config, id })}
            disabled={disabled || idLocked}
            monospace
            placeholder="my-device"
          />
        </FormField>

        <FormField label="名称" required error={nameError}>
          <TextInput
            value={config.name}
            onChange={(name) => onChange({ ...config, name })}
            disabled={disabled}
            placeholder="我的设备"
          />
        </FormField>

        <FormField
          label="描述"
          hint="可选，用于在设备列表中说明协议或用途。"
          error={descriptionError}
          className="sm:col-span-2"
        >
          <TextArea
            value={config.description ?? ''}
            onChange={(description) =>
              onChange({
                ...config,
                description: description.trim() === '' ? undefined : description,
              })
            }
            disabled={disabled}
            rows={2}
            placeholder="例如：AA55 魔数 + 总长度 + CRC16/MODBUS"
          />
        </FormField>

        <div className="sm:col-span-2">
          <SwitchRow
            label="随服务自动启动"
            hint="服务下次启动时生效；运行中修改配置需要先停止设备。"
            checked={config.autoStart}
            onChange={(autoStart) => onChange({ ...config, autoStart })}
            disabled={disabled}
          />
          {autoStartError && (
            <p className="mt-1 text-[10.5px] leading-4 text-rose-300">{autoStartError}</p>
          )}
        </div>
      </div>
    </FormSection>
  );
}
