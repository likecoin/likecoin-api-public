-- Canonical analytics view over the `misc` Pub/Sub firehose archive.
--
-- The raw table stores each event as a JSON string in `data` (schema-on-read).
-- This view projects the common envelope plus a CANONICAL ACTOR IDENTITY so
-- analysts don't have to COALESCE eight different "who" fields per query.
--
-- Identity model (per platform convention):
--   * evmWallet  = canonical on-chain wallet
--   * wallet     = on-chain wallet, may be EVM or legacy Cosmos (`like1...`)
--   * likeWallet = DEPRECATED legacy Cosmos wallet
--   * likerId / user = account-system id (a SEPARATE namespace from wallets)
-- Wallet and Liker ID cannot be merged without a users lookup, so both are
-- exposed as distinct columns. Prefer `actor_wallet` for on-chain joins
-- (purchases, claims, reading, subscriptions) and `actor_liker_id` for
-- account-level analysis (registration, OAuth, RevenueCat).
--
-- Always filter on `publish_time` to prune partitions.

CREATE OR REPLACE VIEW `likecoin-foundation.event_archive.misc_enriched` AS
SELECT
  publish_time,
  subscription_name,
  message_id,

  -- Envelope
  JSON_VALUE(data, '$.logType')        AS log_type,
  JSON_VALUE(data, '$.uuidv4')         AS event_id,          -- per-message id, use for dedup
  JSON_VALUE(data, '$."@timestamp"')   AS event_timestamp,   -- publisher clock; prefer publish_time for partitions
  JSON_VALUE(data, '$.appServer')      AS app_server,
  JSON_VALUE(data, '$.ethNetwork')     AS eth_network,
  JSON_VALUE(data, '$.requestIP')      AS request_ip,
  JSON_VALUE(data, '$.requestUrl')     AS request_url,

  -- Canonical actor identity (two namespaces — see header)
  COALESCE(
    JSON_VALUE(data, '$.evmWallet'),   -- canonical wallet first
    JSON_VALUE(data, '$.wallet'),
    JSON_VALUE(data, '$.likeWallet')   -- deprecated, legacy data only
  )                                    AS actor_wallet,
  COALESCE(
    JSON_VALUE(data, '$.likerId'),
    JSON_VALUE(data, '$.user'),
    JSON_VALUE(data, '$.liker')        -- like-button events
  )                                    AS actor_liker_id,

  -- Canonical money: every revenue event now emits amountUSD (USD, numeric)
  SAFE_CAST(JSON_VALUE(data, '$.amountUSD') AS FLOAT64) AS amount_usd,

  -- Common join / object keys across the commerce + reading funnels
  COALESCE(
    JSON_VALUE(data, '$.classId'),
    JSON_VALUE(data, '$.nftClassId')
  )                                    AS class_id,
  JSON_VALUE(data, '$.paymentId')      AS payment_id,
  JSON_VALUE(data, '$.cartId')         AS cart_id,
  JSON_VALUE(data, '$.sessionId')      AS session_id,
  JSON_VALUE(data, '$.subscriptionId') AS subscription_id,

  -- Common segmentation dimensions
  JSON_VALUE(data, '$.utmSource')      AS utm_source,
  JSON_VALUE(data, '$.utmCampaign')    AS utm_campaign,
  COALESCE(
    JSON_VALUE(data, '$.channel'),
    JSON_VALUE(data, '$.fromChannel'),
    JSON_VALUE(data, '$.from')
  )                                    AS channel,

  -- Full raw payload for event-specific fields not projected above
  data                                 AS raw
FROM `likecoin-foundation.event_archive.misc_raw`;
