/**
 * Voice-input language preference, shared by the New Lead and New Task
 * screens and remembered per device. Pakistani Punjabi speakers get the
 * best results with the Urdu setting (Shahmukhi Punjabi has no dedicated
 * recognizer), which the اردو option covers.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'crm_voice_lang';

export interface VoiceLang {
  code:  string;  // BCP-47 tag passed to the speech recognizer
  label: string;  // shown on the selector chip
}

export const VOICE_LANGS: VoiceLang[] = [
  { code: 'en-US', label: 'EN' },
  { code: 'ur-PK', label: 'اردو' },
  { code: 'pa-IN', label: 'ਪੰਜਾਬੀ' },
];

export async function getVoiceLang(): Promise<string> {
  const saved = await AsyncStorage.getItem(KEY);
  return saved && VOICE_LANGS.some((l) => l.code === saved) ? saved : 'en-US';
}

export async function setVoiceLang(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY, code);
}
