-- Ticket audit log must survive permanent ticket deletion (tenant_admin hard-delete
-- on closed tickets). The audit trail's purpose is to prove what happened even after
-- the ticket record itself is purged, so detach the cascade and keep rows orphaned
-- (ticket_id nullable, set NULL on delete) instead of cascading the delete into rows
-- the immutability trigger refuses to remove.
ALTER TABLE ticket_audit_log
  DROP CONSTRAINT ticket_audit_log_ticket_id_fkey;

ALTER TABLE ticket_audit_log
  ALTER COLUMN ticket_id DROP NOT NULL;

ALTER TABLE ticket_audit_log
  ADD CONSTRAINT ticket_audit_log_ticket_id_fkey
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;

-- The immutability trigger blocked ALL updates unconditionally, which also blocked the
-- FK's own SET NULL action above (it fires as an UPDATE, not a DELETE). Narrow the
-- trigger to allow exactly that one system-generated mutation — ticket_id transitioning
-- to NULL with every other column unchanged — while still rejecting direct app-level
-- edits and all deletes.
CREATE OR REPLACE FUNCTION public.ticket_audit_log_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ticket_audit_log is immutable — rows cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.ticket_id IS NOT NULL AND NEW.ticket_id IS NULL
     AND NEW.tenant_id  IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.actor_id   IS NOT DISTINCT FROM OLD.actor_id
     AND NEW.actor_name IS NOT DISTINCT FROM OLD.actor_name
     AND NEW.action     IS NOT DISTINCT FROM OLD.action
     AND NEW.old_value  IS NOT DISTINCT FROM OLD.old_value
     AND NEW.new_value  IS NOT DISTINCT FROM OLD.new_value
     AND NEW.meta       IS NOT DISTINCT FROM OLD.meta
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ticket_audit_log is immutable — rows cannot be updated';
END;
$function$;
