"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioAdapter = void 0;
class TwilioAdapter {
    name = 'twilio';
    accountSid;
    authToken;
    defaultFrom;
    constructor(config) {
        this.accountSid = config.accountSid;
        this.authToken = config.authToken;
        this.defaultFrom = config.defaultFromNumber;
    }
    async initiateCall(options) {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
        const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        const body = new URLSearchParams({
            To: options.toNumber,
            From: options.fromNumber ?? this.defaultFrom,
            Url: options.webhookUrl ?? `${process.env.API_BASE_URL}/api/v1/voice/twiml`,
        });
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(`Twilio error ${err.code}: ${err.message}`);
        }
        const data = await res.json();
        return { callId: data.sid, status: data.status };
    }
    normalizeWebhook(provider, body, headers) {
        const eventType = this.mapTwilioStatus(body.CallStatus, body);
        return {
            provider: 'twilio',
            eventType,
            callId: body.CallSid,
            timestamp: new Date().toISOString(),
            payload: {
                from: body.From,
                to: body.To,
                direction: body.Direction === 'inbound' ? 'inbound' : 'outbound',
                status: body.CallStatus,
                duration: body.CallDuration ? parseInt(body.CallDuration) : undefined,
                recordingUrl: body.RecordingUrl,
                transcriptionText: body.TranscriptionText,
                digits: body.Digits,
                speechResult: body.SpeechResult,
            },
        };
    }
    webhookAck(eventType) {
        // For call-in-progress events, return TwiML to continue the call
        if (eventType === 'call.started' || eventType === 'call.ringing') {
            return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${process.env.API_BASE_URL?.replace('https', 'wss')}/api/v1/voice/stream"/>
  </Connect>
</Response>`;
        }
        return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
    }
    buildCallScript(script) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${script}</Say>
  <Gather input="speech dtmf" speechTimeout="3" action="/api/v1/voice/webhook/twilio">
    <Say voice="Polly.Joanna">Please speak your response.</Say>
  </Gather>
</Response>`;
    }
    mapTwilioStatus(status, body) {
        if (body.TranscriptionText)
            return 'call.transcription';
        if (body.SpeechResult)
            return 'speech.recognized';
        if (body.Digits)
            return 'dtmf.received';
        const map = {
            initiated: 'call.started',
            ringing: 'call.ringing',
            'in-progress': 'call.answered',
            completed: 'call.completed',
            'no-answer': 'call.failed',
            busy: 'call.failed',
            failed: 'call.failed',
        };
        return map[status] ?? 'call.started';
    }
}
exports.TwilioAdapter = TwilioAdapter;
//# sourceMappingURL=adapter.js.map