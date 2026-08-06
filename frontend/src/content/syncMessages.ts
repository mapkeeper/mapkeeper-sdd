import type { SyncJobStatus } from '@/types/domain';

export const SYNC_STATUS_TITLES: Record<SyncJobStatus, string> = {
  PENDING: '동기화 대기 중',
  PROCESSING: '플랫폼에 반영 중',
  RETRYING: '실패한 플랫폼 재시도 중',
  PARTIAL_SUCCESS: '일부 플랫폼 반영 완료',
  SUCCESS: '모든 플랫폼 반영 완료',
  FAILED: '플랫폼 반영 실패',
};

export const SYNC_COPY = {
  partialSuccess: '성공한 플랫폼은 그대로 유지하고 실패한 플랫폼만 다시 시도합니다.',
  retryAction: '실패한 플랫폼 다시 시도',
  retryingAction: '재시도 요청 중…',
  pollingError: '동기화 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  networkError: '동기화 상태를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.',
} as const;

export function retryStartedMessage(platformLabels: readonly string[]): string {
  return `${platformLabels.join(', ')} 재시도를 시작했습니다.`;
}
