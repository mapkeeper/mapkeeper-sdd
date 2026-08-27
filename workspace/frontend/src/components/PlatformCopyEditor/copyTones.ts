/**
 * The three rewrites owners asked for by name, and what each one tells the model.
 *
 * Kept beside the editor rather than inside it so the component file exports only
 * a component.
 */
export const COPY_TONES = [
  { key: 'POLITE', label: '정중하게', instruction: '문구를 조금 더 정중하고 격식 있는 말투로 다시 써주세요.' },
  { key: 'FRIENDLY', label: '친근하게', instruction: '문구를 단골 손님에게 말하듯 친근한 말투로 다시 써주세요.' },
  { key: 'SHORT', label: '짧게', instruction: '문구를 핵심만 남기고 두세 문장으로 짧게 다시 써주세요.' },
] as const;

export type CopyToneKey = (typeof COPY_TONES)[number]['key'];

export const DRAFT_TEXT_MAX_LENGTH = 750;

export interface PlatformCopy {
  platform: 'google' | 'naver' | 'kakao';
  text: string;
  keywords: string[];
  contentRules: string[];
}
