import { act, renderHook } from '@testing-library/react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

interface FakeSpeechResultEvent {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];

  lang = '';
  continuous = true;
  interimResults = true;
  onstart: (() => void) | null = null;
  onresult: ((event: FakeSpeechResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  recognize(transcript: string): void {
    this.onresult?.({ results: [{ 0: { transcript } }] });
  }

  fail(error = 'not-allowed'): void {
    this.onerror?.({ error });
  }
}

function installSpeechRecognition(): void {
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: FakeSpeechRecognition,
  });
}

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    FakeSpeechRecognition.instances = [];
    installSpeechRecognition();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  });

  test('지원 여부를 감지하고 한국어 설정으로 네 상태를 전이한다', () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current).toMatchObject({ isSupported: true, state: 'IDLE', recognizedText: '' });

    act(() => result.current.start());
    const recognition = FakeSpeechRecognition.instances[0];
    expect(recognition).toBeDefined();
    expect(recognition?.lang).toBe('ko-KR');
    expect(recognition?.continuous).toBe(false);
    expect(recognition?.interimResults).toBe(false);
    expect(result.current.state).toBe('LISTENING');

    act(() => recognition?.recognize('영업시간을 밤 10시까지로 바꿔줘'));
    expect(result.current).toMatchObject({
      state: 'RECOGNIZED',
      recognizedText: '영업시간을 밤 10시까지로 바꿔줘',
    });

    act(() => result.current.reset());
    expect(result.current).toMatchObject({ state: 'IDLE', recognizedText: '' });

    act(() => result.current.start());
    act(() => FakeSpeechRecognition.instances[1]?.fail('not-allowed'));
    expect(result.current).toMatchObject({ state: 'FAILED', error: 'not-allowed' });
  });

  test('미지원 브라우저는 시작하지 않고 FAILED 상태를 제공한다', () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(false);

    act(() => result.current.start());
    expect(result.current.state).toBe('FAILED');
    expect(FakeSpeechRecognition.instances).toHaveLength(0);
  });

  test('unmount 시 인식을 중단하고 이벤트 핸들러를 정리한다', () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    const recognition = FakeSpeechRecognition.instances[0];

    unmount();

    expect(recognition?.abort).toHaveBeenCalledOnce();
    expect(recognition?.onstart).toBeNull();
    expect(recognition?.onresult).toBeNull();
    expect(recognition?.onerror).toBeNull();
    expect(recognition?.onend).toBeNull();
  });

  test('서버 전송 경계에는 인식된 문자열만 노출하고 오디오 객체를 만들지 않는다', () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => FakeSpeechRecognition.instances[0]?.recognize('대표 메뉴를 비빔밥으로 바꿔줘'));

    expect(result.current.recognizedText).toBe('대표 메뉴를 비빔밥으로 바꿔줘');
    expect(result.current).not.toHaveProperty('audio');
    expect(result.current).not.toHaveProperty('blob');
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
