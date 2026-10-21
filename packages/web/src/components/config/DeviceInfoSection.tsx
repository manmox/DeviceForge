import type { DeviceConfig } from '@deviceforge/core';
import { Fingerprint } from 'lucide-react';
import {
  DEVICE_INFO_FIELDS,
  updateDeviceInfoField,
  type DeviceInfoField,
} from '../../lib/device-info';
import { useIssueText } from '../form/ConfigIssuesContext';
import { FormField, TextInput } from '../form/FormControls';
import { FormSection } from '../form/FormSection';

export function DeviceInfoSection({
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
      title="设备信息"
      description="可选的厂商与硬件标识，仅用于识别和展示；不参与分帧、编解码、规则或模板，也不作为认证凭据。"
      icon={<Fingerprint className="h-4 w-4 text-accent-400" />}
      path="deviceInfo"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {DEVICE_INFO_FIELDS.map((field) => (
          <DeviceInfoFieldRow
            key={field.key}
            field={field}
            value={config.deviceInfo?.[field.key] ?? ''}
            onChange={(value) =>
              onChange(updateDeviceInfoField(config, field.key, value))
            }
            disabled={disabled}
          />
        ))}
      </div>
    </FormSection>
  );
}

function DeviceInfoFieldRow({
  field,
  value,
  onChange,
  disabled,
}: {
  field: DeviceInfoField;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const error = useIssueText(`deviceInfo.${field.key}`);

  return (
    <FormField
      label={field.label}
      hint={field.hint}
      error={error}
      className={field.wide ? 'sm:col-span-2' : ''}
    >
      <TextInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        monospace={field.monospace}
        placeholder={field.placeholder}
      />
    </FormField>
  );
}
