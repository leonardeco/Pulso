create table if not exists cuenta (
  id uuid primary key,
  nombre text not null,
  correo text not null unique,
  clave_hash text not null,
  es_admin boolean not null default false,
  creada_en timestamptz not null default now()
);

create table if not exists acceso_cliente (
  cliente_id text not null,
  entrenador_id uuid not null references cuenta on delete cascade,
  correo text not null unique,
  clave_hash text not null,
  primary key (entrenador_id, cliente_id)
);
create index if not exists acceso_cliente_entrenador_idx on acceso_cliente (entrenador_id);

create table if not exists sesion (
  token_hash text primary key,
  rol text not null check (rol in ('entrenador','cliente')),
  cuenta_id uuid not null references cuenta on delete cascade,
  cliente_id text,
  expira timestamptz not null
);
create index if not exists sesion_expira_idx on sesion (expira);
create index if not exists sesion_cuenta_cliente_idx on sesion (cuenta_id, cliente_id);

create table if not exists estudio (
  entrenador_id uuid primary key references cuenta on delete cascade,
  datos jsonb not null,
  version integer not null default 0,
  actualizado_en timestamptz not null default now()
);

create table if not exists intento (
  clave text primary key,
  fallos integer not null default 0,
  hasta timestamptz not null
);
