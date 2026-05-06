-- Lock down the voices bucket. The earlier setup left it public + readable by
-- anon, which meant anyone could enumerate /storage/v1/object/public/voices/
-- and pull every voice recording. Now: bucket is private, no read policy for
-- anon, server generates short-lived signed URLs at submission time.

update storage.buckets set public = false where id = 'voices';

drop policy if exists "anon read voices" on storage.objects;
