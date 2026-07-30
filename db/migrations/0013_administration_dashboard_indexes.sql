CREATE INDEX billing_access_grants_admin_active_period_idx
  ON billing_access_grants (
    period_end,
    period_start,
    customer_id
  )
  WHERE status = 'granted';

CREATE INDEX billing_payments_admin_stale_pending_idx
  ON billing_payments (updated_at)
  WHERE status IN ('created', 'pending', 'requires_action');

CREATE INDEX billing_webhook_events_admin_failed_idx
  ON billing_webhook_events (received_at DESC)
  WHERE processing_status = 'failed';
