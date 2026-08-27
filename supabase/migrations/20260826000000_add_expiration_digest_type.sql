-- Add the enum value in its own migration transaction. PostgreSQL does not
-- allow a newly-added enum value to be used before the transaction commits.
alter type public.notification_type add value if not exists 'expiration_digest';
