import { describe, expect, it } from 'vitest';

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
  async function run(text: string | undefined) {
    const calls: Array<{ command: string; params: string[] }> = [];
    const record = (command: string) => async ({ params }: { params: string[] }) => {
      calls.push({ command, params });
    };
    const handler = slackCommandHandler({ affiliate: record('affiliate'), help: record('help') });
    const res = { json: () => res };
    await handler({ body: { text } } as any, res as any);
    return calls;
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
});
