export type VoiceCallDirection = 'inbound' | 'outbound';
export type VoiceCallStatus = 'initiated' | 'ringing' | 'in-progress' | 'completed' | 'no-answer' | 'busy' | 'failed' | 'voicemail';
export interface VoiceCall {
    id: string;
    tenantId: string;
    externalCallId: string;
    provider: string;
    direction: VoiceCallDirection;
    status: VoiceCallStatus;
    fromNumber: string;
    toNumber: string;
    contactId?: string;
    dealId?: string;
    agentId?: string;
    botHandled: boolean;
    duration?: number;
    recordingUrl?: string;
    transcript?: VoiceTranscript[];
    sentiment?: CallSentiment;
    botIntent?: string;
    botEntities?: Record<string, string>;
    tags: string[];
    notes?: string;
    outcome?: string;
    startedAt: Date;
    endedAt?: Date;
    createdAt: Date;
}
export interface VoiceTranscript {
    speaker: 'bot' | 'human' | 'agent';
    text: string;
    timestamp: number;
    confidence?: number;
}
export interface CallSentiment {
    overall: 'positive' | 'neutral' | 'negative';
    score: number;
    emotions?: Record<string, number>;
}
export interface VoiceWebhookEvent {
    provider: string;
    eventType: VoiceEventType;
    callId: string;
    timestamp: string;
    payload: Record<string, unknown>;
}
export type VoiceEventType = 'call.started' | 'call.ringing' | 'call.answered' | 'call.completed' | 'call.failed' | 'call.transcription' | 'call.recording' | 'dtmf.received' | 'speech.recognized' | 'intent.detected' | 'transfer.requested' | 'voicemail.received';
//# sourceMappingURL=voice.d.ts.map