import { userCollection, likeNFTBookUserCollection } from '../../firebase';
import stripe from '../../stripe';
import { getUserWithCivicLikerPropertiesByWallet } from '../users/getPublicInfo';

export async function getStripeSubscriptionDetails(subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  return {
    subscriptionId,
    period: subscription.items.data[0].plan.interval,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start * 1000,
    currentPeriodEnd: subscription.current_period_end * 1000,
    createdAt: subscription.created * 1000,
    customerId: subscription.customer as string,
    metadata: subscription.metadata,
  };
}

export async function getStripeSubscriptionsByCustomerId(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
  });
  return subscriptions.data;
}

export async function syncUserSubscription(data: { evmWallet?: string; subscriptionId?: string }) {
  const { evmWallet, subscriptionId } = data;

  try {
    let userDoc: any = null;
    let subscriptionDetails: any = null;
    let userEvmWallet = evmWallet;

    if (subscriptionId) {
      // Get subscription details from Stripe
      subscriptionDetails = await getStripeSubscriptionDetails(subscriptionId);

      // Try to get evmWallet from subscription metadata
      if (subscriptionDetails.metadata?.evmWallet) {
        userEvmWallet = subscriptionDetails.metadata.evmWallet;
      }

      // Find user by evmWallet if available
      if (userEvmWallet) {
        const user = await getUserWithCivicLikerPropertiesByWallet(userEvmWallet);
        if (user) {
          userDoc = await userCollection.doc(user.user).get();
        }
      }
    } else if (evmWallet) {
      // Find user by evmWallet
      const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet);
      if (user) {
        userDoc = await userCollection.doc(user.user).get();
      }
      userEvmWallet = evmWallet;

      if (userDoc) {
        const userData = userDoc.data();
        // Look for existing subscription
        if (userData.likerPlus?.subscriptionId) {
          subscriptionDetails = await getStripeSubscriptionDetails(
            userData.likerPlus.subscriptionId,
          );
        }
      }
    }

    if (!userDoc) {
      return {
        success: false,
        message: 'User not found',
        evmWallet: userEvmWallet,
        subscriptionId,
      };
    }

    if (!subscriptionDetails) {
      return {
        success: false,
        message: 'No subscription found',
        evmWallet: userEvmWallet,
        subscriptionId,
      };
    }

    const userId = userDoc.id;
    const userData = userDoc.data();
    const {
      currentPeriodStart, currentPeriodEnd, createdAt, period,
    } = subscriptionDetails;

    // Update user document with likerPlus info
    await userDoc.ref.update({
      likerPlus: {
        period,
        since: createdAt,
        currentPeriodStart,
        currentPeriodEnd,
        subscriptionId: subscriptionDetails.subscriptionId,
        customerId: subscriptionDetails.customerId,
      },
    });

    // Update book user collection
    if (userEvmWallet) {
      const bookUserDocRef = likeNFTBookUserCollection.doc(userEvmWallet);
      const bookUserDoc = await bookUserDocRef.get();
      const {
        stripeCustomerId: oldStripeCustomerId,
      } = bookUserDoc.data() || {};
      const updateData: Record<string, string> = {
        stripeCustomerId: subscriptionDetails.customerId,
      };
      if (oldStripeCustomerId && oldStripeCustomerId !== subscriptionDetails.customerId) {
        updateData.oldStripeCustomerId = oldStripeCustomerId;
      }
      await bookUserDocRef.set(updateData, { merge: true });
    }

    // Update Stripe subscription metadata
    const metadata: Record<string, string> = {};

    if (userEvmWallet) {
      metadata.evmWallet = userEvmWallet;
    }

    await stripe.subscriptions.update(subscriptionDetails.subscriptionId, {
      metadata,
    });

    return {
      success: true,
      userId,
      evmWallet: userEvmWallet,
      email: userData.email,
      stripeCustomerId: subscriptionDetails.customerId,
      subscriptionId: subscriptionDetails.subscriptionId,
      period: subscriptionDetails.period,
      status: subscriptionDetails.status,
      currentPeriodStart: subscriptionDetails.currentPeriodStart,
      currentPeriodEnd: subscriptionDetails.currentPeriodEnd,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error processing sync:', error);
    return {
      success: false,
      message: (error as Error).message,
      evmWallet,
      subscriptionId,
    };
  }
}

export async function linkSubscriptionToUser(subscriptionId: string, evmWallet: string) {
  try {
    // Get subscription details from Stripe
    const subscriptionDetails = await getStripeSubscriptionDetails(subscriptionId);

    // Check if subscription already has evmWallet metadata
    if (subscriptionDetails.metadata?.evmWallet
      && subscriptionDetails.metadata.evmWallet !== evmWallet) {
      return {
        success: false,
        message: `Subscription already linked to different wallet: ${subscriptionDetails.metadata.evmWallet}`,
        subscriptionId,
        evmWallet,
      };
    }

    // Find user by evmWallet
    const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet);
    if (!user) {
      return {
        success: false,
        message: 'User not found',
        subscriptionId,
        evmWallet,
      };
    }
    const userDoc = await userCollection.doc(user.user).get();

    if (!userDoc.exists) {
      return {
        success: false,
        message: 'User not found',
        subscriptionId,
        evmWallet,
      };
    }

    const userId = userDoc.id;
    const userData = userDoc.data();

    // Check if user already has likerPlus info
    if (userData.likerPlus) {
      return {
        success: false,
        message: 'User already has a Liker Plus subscription',
        subscriptionId,
        evmWallet,
      };
    }

    // Update user document with likerPlus info
    const {
      currentPeriodStart, currentPeriodEnd, createdAt, period,
    } = subscriptionDetails;

    await userDoc.ref.update({
      likerPlus: {
        period,
        since: createdAt,
        currentPeriodStart,
        currentPeriodEnd,
        subscriptionId,
        customerId: subscriptionDetails.customerId,
      },
    });

    // Update book user collection
    await likeNFTBookUserCollection.doc(evmWallet).set({
      stripeCustomerId: subscriptionDetails.customerId,
    }, { merge: true });

    // Update Stripe subscription metadata
    const metadata: Record<string, string> = {
      evmWallet,
    };

    await stripe.subscriptions.update(subscriptionId, {
      metadata,
    });

    return {
      success: true,
      userId,
      evmWallet,
      email: userData.email,
      subscriptionId,
      period: subscriptionDetails.period,
      status: subscriptionDetails.status,
      currentPeriodStart: subscriptionDetails.currentPeriodStart,
      currentPeriodEnd: subscriptionDetails.currentPeriodEnd,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error linking subscription ${subscriptionId}:`, error);
    return {
      success: false,
      message: (error as Error).message,
      subscriptionId,
      evmWallet,
    };
  }
}
