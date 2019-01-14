import { Router } from 'express';
import {
  ETH_NETWORK_NAME,
  PUBSUB_TOPIC_MISC,
  TWITTER_USER_ID_STR,
  TWITTER_STATUS_ID_STR,
} from '../../../constant';
import {
  db,
  userCollection as dbRef,
} from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import {
  TWITTER_CONSUMER_KEY,
  TWITTER_CONSUMER_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
} from '../../../../config/config';

const Twit = require('twit');

const router = Router();

router.post('/twitter', async (req, res) => {
  let url;
  let userId;
  try {
    ({ url, user: userId } = req.body);
    const userRef = dbRef.doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('USER_NOT_EXIST');
    if (userDoc.data().twitter) throw new Error('MISSION_ALREADY_DONE');
    const T = new Twit({
      consumer_key: TWITTER_CONSUMER_KEY,
      consumer_secret: TWITTER_CONSUMER_SECRET,
      access_token: TWITTER_ACCESS_TOKEN,
      access_token_secret: TWITTER_ACCESS_TOKEN_SECRET,
      timeout_ms: 60 * 1000,
    });
    const match = url.match(/^https:\/\/twitter\.com\/\w+\/status(es)?\/(\d+)$/);
    if (!match || !match[2]) throw new Error('TWITTER_URL_INVALID');
    const statusId = match[2];
    const statusRes = await T.get('statuses/show', {
      id: statusId,
    });
    if (!statusRes || !statusRes.data) throw new Error('TWITTER_API_FAILURE');
    if (statusRes.data.errors) {
      console.error(statusRes.data.errors);
      throw new Error('TWITTER_UNKNOWN_ERROR');
    }
    const twitterIdStr = statusRes.data.user.id_str;
    const quotedIdStr = statusRes.data.quoted_status_id_str;
    const isValidQuote = quotedIdStr === TWITTER_STATUS_ID_STR;
    const checkText = statusRes.data.text.toLowerCase();
    const isValidText = checkText.split(/\s+/).includes('#likecoin');
    if (!isValidQuote) throw new Error('TWITTER_QUOTE_INVALID');
    if (!isValidText) throw new Error('TWITTER_CONTENT_INVALID');
    const friendshipRes = await T.get('friendships/show', {
      source_id: twitterIdStr,
      target_id: TWITTER_USER_ID_STR,
    });
    if (!friendshipRes || !friendshipRes.data) throw new Error('TWITTER_API_FAILURE');
    if (friendshipRes.data.errors) {
      console.error(friendshipRes.data.errors);
      throw new Error('TWITTER_UNKNOWN_ERROR');
    }
    const isFollowing = friendshipRes.data.relationship.source.following;
    if (!isFollowing) throw new Error('TWITTER_NOT_FOLLOW');
    await db.runTransaction(async (t) => {
      const twitterQuery = dbRef.where('twitter', '==', twitterIdStr).limit(1);
      const twitterRes = await t.get(twitterQuery);
      if (twitterRes.docs.length > 0) throw new Error('TWITTER_ALREADY_EXIST');
      const missionRef = dbRef.doc(userId).collection('mission').doc('twitter');
      const d = await t.get(userRef);
      if (d.exists && d.data().twitter) throw new Error('MISSION_ALREADY_DONE');
      return Promise.all([
        t.update(userRef, { twitter: twitterIdStr }),
        t.set(missionRef, { done: true, url }, { merge: true }),
      ]);
    });
    const ethNetwork = ETH_NETWORK_NAME;
    const {
      wallet,
      email,
      displayName,
      referrer,
      timestamp: registerTime,
    } = userDoc.data();
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventTwitter',
      ethNetwork,
      user: userId,
      wallet,
      displayName,
      email,
      referrer,
      twitterIdStr,
      registerTime,
      url,
    });
    return res.json({ message: 'OK' });
  } catch (err) {
    console.error(`user: ${userId}, url: ${url}`); // eslint-disable-line no-console
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

router.post('/twitterRetweet', async (req, res) => {
  const TWEET_ID = '1010271556742807552';
  const { inputTwitterId, user: userId, missionId } = req.body;
  try {
    if (!([
      'twitterBitmart',
    ].includes(missionId))) {
      throw new Error('MISSION_NOT_FOUND');
    }
    const userRef = dbRef.doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('USER_NOT_EXIST');
    if (userDoc.data().twitterObj && userDoc.data().twitterObj[missionId]) throw new Error('MISSION_ALREADY_DONE');

    const T = new Twit({
      consumer_key: TWITTER_CONSUMER_KEY,
      consumer_secret: TWITTER_CONSUMER_SECRET,
      access_token: TWITTER_ACCESS_TOKEN,
      access_token_secret: TWITTER_ACCESS_TOKEN_SECRET,
      timeout_ms: 60 * 1000,
    });
    const match = inputTwitterId.match(/^[a-zA-Z0-9_]{1,15}$/);
    if (!match) throw new Error('TWITTER_ID_INVALID');

    const timelineRes = await T.get('statuses/user_timeline', {
      screen_name: inputTwitterId,
      since_id: TWEET_ID,
    });
    if (!timelineRes || !timelineRes.data) throw new Error('TWITTER_API_FAILURE');
    if (timelineRes.data.errors) {
      console.error(timelineRes.data.errors);
      // unknown error case
      throw new Error('TWITTER_UNKNOWN_ERROR');
    }
    const tweet = timelineRes.data.find(d => d.text && d.text.startsWith('RT @') && d.retweeted_status && d.retweeted_status.id_str === TWEET_ID);

    if (!tweet) throw new Error('TWITTER_QUOTE_INVALID');
    const twitterIdStr = tweet.user.id_str;
    const tweetIdStr = tweet.id_str;
    await db.runTransaction(async (t) => {
      const twitterQuery = dbRef.where(`twitterObj.${missionId}`, '==', twitterIdStr).limit(1);
      const twitterRes = await t.get(twitterQuery);
      if (twitterRes.docs.length > 0) throw new Error('TWITTER_ALREADY_EXIST');
      const missionRef = dbRef.doc(userId).collection('mission').doc(missionId);
      const d = await t.get(userRef);
      if (d.exists && d.data().twitterObj && d.data().twitterObj[missionId]) throw new Error('MISSION_ALREADY_DONE');
      return Promise.all([
        t.update(userRef, { [`twitterObj.${missionId}`]: twitterIdStr }),
        t.set(missionRef, { done: true, inputTwitterId }, { merge: true }),
      ]);
    });

    const ethNetwork = ETH_NETWORK_NAME;
    const {
      wallet,
      email,
      displayName,
      referrer,
      timestamp: registerTime,
    } = userDoc.data();
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventTwitterRetweet',
      ethNetwork,
      user: userId,
      wallet,
      displayName,
      email,
      referrer,
      twitterIdStr,
      registerTime,
      inputTwitterId,
      tweetIdStr,
      missionId,
    });
    return res.json({ message: 'OK' });
  } catch (err) {
    console.error(`user: ${userId}, inputTwitterId: ${inputTwitterId}`); // eslint-disable-line no-console
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
    return res.status(400).send(msg);
  }
});

export default router;
