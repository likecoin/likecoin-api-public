import { Router } from 'express';
import metadata from './metadata';

const router = Router();

router.use(metadata);

export default router;
