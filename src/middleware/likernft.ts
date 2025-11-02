import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../util/ValidationError';
import { getISCNPrefix } from '../util/cosmos/iscn';
import {
  getISCNPrefixByClassId,
  getISCNPrefixByClassIdFromChain,
  getCurrentClassIdByISCNId,
  getISCNPrefixDocName,
} from '../util/api/likernft';

import { WNFT_BATCH_PURCHASE_LIMIT } from '../../config/config';

export const fetchISCNPrefixAndClassId = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { iscn_id: iscnId } = req.query;
    let { class_id: classId } = req.query;
    if (!iscnId && !classId) throw new ValidationError('MISSING_ISCN_OR_CLASS_ID');
    let iscnPrefix;
    if (!iscnId) {
      iscnPrefix = await getISCNPrefixByClassId(classId);
    } else {
      iscnPrefix = getISCNPrefix(iscnId);
    }
    if (!classId) {
      classId = await getCurrentClassIdByISCNId(iscnPrefix);
    }
    res.locals.iscnPrefix = iscnPrefix;
    res.locals.classId = classId;
    res.locals.iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
    next();
  } catch (err) {
    next(err);
  }
};

export const fetchISCNPrefixes = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { class_id: classId } = req.query;
    if (!classId) throw new ValidationError('MISSING_ISCN_OR_CLASS_ID');
    const classIds = Array.isArray(classId) ? classId : [classId];
    if (classIds.length !== new Set(classIds).size) throw new ValidationError('CANNOT_PURCHASE_SAME_CLASS', 422);
    if (classIds.length > WNFT_BATCH_PURCHASE_LIMIT) throw new ValidationError(`CLASS_NUMBER_EXCESS_${WNFT_BATCH_PURCHASE_LIMIT}`, 422);
    const iscnPrefixes = await Promise.all(classIds.map((id) => getISCNPrefixByClassId(id)));
    res.locals.iscnPrefixes = iscnPrefixes;
    res.locals.classIds = classIds;
    next();
  } catch (err) {
    next(err);
  }
};

export const fetchISCNPrefixFromChain = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { class_id: classId } = req.query;
    if (!classId) throw new ValidationError('MISSING_CLASS_ID');
    const iscnPrefix = await getISCNPrefixByClassIdFromChain(classId);
    res.locals.iscnPrefix = iscnPrefix;
    next();
  } catch (err) {
    next(err);
  }
};

export default fetchISCNPrefixAndClassId;
