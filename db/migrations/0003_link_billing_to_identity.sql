ALTER TABLE billing_orders
  ALTER COLUMN customer_id TYPE uuid USING customer_id::uuid;

ALTER TABLE billing_payment_mandates
  ALTER COLUMN customer_id TYPE uuid USING customer_id::uuid;

ALTER TABLE billing_subscriptions
  ALTER COLUMN customer_id TYPE uuid USING customer_id::uuid;

ALTER TABLE billing_orders
  ADD CONSTRAINT billing_orders_customer_fk
  FOREIGN KEY (customer_id) REFERENCES identity_users(id);

ALTER TABLE billing_payment_mandates
  ADD CONSTRAINT billing_payment_mandates_customer_fk
  FOREIGN KEY (customer_id) REFERENCES identity_users(id);

ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_customer_fk
  FOREIGN KEY (customer_id) REFERENCES identity_users(id);
