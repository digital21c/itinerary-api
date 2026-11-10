-- Migration number: 0001 	 2026-11-10T06:48:25.226Z
create table creator_keys (
  id            text primary key,     -- UUID
  key_hash      blob not null unique, -- SHA-256; plaintext never stored
  label         text,                 -- e.g. 'my laptop'
  created_at    text not null,
  last_used_at  text,
  expires_at    text,
  revoked_at    text
);

create table documents (            -- identity only; never changes
  id          text primary key,     -- UUID
  type        text not null,
  created_at  text not null,
  created_by  text not null references creator_keys (id)
);

create index documents_created_by on documents (created_by);

create table document_keys (
  id            text primary key,     -- UUID; referenced instead of the hash
  document_id   text not null references documents (id) on delete cascade,
  key_hash      blob not null unique, -- SHA-256; plaintext never stored
  permission    text not null check (permission in ('reader', 'editor', 'manager')),
  label         text,                 -- e.g. 'phone app'
  created_at    text not null,
  last_used_at  text,                 -- update at most hourly, not on every read
  expires_at    text,
  revoked_at    text,
  check (permission <> 'manager' or expires_at is null)
);

create index document_keys_document_id on document_keys (document_id);

create table document_versions (
  document_id  text not null references documents (id) on delete cascade,
  version      integer not null,
  body         text check (body is null or json_valid(body)),
  deleted      integer not null default 0 check (deleted in (0, 1)),
  created_at   text not null,
  created_by   text references document_keys (id),
  primary key (document_id, version),
  check ((deleted = 0 and body is not null) or (deleted = 1 and body is null))
);

create table document_publications (  -- at most one row per document
  document_id   text primary key references documents (id) on delete cascade,
  version       integer not null,
  published_at  text not null,
  published_by  text references document_keys (id),
  foreign key (document_id, version) references document_versions (document_id, version)
);

create trigger document_versions_are_immutable
before update on document_versions
begin
  select raise(abort, 'document versions are immutable');
end;
