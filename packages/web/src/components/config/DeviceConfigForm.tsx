import type { DeviceConfig } from '@deviceforge/core';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  configPanelId,
  configTabId,
  firstIssueSection,
  type ConfigSectionId,
  visibleConfigSections,
} from '../../lib/config-sections';
import type { ValidationIssue } from '../../types';
import { ConfigIssuesProvider } from '../form/ConfigIssuesContext';
import { ConfigSectionNav } from './ConfigSectionNav';
import { BasicSection } from './BasicSection';
import { CodecSection } from './CodecSection';
import { DeviceInfoSection } from './DeviceInfoSection';
import { FramingSection } from './FramingSection';
import { RulesSection } from './RulesSection';
import { StateSection } from './StateSection';
import { TransportSection } from './TransportSection';

export function DeviceConfigForm({
  value,
  onChange,
  issues = [],
  idLocked = false,
  disabled = false,
  activeSection,
  defaultSection = 'basic',
  onActiveSectionChange,
}: {
  value: DeviceConfig;
  onChange: (next: DeviceConfig) => void;
  issues?: ValidationIssue[];
  idLocked?: boolean;
  disabled?: boolean;
  activeSection?: ConfigSectionId;
  defaultSection?: ConfigSectionId;
  onActiveSectionChange?: (section: ConfigSectionId) => void;
}) {
  const idBase = useId();
  const [internalSection, setInternalSection] =
    useState<ConfigSectionId>(defaultSection);
  const active = activeSection ?? internalSection;
  const sections = visibleConfigSections(value);

  const selectSection = useCallback(
    (next: ConfigSectionId) => {
      if (activeSection === undefined) setInternalSection(next);
      onActiveSectionChange?.(next);
    },
    [activeSection, onActiveSectionChange],
  );

  const handledIssuesRef = useRef<ValidationIssue[] | null>(null);
  useEffect(() => {
    if (issues.length === 0) {
      handledIssuesRef.current = issues;
      return;
    }
    if (handledIssuesRef.current === issues) return;
    handledIssuesRef.current = issues;
    const first = firstIssueSection(issues);
    if (first) selectSection(first);
  }, [issues, selectSection]);

  useEffect(() => {
    if (!sections.some((section) => section.id === active)) selectSection('transport');
  }, [active, sections, selectSection]);

  const content: Record<ConfigSectionId, ReactNode> = {
    basic: (
      <BasicSection
        config={value}
        onChange={onChange}
        idLocked={idLocked}
        disabled={disabled}
      />
    ),
    deviceInfo: (
      <DeviceInfoSection
        config={value}
        onChange={onChange}
        disabled={disabled}
      />
    ),
    transport: (
      <TransportSection config={value} onChange={onChange} disabled={disabled} />
    ),
    framing: (
      <FramingSection config={value} onChange={onChange} disabled={disabled} />
    ),
    codec: (
      <CodecSection
        config={value}
        onChange={onChange}
        disabled={disabled}
        active={active === 'codec'}
      />
    ),
    state: (
      <StateSection config={value} onChange={onChange} disabled={disabled} />
    ),
    rules: (
      <RulesSection
        config={value}
        onChange={onChange}
        disabled={disabled}
        active={active === 'rules'}
      />
    ),
  };

  return (
    <ConfigIssuesProvider issues={issues}>
      <div className="flex h-full min-h-0 flex-col gap-2 lg:flex-row lg:gap-3">
        <ConfigSectionNav
          active={active}
          onSelect={selectSection}
          config={value}
          idBase={idBase}
        />

        <div className="relative min-h-0 flex-1">
          {sections.map((section) => {
            const isActive = active === section.id;
            return (
              <div
                key={section.id}
                role="tabpanel"
                id={configPanelId(idBase, section.id)}
                aria-labelledby={configTabId(idBase, section.id)}
                aria-hidden={!isActive}
                inert={!isActive}
                className={
                  isActive
                    ? 'absolute inset-0 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]'
                    : 'pointer-events-none invisible absolute inset-0 overflow-hidden'
                }
              >
                {content[section.id]}
              </div>
            );
          })}
        </div>
      </div>
    </ConfigIssuesProvider>
  );
}
