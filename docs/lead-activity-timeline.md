# Lead activity timeline

Lead activity tracking begins when this migration is deployed. New manual leads and
new website submissions receive an initial activity, and later tracked edits append
immutable timeline entries.

Existing leads are intentionally not backfilled. Their timeline remains empty until
the next tracked change because LeadHome cannot reliably reconstruct historical
events, sources, or timestamps.

Activities are deleted automatically when their lead or owning user is deleted.
They are read newest-first, with the activity ID used as a deterministic
tie-breaker for equal timestamps. Lead and activity writes occur in the same
database transaction.
