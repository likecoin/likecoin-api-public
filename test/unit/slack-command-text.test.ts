import {
  describe, expect, it, vi,
} from 'vitest';

import { normalizeSlackCommandText, slackCommandHandler } from '../../src/middleware/slack';

describe('normalizeSlackCommandText', () => {
  it.each([
    ['plain text', 'affiliate set alice@example.com karen', 'affiliate set alice@example.com karen'],
    ['inline code', '`affiliate list`', 'affiliate list'],
    ['a code block', '```affiliate set alice karen```', 'affiliate set alice karen'],
    ['a labelled mailto link', 'affiliate set <mailto:alice@example.com|alice@example.com> karen', 'affiliate set alice@example.com karen'],
    ['a bare mailto link', 'affiliate set <mailto:alice@example.com> karen', 'affiliate set alice@example.com karen'],
    ['a labelled URL', 'find <https://3ook.com/store|3ook.com>', 'find https://3ook.com/store'],
    ['a bare URL', 'find <https://3ook.com>', 'find https://3ook.com'],
    ['code wrapping a link', '`affiliate set <mailto:a@b.co|a@b.co> karen`', 'affiliate set a@b.co karen'],
  ])('unwraps %s', (_label, input, expected) => {
    expect(normalizeSlackCommandText(input)).toBe(expected);
  });

  it.each([
    ['user mentions', 'get <@U123|alice>'],
    ['channel mentions', 'get <#C123|general>'],
    ['special mentions', 'get <!here>'],
    ['wallets', 'affiliate set 0x1234567890abcdef1234567890abcdef12345678 karen'],
  ])('leaves %s untouched', (_label, input) => {
    expect(normalizeSlackCommandText(input)).toBe(input);
  });
});

describe('slackCommandHandler', () => {
  async function runWithBody(body: Record<string, unknown>) {
    const calls: Array<{ command: string; params: string[]; slashCommand: string }> = [];
    const record = (command: string) => async (
      { params, command: slashCommand }: { params: string[]; command: string },
    ) => {
      calls.push({ command, params, slashCommand });
    };
    const handler = slackCommandHandler(
      '/plus',
      { affiliate: record('affiliate'), help: record('help') },
      (command) => `Invalid command. Use ${command} help`,
    );
    const json = vi.fn();
    await handler({ body } as any, { json } as any);
    return { calls, json };
  }

  async function run(text: string | undefined) {
    return (await runWithBody({ text })).calls.map(({ command, params }) => ({ command, params }));
  }

  it('dispatches a command pasted as code with a mailto link', async () => {
    expect(await run('`affiliate set <mailto:alice@example.com|alice@example.com> karen`'))
      .toEqual([{ command: 'affiliate', params: ['set', 'alice@example.com', 'karen'] }]);
  });

  it.each([
    ['missing', undefined],
    ['only backticks', '``'],
  ])('falls back to help when the text is %s', async (_label, text) => {
    expect(await run(text)).toEqual([{ command: 'help', params: [] }]);
  });

  it('passes the typed slash command to the handler', async () => {
    const { calls } = await runWithBody({ command: '/plus_test', text: 'help' });
    expect(calls).toEqual([{ command: 'help', params: [], slashCommand: '/plus_test' }]);
  });

  it('falls back to the default slash command when Slack sends none', async () => {
    const { calls } = await runWithBody({ text: 'help' });
    expect(calls).toEqual([{ command: 'help', params: [], slashCommand: '/plus' }]);
  });

  it('names the typed slash command in the invalid command message', async () => {
    const { json } = await runWithBody({ command: '/plus_test', text: 'foo' });
    expect(json.mock.calls[0][0].attachments[0].text).toContain('Use /plus_test help');
  });
});
