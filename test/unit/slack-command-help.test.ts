import { describe, expect, it } from 'vitest';
import type { Router } from 'express';

import bookRouter from '../../src/routes/slack/book';
import paymentRouter from '../../src/routes/slack/payment';
import plusRouter from '../../src/routes/slack/plus';
import userRouter from '../../src/routes/slack/user';
import walletRouter from '../../src/routes/slack/wallet';

// Calls the route's last handler directly, skipping slackTokenChecker.
async function runSlackCommand(router: Router, body: Record<string, string>) {
  const layer = (router as any).stack.find((l: any) => l.route);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let payload: any;
  const res = { json: (data: unknown) => { payload = data; } };
  await handler({ body }, res);
  return JSON.stringify(payload);
}

describe.each([
  ['/user', userRouter],
  ['/book', bookRouter],
  ['/plus', plusRouter],
  ['/wallet', walletRouter],
  ['/payment', paymentRouter],
])('%s help', (command, router) => {
  const testCommand = `${command}_test`;

  it('names the typed testnet command', async () => {
    const output = await runSlackCommand(router, { command: testCommand, text: 'help' });
    expect(output).toContain(`${testCommand} `);
    expect(output).not.toContain(`${command} `);
  });

  it('keeps the production command', async () => {
    const output = await runSlackCommand(router, { command, text: 'help' });
    expect(output).toContain(`${command} `);
    expect(output).not.toContain(testCommand);
  });
});

describe('usage errors', () => {
  it.each([
    [plusRouter, '/plus_test', 'sync', 'Usage: /plus_test sync '],
    [bookRouter, '/book_test', 'approve', 'Usage: /book_test approve '],
    [bookRouter, '/book_test', 'tipping', 'Usage: /book_test tipping '],
    [bookRouter, '/book_test', 'foo', 'Use `/book_test help` for usage.'],
    [userRouter, '/user_test', 'unlimited-upload', 'Usage: /user_test unlimited-upload '],
  ])('%#: name the typed command', async (router, command, text, expected) => {
    expect(await runSlackCommand(router, { command, text })).toContain(expected);
  });
});
