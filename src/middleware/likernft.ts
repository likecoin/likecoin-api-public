import { ValidationError } from '../util/ValidationError';
import { getISCNPrefix } from '../util/cosmos/iscn';
import {
  getISCNPrefixByClassId,
  getISCNPrefixByClassIdFromChain,
  getCurrentClassIdByISCNId,
  getISCNPrefixDocName,
} from '../util/api/likernft';

export const fetchISCNPrefixAndClassId = async (req, res, next) => {
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

export const fetchISCNPrefixFromChain = async (req, res, next) => {
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
