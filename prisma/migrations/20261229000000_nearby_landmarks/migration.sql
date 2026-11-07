-- Nearby places now include landmarks and hotels and look further. Answers stored before this change are missing those,
-- and some are empty only because the map server refused or timed out, so they are cleared and looked up again.
DELETE FROM "nearby_cache";
