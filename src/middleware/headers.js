export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin');
  next();
};

export const cacheControlHeader = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600, stale-if-error=604800, stale-while-revalidate=604800');
};
