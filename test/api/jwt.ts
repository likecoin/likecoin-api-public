import jwt from 'jsonwebtoken';

export function jwtSign({
  user,
  wallet,
  permissions = ['read', 'write'],
}: {
  user?: string;
  wallet?: string;
  permissions?: string[];
}) {
  return jwt.sign({
    user,
    wallet,
    permissions,
  }, 'likecoin', {
    audience: 'rinkeby.like.co',
    issuer: 'rinkeby.like.co',
    expiresIn: '7d',
  });
}

export default jwtSign;
