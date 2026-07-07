"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VonageAdapter = void 0;
class VonageAdapter {
    config;
    name = 'vonage';
    constructor(config) {
        this.config = config;
    }
    async initiateCall(options) {
        const ncco = [
            { action: 'talk', text: options.script ?? 'Hello, this is an automated call.' },
            { action: 'input', type: ['speech'], speechSettings: { endOnSilence: 3 } },
        ];
        const res = await fetch('https://api.nexmo.com/v1/calls', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.jwt}`,
            },
            body: JSON.stringify({
                to: [{ type: 'phone', number: options.toNumber.replace('+', '') }],
                from: { type: 'phone', number: (options.fromNumber ?? this.config.defaultFromNumber).replace('+', '') },
                ncco,
                event_url: [`${process.env.API_BASE_URL}/api/v1/voice/webhook/vonage`],
            }),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(`Vonage error: ${data.title}`);
        return { callId: data.uuid, status: data.status };
    }
    normalizeWebhook(provider, body, headers) {
        return {
            provider: 'vonage',
            eventType: this.mapVonageEvent(body.status, body),
            callId: body.uuid,
            timestamp: body.timestamp ?? new Date().toISOString(),
            payload: {
                from: body.from,
                to: body.to?.number,
                direction: body.direction,
                status: body.status,
                duration: body.duration,
                recording_url: body.recording_url,
                speech: body.speech?.results?.[0]?.text,
                dtmf: body.dtmf?.digits,
            },
        };
    }
    webhookAck(eventType) {
        // Vonage NCCO (Nexmo Call Control Object)
        return [{ action: 'talk', text: '' }];
    }
    mapVonageEvent(status, body) {
        if (body.speech)
            return 'speech.recognized';
        if (body.dtmf)
            return 'dtmf.received';
        if (body.recording_url)
            return 'call.recording';
        const map = {
            started: 'call.started',
            ringing: 'call.ringing',
            answered: 'call.answered',
            completed: 'call.completed',
            failed: 'call.failed',
            busy: 'call.failed',
            timeout: 'call.failed',
            rejected: 'call.failed',
            cancelled: 'call.failed',
        };
        return map[status] ?? 'call.started';
    }
}
exports.VonageAdapter = VonageAdapter;
//# sourceMappingURL=adapter.js.map