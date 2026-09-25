import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase';

type AuthActionState = 'idle' | 'loading' | 'error';

export function GoogleAuthButton() {
  const auth = firebaseAuth;
  const [user, setUser] = useState<User | null>(null);
  const [actionState, setActionState] = useState<AuthActionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, setUser);
  }, [auth]);

  if (!isFirebaseConfigured || !auth) return null;

  const handleAuth = async () => {
    setActionState('loading');
    setErrorMessage(null);

    try {
      if (user) {
        await signOut(auth);
      } else {
        await signInWithPopup(auth, new GoogleAuthProvider());
      }
      setActionState('idle');
    } catch (error: unknown) {
      setActionState('error');
      setErrorMessage(error instanceof Error ? 'Google 로그인을 완료하지 못했어요.' : '로그인 중 문제가 발생했어요.');
    }
  };

  const label = actionState === 'loading'
    ? '처리 중…'
    : user
      ? `${user.displayName ?? 'Google 계정'} 로그아웃`
      : 'Google로 로그인';

  return (
    <div className="google-auth">
      <button type="button" className="google-auth__button" onClick={() => void handleAuth()} disabled={actionState === 'loading'}>
        <span className="google-auth__mark" aria-hidden="true">G</span>
        <span>{label}</span>
      </button>
      {errorMessage ? <p className="google-auth__error" role="status">{errorMessage}</p> : null}
    </div>
  );
}
