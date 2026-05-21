import type { z } from 'zod';
import type {
  UserDataFilteredResponseSchema,
  UserDataMinResponseSchema,
  UserDataScopedResponseSchema,
} from '../util/api/users/schemas';

export type UserDataFiltered = z.infer<typeof UserDataFilteredResponseSchema>;

export type UserDataMin = z.infer<typeof UserDataMinResponseSchema>;

export type UserDataScopedFiltered = z.infer<typeof UserDataScopedResponseSchema>;
