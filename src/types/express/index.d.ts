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
   // Added by i18n.init; @types/i18n is not installed so declare what we use.
   export interface Response {
      setLocale: (locale: string) => void,
      getLocale: () => string,
      __: (key: string, ...args: any[]) => string,
   }
}
