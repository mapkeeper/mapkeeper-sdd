import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';

interface WizardPrimaryAction {
  label: string;
  onClick(): void;
  disabled?: boolean;
}

export interface WizardProps {
  title: string;
  currentStep: number;
  totalSteps: number;
  primaryAction: WizardPrimaryAction;
  children: ReactNode;
  dirty?: boolean;
}

export function Wizard({
  title,
  currentStep,
  totalSteps,
  primaryAction,
  children,
  dirty = false,
}: WizardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(currentStep);

  useEffect(() => {
    if (previousStepRef.current !== currentStep) headingRef.current?.focus();
    previousStepRef.current = currentStep;
  }, [currentStep]);

  useUnsavedChangesWarning(dirty);

  return (
    <section style={{ display: 'grid', gap: 20, color: '#191f28', fontFamily: 'Pretendard, sans-serif', fontSize: 18, fontWeight: 500 }}>
      <p aria-label="진행 단계" style={{ margin: 0, color: '#6b7280', fontSize: 16, fontWeight: 500 }}>
        {currentStep} / {totalSteps} 단계
      </p>
      <h1 ref={headingRef} tabIndex={-1} style={{ margin: 0, color: '#191f28', fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', textAlign: 'left' }}>{title}</h1>
      <div>{children}</div>
      <button
        data-testid="wizard-primary-action"
        type="button"
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        style={{ minHeight: 56, padding: '12px 18px', fontFamily: 'Pretendard, sans-serif', fontSize: 18, fontWeight: 700 }}
      >
        {primaryAction.label}
      </button>
    </section>
  );
}
