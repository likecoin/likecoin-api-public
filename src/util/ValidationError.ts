export class ValidationError extends Error {
  status: number = 400;

  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

export default ValidationError;
