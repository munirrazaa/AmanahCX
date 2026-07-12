-- 051_fix_user_ticket_views_user_id_type.sql
-- user_ticket_views.user_id was created as bigint, but users.id (and every
-- caller: GET/POST/DELETE /saved-views in tickets.ts) is uuid. Any query
-- comparing user_id to req.user.sub crashed with
-- "invalid input syntax for type bigint: <uuid>". Table was empty in
-- production (feature never worked), so this is a plain column-type fix,
-- no data migration needed.

ALTER TABLE user_ticket_views
  ALTER COLUMN user_id TYPE uuid USING user_id::text::uuid;

ALTER TABLE user_ticket_views
  ADD CONSTRAINT user_ticket_views_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
