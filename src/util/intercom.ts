import jwt, { JwtPayload } from 'jsonwebtoken';
import {
  INTERCOM_API_SECRET,
} from '../../config/config';

export function createIntercomToken(payload: JwtPayload): string | undefined {
  if (!INTERCOM_API_SECRET) return undefined;
  return jwt.sign(payload, INTERCOM_API_SECRET, { expiresIn: '1h' });
}

export default createIntercomToken;
