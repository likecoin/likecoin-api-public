import {
  describe, it, expect, vi,
} from 'vitest';
import sgMail from '@sendgrid/mail';
import { sendVerificationEmail } from '../../src/util/sendgrid';

// The link is the whole verification flow, so pin its shape: host, path, and
// the `lang` a GET from a mail client has no other way to carry.
describe('sendVerificationEmail', () => {
  it('links straight at the API with the sender locale', async () => {
    const res = {
      // eslint-disable-next-line no-underscore-dangle
      __: (key: string, args?: Record<string, string>) => (args ? `${key} ${JSON.stringify(args)}` : key),
      getLocale: () => 'en',
    };
    await sendVerificationEmail(res, {
      email: 'user@example.com',
      displayName: 'User',
      verificationUUID: 'uuid-123',
    });

    const [msg] = vi.mocked(sgMail.send).mock.calls[0] as any[];
    expect(msg.to).toBe('user@example.com');
    expect(msg.html).toContain('https://api.rinkeby.like.co/email/verify/uuid-123?lang=en');
    expect(msg.html).not.toContain('like.co/verify/');
  });
});
