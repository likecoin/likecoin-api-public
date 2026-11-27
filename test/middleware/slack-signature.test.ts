import { createHmac } from 'crypto';
import { describe, it, expect } from 'vitest';
import express from 'express';
import axiosist from 'axiosist';

import { isValidSlackSignature, slackSignatureChecker } from '../../src/middleware/slack';

const SECRET = 'test-signing-secret';
const BODY = 'payload=%7B%22type%22%3A%22block_actions%22%7D';

function sign(body: string, timestamp: string, secret = SECRET) {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

function nowSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

describe('isValidSlackSignature', () => {
  const rawBody = Buffer.from(BODY);

  it('accepts a fresh, correctly signed body', () => {
    const timestamp = nowSeconds();
    expect(isValidSlackSignature({
      signingSecret: SECRET, timestamp, signature: sign(BODY, timestamp), rawBody,
    })).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    const timestamp = nowSeconds();
    expect(isValidSlackSignature({
      signingSecret: SECRET, timestamp, signature: sign(BODY, timestamp, 'other'), rawBody,
    })).toBe(false);
  });

  it('rejects a tampered body', () => {
    const timestamp = nowSeconds();
    expect(isValidSlackSignature({
      signingSecret: SECRET, timestamp, signature: sign(BODY, timestamp), rawBody: Buffer.from(`${BODY}x`),
    })).toBe(false);
  });

  it('rejects a timestamp older than five minutes', () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    expect(isValidSlackSignature({
      signingSecret: SECRET, timestamp, signature: sign(BODY, timestamp), rawBody,
    })).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    const timestamp = nowSeconds();
    expect(isValidSlackSignature({
      signingSecret: '', timestamp, signature: sign(BODY, timestamp, ''), rawBody,
    })).toBe(false);
  });
});

describe('slackSignatureChecker', () => {
  const app = express();
  app.post('/hook', slackSignatureChecker(SECRET), (req, res) => {
    res.json({ payload: req.body.payload });
  });
  const client = axiosist(app);

  function post(headers: Record<string, string>) {
    return client.post('/hook', BODY, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    });
  }

  it('parses the form body after a valid signature', async () => {
    const timestamp = nowSeconds();
    const res = await post({
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': sign(BODY, timestamp),
    });
    expect(res.status).toBe(200);
    expect(res.data.payload).toBe('{"type":"block_actions"}');
  });

  it('answers 401 to an unsigned request', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
  });
});
