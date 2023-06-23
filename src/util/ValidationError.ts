export class ValidationError extends Error {
  status = 400;

  payload: any = null;

  constructor(message, status = 400, payload: any = null) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
    this.payload = payload;
  }
}

export default ValidationError;
