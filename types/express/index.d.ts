declare namespace Express {
   export interface Request {
      user?: any,
      auth?: any,
      rawBody?: any,
      setLocale: (string) => void,
   }
}
