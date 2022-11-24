declare namespace Express {
   export interface Request {
      user?: any,
      auth?: any,
      locals?: any,
      rawBody?: any,
      file?: any,
      files?: any[],
      setLocale: (string) => void,
   }
}
