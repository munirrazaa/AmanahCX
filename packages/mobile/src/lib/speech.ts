/**
 * Platform-safe wrapper around expo-speech-recognition.
 * The library's web build is incompatible with this Expo SDK and crashes at
 * import time, so on web (used for previews) the mic is simply unavailable
 * and everything here no-ops.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

let mod: typeof import('expo-speech-recognition') | null = null;
function native() {
  if (!mod) mod = require('expo-speech-recognition');
  return mod!;
}

export const speechAvailable = !isWeb;

export const Speech = {
  start(options: Record<string, unknown>) {
    if (isWeb) return;
    native().ExpoSpeechRecognitionModule.start(options as any);
  },
  stop() {
    if (isWeb) return;
    native().ExpoSpeechRecognitionModule.stop();
  },
  async requestPermissionsAsync(): Promise<{ granted: boolean }> {
    if (isWeb) return { granted: false };
    return native().ExpoSpeechRecognitionModule.requestPermissionsAsync();
  },
};

export function useSpeechEvent(eventName: string, handler: (event: any) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (isWeb) return;
    const sub = native().addSpeechRecognitionListener(
      eventName as any,
      ((event: any) => handlerRef.current(event)) as any,
    );
    return () => sub.remove();
  }, [eventName]);
}
