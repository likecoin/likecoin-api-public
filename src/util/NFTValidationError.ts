import { ValidationError } from './ValidationError';

export class NFTValidationError extends ValidationError {
  status = 400;

  nftId: string;

  constructor({
    message,
    status = 400,
    nftId = '',
  }) {
    super(message, status);
    this.nftId = nftId;
  }
}

export default NFTValidationError;
