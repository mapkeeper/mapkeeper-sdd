import { useEffect, useState } from 'react';
import './GenerationProgress.css';

/**
 * Long waits need to say what is happening, not just that something is.
 *
 * A bare spinner over a 20-35 second call reads as a hang to an owner in their
 * fifties or sixties, who then leaves the screen. This shows which step the work
 * is on and, once the wait stops being ordinary, says so in plain words.
 */
export interface GenerationProgressProps {
  title: string;
  /** Step labels in the order they run. The last one stays in progress. */
  steps: readonly string[];
  /** Seconds at which each step becomes the active one. */
  stepStartSeconds?: readonly number[];
  /** Shown under the steps before the wait becomes unusual. */
  hint?: string;
}

const DEFAULT_STEP_START_SECONDS = [0, 2, 6] as const;

const LONG_WAIT_NOTICES: readonly { after: number; message: string }[] = [
  { after: 30, message: '네트워크가 느린 것 같아요. 조금만 더 기다려 주시거나, 잠시 후 다시 시도해 주세요.' },
  { after: 20, message: '거의 다 됐어요. 화면을 닫지 않으면 결과를 바로 보여드릴게요.' },
  { after: 10, message: '조금 더 시간이 걸리고 있어요. 사장님 요청을 꼼꼼히 정리하는 중이에요.' },
];

function longWaitNotice(elapsedSeconds: number): string | null {
  return LONG_WAIT_NOTICES.find(({ after }) => elapsedSeconds >= after)?.message ?? null;
}

function activeStepIndex(elapsedSeconds: number, startSeconds: readonly number[], stepCount: number): number {
  let index = 0;
  for (let step = 0; step < stepCount; step += 1) {
    if (elapsedSeconds >= (startSeconds[step] ?? Number.POSITIVE_INFINITY)) index = step;
  }
  return index;
}

export function GenerationProgress({
  title,
  steps,
  stepStartSeconds = DEFAULT_STEP_START_SECONDS,
  hint,
}: GenerationProgressProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const active = activeStepIndex(elapsedSeconds, stepStartSeconds, steps.length);
  const notice = longWaitNotice(elapsedSeconds);

  return (
    <section className="generation-progress" role="status" aria-live="polite">
      <span className="generation-progress__spinner" aria-hidden="true" />
      <h1 className="generation-progress__title">{title}</h1>
      <ol className="generation-progress__steps">
        {steps.map((step, index) => {
          const state = index < active ? 'done' : index === active ? 'active' : 'pending';
          return (
            <li key={step} className={`generation-progress__step is-${state}`}>
              <span className="generation-progress__marker" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
              </span>
              <span>{step}</span>
              <span className="sr-only">{state === 'done' ? ' 완료' : state === 'active' ? ' 진행 중' : ' 대기 중'}</span>
            </li>
          );
        })}
      </ol>
      {notice ? <p className="generation-progress__notice">{notice}</p> : hint ? <p className="generation-progress__hint">{hint}</p> : null}
    </section>
  );
}
